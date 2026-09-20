// Stripe webhook endpoint. Point a webhook at
// https://<your-domain>/api/webhook for the `invoice.paid` event (Stripe
// Dashboard → Developers → Webhooks → Add endpoint), then copy its signing
// secret into STRIPE_WEBHOOK_SECRET.
//
// This is the one email in the whole "reserve now, save the card, charge
// on ship" flow that isn't triggered by our own code — it's triggered by
// Stripe itself, the moment an automatically-collected invoice actually
// charges the buyer's saved card (see README, "Reserve now, save the
// card, charge on ship"). Nothing else needs a webhook: reserving doesn't
// call Stripe back, and finalizing the invoice is a manual action someone
// takes in the Dashboard, not something this site triggers.
//
// Best-effort on email, same as the rest of this codebase — a Resend
// failure here is logged, not retried, since Stripe already retries the
// webhook delivery itself.

import Stripe from 'stripe';
import { Resend } from 'resend';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amount / 100);
}

// invoice_pdf is a signed, publicly-fetchable URL Stripe generates for every
// finalized invoice — no Stripe API key needed to download it, just a plain
// GET. Attaching this to our own email means the buyer gets a real invoice
// PDF regardless of whatever Stripe's own dashboard email settings are set
// to.
async function fetchInvoicePdf(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('api/webhook: failed to fetch invoice PDF:', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed.');
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    console.error('api/webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET.');
    return res.status(500).send('Webhook misconfigured.');
  }

  const sig = req.headers['stripe-signature'];
  const stripe = new Stripe(stripeKey);

  let event;
  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('api/webhook: signature verification failed:', err.message);
    return res.status(400).send('Webhook signature verification failed.');
  }

  if (event.type !== 'invoice.paid') {
    return res.status(200).json({ received: true });
  }

  const invoice = event.data.object;
  const buyerEmail = invoice.customer_email;
  const amount = formatAmount(invoice.amount_paid, invoice.currency);
  const itemName =
    (invoice.lines && invoice.lines.data[0] && invoice.lines.data[0].description) || 'your item';

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('api/webhook: RESEND_API_KEY not set, skipping charge confirmation email.');
    return res.status(200).json({ received: true });
  }
  if (!buyerEmail) {
    console.error('api/webhook: invoice.paid event had no customer_email:', invoice.id);
    return res.status(200).json({ received: true });
  }

  const resend = new Resend(resendKey);
  const fromAddress =
    process.env.RESEND_FROM || 'Panda Sports Memorabilia <info@pandasportsmemorabilia.com>';

  const pdfBuffer = invoice.invoice_pdf ? await fetchInvoicePdf(invoice.invoice_pdf) : null;

  try {
    await resend.emails.send({
      from: fromAddress,
      replyTo: 'support@pandasportsmemorabilia.com',
      to: buyerEmail,
      subject: `You've been charged — ${itemName} is on its way`,
      text: `Your card was just charged ${amount} for ${itemName} — it's packed and shipping now.${pdfBuffer ? ' Your invoice is attached for your records.' : ''}\n\nReply to this email any time if you have a question about it.\n\nThank you for supporting Panda. 10% of this sale's proceeds go to a cancer charity or foundation of our choice.`,
      ...(pdfBuffer
        ? {
            attachments: [
              { filename: `invoice-${invoice.number || invoice.id}.pdf`, content: pdfBuffer },
            ],
          }
        : {}),
    });
  } catch (err) {
    console.error('api/webhook: charge confirmation email failed:', err);
  }

  return res.status(200).json({ received: true });
}
