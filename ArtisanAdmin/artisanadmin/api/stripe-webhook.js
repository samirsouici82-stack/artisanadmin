// Fonction serverless Vercel — écoute les événements Stripe (webhook).
// Utilise la clé service_role Supabase, qui contourne le RLS : c'est
// pour ça qu'elle ne doit JAMAIS être préfixée VITE_ ni utilisée côté client.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Requis pour vérifier la signature Stripe : on a besoin du corps brut
// de la requête, pas du JSON déjà parsé.
export const config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature webhook Stripe invalide :', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const artisanId = session.client_reference_id || session.metadata?.artisan_id;
        const plan = session.metadata?.plan || 'essentiel';
        if (artisanId) {
          await supabaseAdmin
            .from('abonnements')
            .update({
              plan,
              statut: 'actif',
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription
            })
            .eq('artisan_id', artisanId);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const artisanId = subscription.metadata?.artisan_id;
        if (artisanId) {
          const statut =
            subscription.status === 'active'
              ? 'actif'
              : subscription.status === 'canceled'
                ? 'annule'
                : 'impaye';
          await supabaseAdmin
            .from('abonnements')
            .update({
              statut,
              periode_fin: new Date(subscription.current_period_end * 1000).toISOString()
            })
            .eq('artisan_id', artisanId);
        }
        break;
      }

      default:
        // Événement non géré, on l'ignore volontairement.
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erreur traitement webhook Stripe :', err);
    res.status(500).json({ error: err.message });
  }
}
