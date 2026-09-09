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

4. **Configurer Stripe (paiement des abonnements)**
   - Crée un compte sur [stripe.com](https://stripe.com), reste en **mode Test** pour commencer.
   - Dans **Product catalog**, crée deux produits récurrents mensuels : "Essentiel" à 29€ et "Pro" à 49€. Récupère l'identifiant de prix (`price_...`) de chacun.
   - Dans **Developers > API keys**, récupère la clé secrète (`sk_test_...`).
   - Ajoute dans `.env` (jamais préfixées `VITE_`, ce sont des secrets serveur) :
     ```
     STRIPE_SECRET_KEY=sk_test_...
     STRIPE_PRICE_ESSENTIEL=price_...
     STRIPE_PRICE_PRO=price_...
     SUPABASE_SERVICE_ROLE_KEY=... (Dashboard Supabase > Project Settings > API)
     ```
   - Pour tester le webhook en local, installe la [Stripe CLI](https://docs.stripe.com/stripe-cli), puis lance :
     ```bash
     stripe listen --forward-to localhost:5173/api/stripe-webhook
     ```
     Elle affiche un secret `whsec_...` à mettre dans `STRIPE_WEBHOOK_SECRET`.
   - En production (Vercel), crée plutôt un endpoint webhook dans **Developers > Webhooks** pointant vers `https://ton-site.vercel.app/api/stripe-webhook`, écoutant au minimum `checkout.session.completed`, `customer.subscription.updated` et `customer.subscription.deleted`.
   - Carte de test pour payer sans vrai argent : `4242 4242 4242 4242`, une date future, n'importe quel CVC.

5. **Déployer**
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
├─ index.html                 → interface (vitrine + connexion + bon de travail)
├─ src/
│  ├─ main.js                 → logique de l'appli, moteur de règles, PDF, paiement
│  └─ lib/
│     └─ supabase-client.js   → auth + accès aux données Supabase
├─ api/                        → fonctions serverless Vercel (Stripe)
│  ├─ create-checkout-session.js
│  ├─ create-portal-session.js
│  └─ stripe-webhook.js
├─ supabase/
│  ├─ schema.sql               → à coller dans le SQL Editor de Supabase
│  └─ migration_stripe.sql     → à coller ensuite, pour la période d'essai
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
