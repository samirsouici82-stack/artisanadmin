// Fonction serverless Vercel — ouvre le portail Stripe où l'artisan peut
// lui-même changer de carte, changer de plan, ou résilier. Évite d'avoir
// à construire ces écrans soi-même.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const { stripeCustomerId } = req.body;
    if (!stripeCustomerId) {
      res.status(400).json({ error: 'stripeCustomerId manquant' });
      return;
    }

    const origin = req.headers.origin || process.env.SITE_URL || 'http://localhost:5173';

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur création session portail Stripe :', err);
    res.status(500).json({ error: err.message });
  }
}
