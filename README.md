# ArtisanAdmin

Prototype fonctionnel : authentification réelle, base de données PostgreSQL
(Supabase), moteur de règles administratives par métier, et génération de
PDF pour les attestations.

## Démarrage

1. **Créer le projet Supabase**
   - Va sur [supabase.com](https://supabase.com), crée un compte et un nouveau projet.
   - Dans **SQL Editor**, colle le contenu de `supabase/schema.sql` et exécute-le.
   - Dans **Project Settings > API**, récupère `Project URL` et la clé `anon public`.
   - Dans **Authentication > Providers**, vérifie que *Email* est activé.
     Pour tester plus vite pendant le développement, tu peux désactiver
     *Confirm email* (Authentication > Providers > Email) — pense à le
     réactiver avant un vrai lancement.

2. **Configurer le projet**
   ```bash
   cp .env.example .env
   ```
   Renseigne `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans `.env`.

3. **Installer et lancer**
   ```bash
   npm install
   npm run dev
   ```
   L'appli est disponible sur `http://localhost:5173`.

4. **Déployer**
   ```bash
   npm run build
   ```
   Le dossier `dist/` généré peut être déployé sur Vercel, Netlify, ou tout
   hébergeur de fichiers statiques. Pense à renseigner les mêmes variables
   d'environnement (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) dans les
   réglages de ton hébergeur.

## Arborescence

```
artisanadmin/
├─ index.html                 → interface (connexion + bon de travail)
├─ src/
│  ├─ main.js                 → logique de l'appli, moteur de règles, PDF
│  └─ lib/
│     └─ supabase-client.js   → auth + accès aux données Supabase
├─ supabase/
│  └─ schema.sql               → à coller dans le SQL Editor de Supabase
├─ .env.example                → modèle de configuration
└─ package.json
```

## Ce qui vient de la base plutôt que du code

Les durées de validité des certifications, les textes réglementaires et les
aides éligibles par métier sont stockés dans les tables
`regles_certifications`, `regles_reglementation` et `regles_aides` (voir
`supabase/schema.sql`). Pour ajouter un métier ou corriger une règle, il
suffit de modifier ces tables depuis le dashboard Supabase — aucun
redéploiement du site n'est nécessaire.

## Limites connues de ce prototype

- Pas encore de gestion des abonnements payants (Stripe) — la table
  `abonnements` existe déjà en base, prête à être branchée.
- Le flux "confirmation d'email" est géré côté message d'attente, mais
  l'onboarding (ajout de l'assurance et des certifications initiales) n'est
  effectué qu'en l'absence de confirmation d'email requise. Si tu actives
  *Confirm email*, il faudra ajouter un petit formulaire "Compléter mon
  profil" affiché au premier login.
