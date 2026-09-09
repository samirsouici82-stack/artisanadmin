-- =====================================================================
-- ArtisanAdmin — Schéma Supabase (PostgreSQL)
-- À exécuter dans : Dashboard Supabase > SQL Editor > New query
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROFIL ARTISAN
-- L'id est le même que celui de auth.users (1 artisan = 1 compte auth)
-- ---------------------------------------------------------------------
create table public.artisans (
  id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,
  entreprise text not null,
  metier text not null,          -- 'plombier' | 'electricien' | 'macon' | 'chauffagiste' ...
  siret text,
  plan text not null default 'essentiel',   -- 'essentiel' | 'pro'
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ASSURANCES (décennale, RC pro, véhicule...)
-- ---------------------------------------------------------------------
create table public.assurances (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  type text not null,             -- 'decennale' | 'rc_pro' | 'vehicule'
  compagnie text,
  date_expiration date not null,
  created_at timestamptz not null default now()
);
create index idx_assurances_expiration on public.assurances(date_expiration);
create index idx_assurances_artisan on public.assurances(artisan_id);

-- ---------------------------------------------------------------------
-- 3. CERTIFICATIONS / HABILITATIONS obtenues par l'artisan
-- ---------------------------------------------------------------------
create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  code text not null,              -- ex: 'Qualibat RGE'
  date_obtention date not null,
  duree_ans int not null default 4,
  created_at timestamptz not null default now()
);
create index idx_certifications_artisan on public.certifications(artisan_id);

-- ---------------------------------------------------------------------
-- 4. CHANTIERS
-- ---------------------------------------------------------------------
create table public.chantiers (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  nom text not null,
  client text,
  statut text not null default 'en_cours',  -- 'en_cours' | 'termine'
  created_at timestamptz not null default now()
);
create index idx_chantiers_artisan on public.chantiers(artisan_id);

-- ---------------------------------------------------------------------
-- 5. FACTURES
-- ---------------------------------------------------------------------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  montant numeric(10,2),
  statut text not null default 'en_attente', -- 'en_attente' | 'envoyee' | 'payee'
  date_emission date not null default current_date,
  created_at timestamptz not null default now()
);
create index idx_factures_artisan on public.factures(artisan_id);
create index idx_factures_statut on public.factures(statut);

-- ---------------------------------------------------------------------
-- 6. ATTESTATIONS GÉNÉRÉES (historique des PDF émis)
-- ---------------------------------------------------------------------
create table public.attestations_generees (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  type text not null,              -- 'decennale' | 'vigilance_urssaf'
  genere_le timestamptz not null default now(),
  fichier_url text                 -- lien vers Supabase Storage si le PDF y est archivé
);
create index idx_attestations_artisan on public.attestations_generees(artisan_id);

