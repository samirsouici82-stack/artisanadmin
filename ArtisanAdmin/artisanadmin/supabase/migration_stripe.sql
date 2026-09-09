-- =====================================================================
-- ArtisanAdmin — Migration Stripe
-- À exécuter dans : Dashboard Supabase > SQL Editor > New query
-- (à faire APRÈS schema.sql, en complément, pas à la place)
-- =====================================================================

-- Une inscription démarre maintenant en période d'essai de 14 jours,
-- pas déjà "actif" sans avoir payé.
alter table public.abonnements
  alter column statut set default 'essai';

-- Remplace la fonction déclenchée à l'inscription pour fixer la date
-- de fin d'essai à 14 jours.
create or replace function public.handle_new_user()
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

  insert into public.abonnements (artisan_id, plan, statut, periode_fin)
  values (new.id, 'essentiel', 'essai', now() + interval '14 days');

  return new;
end;
$$;

-- La sécurité (RLS) existante empêche déjà un artisan de modifier son
-- propre abonnement — seul le webhook Stripe (via la clé service_role,
-- qui contourne le RLS) pourra le faire depuis /api/stripe-webhook.js.
