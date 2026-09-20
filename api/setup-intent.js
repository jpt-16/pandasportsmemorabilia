// Vercel serverless function that starts the card-saving step of a
// reservation. Called before the buyer's card details ever exist anywhere —
// this only creates a Stripe Customer and a SetupIntent, then hands back a
// client secret. The browser uses that secret with Stripe.js to collect and
// confirm the card directly with Stripe (see assets/js/shop.js); the raw
// card number never touches this server, only Stripe's.
//
// usage: 'off_session' on the SetupIntent is what allows the saved card to
// be charged later without the buyer present — that's what makes "charge
// automatically once it ships" possible without an expiring authorization
// hold (see README, "Reserve now, save the card, charge on ship").

import Stripe from 'stripe';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // Same honeypot pattern as api/order.js and api/subscribe.js.
  const honeypot = typeof body.company === 'string' ? body.company.trim() : '';
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({
      ok: false,
      message: 'That email looks incomplete — check for a typo and try again.',
    });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    console.error('api/setup-intent: missing STRIPE_SECRET_KEY environment variable.');
    return res.status(500).json({ ok: false, message: 'Shop is misconfigured.' });
  }

  const stripe = new Stripe(apiKey);

  try {
    const customer = await stripe.customers.create({ email });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    return res.status(200).json({
      ok: true,
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (err) {
    console.error('api/setup-intent: failed to create customer/setup intent:', err);
    return res.status(502).json({
      ok: false,
      message: "That didn't go through — try again in a moment.",
    });
  }
}
