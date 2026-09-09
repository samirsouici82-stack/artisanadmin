// Fonction serverless Vercel — s'exécute côté serveur uniquement.
// Reçoit { artisanId, email, plan } et renvoie l'URL de paiement Stripe.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  essentiel: process.env.STRIPE_PRICE_ESSENTIEL,
  pro: process.env.STRIPE_PRICE_PRO
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const { artisanId, email, plan } = req.body;
    const priceId = PRICE_IDS[plan];

    if (!artisanId || !priceId) {
      res.status(400).json({ error: 'artisanId ou plan invalide' });
      return;
    }

    const origin = req.headers.origin || process.env.SITE_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: artisanId,
      metadata: { artisan_id: artisanId, plan },
      subscription_data: { metadata: { artisan_id: artisanId, plan } },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur création session Stripe :', err);
    res.status(500).json({ error: err.message });
  }
}
