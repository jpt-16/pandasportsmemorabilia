// Vercel serverless function backing the order form on the shop page.
//
// No card is collected here at all. Submitting the form just reserves the
// item (archives the Stripe Product so it can't be claimed twice) and
// records who wants it and where it's going. The actual charge happens
// later and separately: once the item is packed and shipped, someone
// creates a Stripe Invoice by hand (Stripe Dashboard → Invoices → Create,
// or via the Stripe connector) and sends it to the buyer's email — that
// invoice is what the buyer pays, and it's the only place a card is ever
// charged. See README.md, "Reserve now, invoice on ship."

import Stripe from 'stripe';
import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const GENERIC_FAILURE = "That didn't go through — try again in a moment.";

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amount / 100);
}

function cleanStr(value, maxLen) {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

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

  // Honeypot — same pattern as api/subscribe.js. Respond as if it worked;
  // never tell a bot what caught it.
  const honeypot = cleanStr(body.company, 200);
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  const priceId = cleanStr(body.priceId, 200);
  const name = cleanStr(body.name, 100);
  const email = cleanStr(body.email, 200);
  const address1 = cleanStr(body.address1, 200);
  const address2 = cleanStr(body.address2, 200);
  const city = cleanStr(body.city, 100);
  const state = cleanStr(body.state, 50);
  const zip = cleanStr(body.zip, 12);
  const idempotencyKey = cleanStr(body.idempotencyKey, 255) || undefined;

  if (!priceId) {
    return res.status(400).json({ ok: false, message: 'Missing item.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({
      ok: false,
      message: 'That email looks incomplete — check for a typo and try again.',
    });
  }
  if (!name || !address1 || !city || !state) {
    return res.status(400).json({
      ok: false,
      message: 'Fill in your name and full shipping address.',
    });
  }
  if (!ZIP_RE.test(zip)) {
    return res.status(400).json({ ok: false, message: 'That ZIP code looks off.' });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    console.error('api/order: missing STRIPE_SECRET_KEY environment variable.');
    return res.status(500).json({ ok: false, message: 'Shop is misconfigured.' });
  }

  const stripe = new Stripe(apiKey);

  let productId, productName, amount, currency;
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    if (!price.active || !price.product || price.product.active === false) {
      return res.status(410).json({ ok: false, message: 'That piece is no longer available.' });
    }
    productId = price.product.id;
    productName = price.product.name || 'your item';
    amount = price.unit_amount;
    currency = price.currency;
  } catch (err) {
    console.error('api/order: failed to look up price:', err);
    return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
  }

  try {
    await stripe.products.update(
      productId,
      { active: false },
      idempotencyKey ? { idempotencyKey } : undefined
    );
  } catch (err) {
    console.error('api/order: failed to archive product', productId, err);
    return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
  }

  const shippingLines = [address1, address2, `${city}, ${state} ${zip}`].filter(Boolean);
  const shippingAddress = shippingLines.join(', ');
  const priceStr = formatAmount(amount, currency);

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.RESEND_FROM || 'Panda Sports Memorabilia <info@pandasportsmemorabilia.com>';
  const notifyTo = process.env.RESEND_NOTIFY_TO || 'support@pandasportsmemorabilia.com';

  if (resendKey) {
    const resend = new Resend(resendKey);

    try {
      await resend.emails.send({
        from: fromAddress,
        to: notifyTo,
        subject: `New order to pack: ${productName}`,
        text: `${name} <${email}> just reserved ${productName} (${priceStr}) — no payment collected yet.\n\nShip to: ${shippingAddress}\n\nWhen it's packed and shipped: create a Stripe invoice for exactly ${priceStr} — the listed price is all-inclusive (shipping, tax, fees, insurance), so don't add anything on top — to ${email} (Stripe Dashboard → Invoices → Create invoice, or ask Claude to do it via the Stripe connector) and send it. That's the moment they're actually charged.`,
      });
    } catch (err) {
      console.error('api/order: internal order notification failed:', err);
    }

    try {
      await resend.emails.send({
        from: fromAddress,
        replyTo: 'support@pandasportsmemorabilia.com',
        to: email,
        subject: `You've reserved it — ${productName}`,
        text: `${productName} (${priceStr}) is reserved for you — no charge yet, and no card was collected.\n\nWe'll pack it up and, once it actually ships, email you a Stripe invoice for ${priceStr} to pay. That's the only time your card is charged.\n\nShipping to:\n${shippingLines.join('\n')}\n\nReply to this email any time if you have a question about it.\n\nThank you for supporting Panda. 10% of this sale goes to cancer research.`,
      });
    } catch (err) {
      console.error('api/order: buyer confirmation email failed:', err);
    }
  } else {
    console.error('api/order: RESEND_API_KEY not set, skipping order emails.');
  }

  return res.status(200).json({ ok: true, item: productName });
}
