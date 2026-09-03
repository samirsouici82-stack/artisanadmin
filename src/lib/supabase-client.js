// =====================================================================
// ArtisanAdmin — Client Supabase
// Les clés viennent de .env (voir .env.example) — jamais en dur dans le code.
// =====================================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'Variables Supabase manquantes : copiez .env.example en .env et renseignez vos clés.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =====================================================================
// AUTHENTIFICATION
// =====================================================================

/**
 * Inscription d'un nouvel artisan.
 * Le trigger SQL handle_new_user() crée automatiquement sa ligne
 * dans la table `artisans` à partir de ces métadonnées.
 */
export async function inscrireArtisan({ email, password, nom, entreprise, metier }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nom, entreprise, metier } }
  });
  if (error) throw error;
  return data; // data.session est null si la confirmation par email est activée
}

/** Connexion par email + mot de passe */
export async function connecterArtisan(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Connexion par lien magique — pas de mot de passe à retenir */
export async function envoyerLienMagique(email) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function deconnecter() {
  await supabase.auth.signOut();
}

/** Récupère la session active (à appeler au chargement de l'appli) */
export async function recupererSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Écoute les changements de connexion (connexion, déconnexion, expiration du token)
export function ecouterAuth(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

// =====================================================================
// PROFIL ARTISAN
// =====================================================================

export async function getProfil(artisanId) {
  const { data, error } = await supabase
    .from('artisans')
    .select('*')
    .eq('id', artisanId)
    .single();
  if (error) throw error;
  return data;
}

export async function mettreAJourProfil(artisanId, champs) {
  const { error } = await supabase.from('artisans').update(champs).eq('id', artisanId);
  if (error) throw error;
}

// =====================================================================
// DONNÉES MÉTIER
// =====================================================================

export async function ajouterAssurance(artisanId, { type, compagnie, date_expiration }) {
  const { error } = await supabase
    .from('assurances')
    .insert({ artisan_id: artisanId, type, compagnie, date_expiration });
  if (error) throw error;
}

export async function ajouterCertifications(artisanId, certifications) {
  // certifications: [{ code, date_obtention, duree_ans }, ...]
  const rows = certifications.map((c) => ({ artisan_id: artisanId, ...c }));
  const { error } = await supabase.from('certifications').insert(rows);
  if (error) throw error;
}

export async function getAssurances(artisanId) {
  const { data, error } = await supabase
    .from('assurances')
    .select('*')
    .eq('artisan_id', artisanId)
    .order('date_expiration', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getCertifications(artisanId) {
  const { data, error } = await supabase
    .from('certifications')
    .select('*')
    .eq('artisan_id', artisanId);
  if (error) throw error;
  return data;
}

export async function getFacturesEnAttente(artisanId) {
  const { data, error, count } = await supabase
    .from('factures')
    .select('*', { count: 'exact' })
    .eq('artisan_id', artisanId)
    .eq('statut', 'en_attente');
  if (error) throw error;
  return { factures: data, total: count ?? 0 };
}

export async function getChantiersEnCours(artisanId) {
  const { data, error } = await supabase
    .from('chantiers')
    .select('*')
    .eq('artisan_id', artisanId)
    .eq('statut', 'en_cours');
  if (error) throw error;
  return data;
}

// =====================================================================
// RÈGLES MÉTIER (viennent de la base — modifiables sans redéployer le front)
// =====================================================================

export async function getReglesCertifications(metier) {
  const { data, error } = await supabase
    .from('regles_certifications')
    .select('*')
    .eq('metier', metier);
  if (error) throw error;
  return data;
}

export async function getReglementation(metier) {
  const { data, error } = await supabase
    .from('regles_reglementation')
    .select('*')
    .eq('metier', metier)
    .order('publie_le', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAidesEligibles(metier) {
  const { data, error } = await supabase
    .from('regles_aides')
    .select('*')
    .eq('metier', metier);
  if (error) throw error;
  return data;
}

// =====================================================================
// ATTESTATIONS — historiser chaque PDF généré
// =====================================================================

export async function enregistrerAttestationGeneree(artisanId, type) {
  const { error } = await supabase
    .from('attestations_generees')
    .insert({ artisan_id: artisanId, type });
  if (error) throw error;
}

// =====================================================================
// CONTEXTE COMPLET — un seul appel pour construire le bon de travail
// =====================================================================
export async function chargerContexteHebdomadaire(artisanId) {
  const profil = await getProfil(artisanId);

  const [assurances, certifications, facturesInfo, chantiers, reglementation, aides] =
    await Promise.all([
      getAssurances(artisanId),
      getCertifications(artisanId),
      getFacturesEnAttente(artisanId),
      getChantiersEnCours(artisanId),
      getReglementation(profil.metier),
      getAidesEligibles(profil.metier)
    ]);

  return {
    profil,
    assurances,
    certifications,
    facturesEnAttente: facturesInfo.total,
    chantiers,
    reglementation,
    aides
  };
}
