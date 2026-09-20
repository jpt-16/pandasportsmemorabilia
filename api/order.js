// Vercel serverless function that finishes a reservation.
//
// By the time this runs, the buyer has already: filled in name + shipping
// address, and entered a card into Stripe's own embedded card field, which
// Stripe.js turned into a saved payment method on a Stripe Customer without
// that card data ever touching this server (see api/setup-intent.js and
// assets/js/shop.js). This endpoint just ties it together — confirms the
// payment method really belongs to that customer, saves it as their default
// so it can be charged later without them present, records the shipping
// address on the customer, and archives the Stripe Product so the
// one-of-a-kind item can't be reserved twice.
//
// No charge happens here. The buyer's card is charged later and separately:
// once the item is packed and shipped, someone creates a Stripe Invoice set
// to "charge automatically" (Stripe Dashboard → Invoices → Create, or via
// the Stripe connector) — because the card is already saved as the
// customer's default payment method, Stripe charges it on its own when that
// invoice is finalized. See README.md, "Reserve now, save the card, charge
// on ship."

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
  const customerId = cleanStr(body.customerId, 100);
  const paymentMethodId = cleanStr(body.paymentMethodId, 100);
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
  if (!customerId || !paymentMethodId) {
    return res.status(400).json({
      ok: false,
      message: 'Your card didn’t save correctly — try again.',
    });
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

  // Confirm the payment method actually belongs to this customer before
  // trusting either ID — both came straight from the client.
  let cardBrand = '';
  let cardLast4 = '';
  try {
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (paymentMethod.customer !== customerId) {
      return res.status(400).json({ ok: false, message: 'Your card didn’t save correctly — try again.' });
    }
    if (paymentMethod.card) {
      cardBrand = paymentMethod.card.brand || '';
      cardLast4 = paymentMethod.card.last4 || '';
    }
  } catch (err) {
    console.error('api/order: failed to verify payment method:', err);
    return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
  }

  const shippingLines = [address1, address2, `${city}, ${state} ${zip}`].filter(Boolean);
  const shippingAddress = shippingLines.join(', ');

  try {
    await stripe.customers.update(customerId, {
      name,
      shipping: {
        name,
        address: {
          line1: address1,
          line2: address2 || undefined,
          city,
          state,
          postal_code: zip,
          country: 'US',
        },
      },
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (err) {
    console.error('api/order: failed to save shipping/payment method on customer:', err);
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

  const priceStr = formatAmount(amount, currency);
  const cardStr = cardBrand && cardLast4 ? `${cardBrand} ending ${cardLast4}` : 'card on file';

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
        text: `${name} <${email}> just reserved ${productName} (${priceStr}) and saved a card (${cardStr}) — not charged yet.\n\nShip to: ${shippingAddress}\n\nWhen it's packed and shipped: create a Stripe invoice for ${priceStr}, set to "Charge automatically" rather than "Send invoice" (Stripe Dashboard → Invoices → Create invoice, or ask Claude to do it via the Stripe connector) for customer ${customerId}. Their card is already on file as the default payment method, so it charges on its own once the invoice is finalized — no action needed from them. The listed price is all-inclusive (standard shipping, tax, fees, insurance), so don't add anything on top unless this buyer separately asked you for expedited shipping, in which case add that cost.\n\nIf the automatic charge fails (can happen with some cards), send them a payable invoice instead as a fallback.`,
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
        text: `${productName} (${priceStr}) is reserved for you. Your ${cardStr} is saved securely with Stripe, but nothing has been charged yet.\n\nWe'll pack it up and, once it actually ships, your card will be charged automatically — no further action needed from you, and we'll email you when it happens.\n\nShipping to:\n${shippingLines.join('\n')}\n\nReply to this email any time if you have a question about it.\n\nThank you for supporting Panda. 10% of this sale goes to cancer research.`,
      });
    } catch (err) {
      console.error('api/order: buyer confirmation email failed:', err);
    }
  } else {
    console.error('api/order: RESEND_API_KEY not set, skipping order emails.');
  }

  return res.status(200).json({ ok: true, item: productName });
}