-- ---------------------------------------------------------------------
-- 7. ABONNEMENTS (facturation Stripe)
-- ---------------------------------------------------------------------
create table public.abonnements (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null unique references public.artisans(id) on delete cascade,
  plan text not null default 'essentiel',    -- 'essentiel' | 'pro'
  statut text not null default 'actif',      -- 'actif' | 'impaye' | 'annule'
  stripe_customer_id text,
  stripe_subscription_id text,
  periode_fin timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. RÈGLES MÉTIER — pilotées par la base, pas codées en dur côté front
-- Permet d'ajouter un métier ou de corriger une règle sans redéployer l'appli.
-- ---------------------------------------------------------------------
create table public.regles_certifications (
  id uuid primary key default gen_random_uuid(),
  metier text not null,
  code text not null,
  label text not null,
  duree_ans int not null default 4
);

create table public.regles_reglementation (
  id uuid primary key default gen_random_uuid(),
  metier text not null,
  texte text not null,
  publie_le date not null default current_date
);

create table public.regles_aides (
  id uuid primary key default gen_random_uuid(),
  metier text not null,
  label text not null
);

-- Données de départ (identiques à ce qui était codé en dur dans le prototype)
insert into public.regles_certifications (metier, code, label, duree_ans) values
  ('plombier', 'qualibat_rge', 'Qualibat RGE', 4),
  ('electricien', 'qualifelec', 'Qualifelec', 4),
  ('electricien', 'habilitation_b1v_b2v', 'Habilitation électrique B1V/B2V', 3),
  ('macon', 'qualibat_gros_oeuvre', 'Qualibat Gros Œuvre', 4),
  ('chauffagiste', 'rge_qualipac', 'RGE QualiPAC', 4);

insert into public.regles_reglementation (metier, texte) values
  ('plombier', E'Interdiction d''installation de chaudières au fioul neuves : vérifiez les devis en cours qui en prévoiraient.'),
  ('electricien', 'NF C 15-100 : les colonnes électriques neuves doivent désormais intégrer un point de recharge véhicule.'),
  ('macon', 'RE2020 : nouveaux seuils d''émissions carbone applicables aux permis déposés depuis cette année.'),
  ('chauffagiste', 'Fin programmée des chaudières gaz neuves en collectif : anticipez vos devis pompe à chaleur.');

insert into public.regles_aides (metier, label) values
  ('plombier', 'MaPrimeRénov'''),
  ('plombier', 'Éco-prêt à taux zéro'),
  ('electricien', 'MaPrimeRénov'' bornes de recharge'),
  ('electricien', 'Prime CEE'),
  ('macon', 'MaPrimeRénov'' isolation'),
  ('macon', 'Aides Anah'),
  ('chauffagiste', 'MaPrimeRénov'' pompe à chaleur'),
  ('chauffagiste', 'Coup de pouce chauffage');

-- =====================================================================
-- 9. CRÉATION AUTOMATIQUE DU PROFIL ARTISAN À L'INSCRIPTION
-- Quand quelqu'un s'inscrit via supabase.auth.signUp(), ce trigger crée
-- automatiquement sa ligne dans public.artisans à partir des métadonnées
-- passées au moment de l'inscription (nom, entreprise, metier).
-- =====================================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.artisans (id, nom, entreprise, metier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nom', ''),
    coalesce(new.raw_user_meta_data->>'entreprise', ''),
    coalesce(new.raw_user_meta_data->>'metier', 'plombier')
  );

  insert into public.abonnements (artisan_id, plan, statut)
  values (new.id, 'essentiel', 'actif');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- 10. SÉCURITÉ — Row Level Security (RLS)
-- Chaque artisan ne peut lire/modifier QUE ses propres données.
-- Sans ça, n'importe quel utilisateur connecté pourrait lire toute la base.
-- =====================================================================
alter table public.artisans enable row level security;
alter table public.assurances enable row level security;
alter table public.certifications enable row level security;
alter table public.chantiers enable row level security;
alter table public.factures enable row level security;
alter table public.attestations_generees enable row level security;
alter table public.abonnements enable row level security;

-- Les tables de règles métier sont en lecture seule pour tout utilisateur connecté
alter table public.regles_certifications enable row level security;
alter table public.regles_reglementation enable row level security;
alter table public.regles_aides enable row level security;

create policy "Un artisan gère son propre profil"
  on public.artisans for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Un artisan gère ses propres assurances"
  on public.assurances for all
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

create policy "Un artisan gère ses propres certifications"
  on public.certifications for all
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

create policy "Un artisan gère ses propres chantiers"
  on public.chantiers for all
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

create policy "Un artisan gère ses propres factures"
  on public.factures for all
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

create policy "Un artisan gère ses propres attestations"
  on public.attestations_generees for all
  using (auth.uid() = artisan_id)
  with check (auth.uid() = artisan_id);

create policy "Un artisan voit son propre abonnement"
  on public.abonnements for select
  using (auth.uid() = artisan_id);

create policy "Lecture des règles métier pour tout utilisateur connecté"
  on public.regles_certifications for select
  using (auth.role() = 'authenticated');

create policy "Lecture de la réglementation pour tout utilisateur connecté"
  on public.regles_reglementation for select
  using (auth.role() = 'authenticated');

create policy "Lecture des aides pour tout utilisateur connecté"
  on public.regles_aides for select
  using (auth.role() = 'authenticated');

-- =====================================================================
-- Fin du schéma. Prochaine étape : configurer Auth > Providers > Email
-- dans le dashboard Supabase, puis utiliser supabase-client.js
-- =====================================================================
