// Vercel serverless function backing the two "Notify me" forms on the site.
// Every signup is added to a Resend audience (so there's a real, exportable
// list to email when the shop opens) and, best-effort, triggers a plain
// notification email so someone sees it happen in real time.
//
// Required setup (see .env.example): RESEND_API_KEY and RESEND_AUDIENCE_ID
// must be set as real Environment Variables in the Vercel project — this
// function fails closed (returns an error to the visitor) if either is
// missing, rather than silently pretending to succeed.

import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC_FAILURE =
  "That didn't go through — try again in a moment, or email support@pandasportsmemorabilia.com directly.";

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

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  // Honeypot: a hidden field real visitors never see or fill. A bot that
  // auto-fills every field trips it. Respond exactly as if it worked —
  // never tell a bot what caught it, or it just learns to skip that field.
  const honeypot = typeof body.company === 'string' ? body.company.trim() : '';
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({
      ok: false,
      message: 'That address looks incomplete — check for a typo and try again.',
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error(
      'api/subscribe: missing RESEND_API_KEY or RESEND_AUDIENCE_ID environment variable.'
    );
    return res.status(500).json({
      ok: false,
      message:
        "Something's misconfigured on our end — email support@pandasportsmemorabilia.com and we'll add you by hand.",
    });
  }

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.contacts.create({ email, audienceId });

    if (error) {
      // Resend can return an error for a contact that's already on the
      // list — from the visitor's side that's still a success, they're on
      // it either way, so only a genuinely different error is fatal here.
      const alreadyOnList = /already exists|duplicate/i.test(error.message || '');
      if (!alreadyOnList) {
        console.error('api/subscribe: resend.contacts.create error:', error);
        return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
      }
    }
  } catch (err) {
    console.error('api/subscribe: resend.contacts.create threw:', err);
    return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
  }

  // Best-effort notification email. The signup already succeeded above —
  // a failure here is logged, never surfaced to the visitor.
  const notifyTo = process.env.RESEND_NOTIFY_TO || 'support@pandasportsmemorabilia.com';
  const fromAddress =
    process.env.RESEND_FROM || 'Panda Sports Memorabilia <info@pandasportsmemorabilia.com>';

  try {
    await resend.emails.send({
      from: fromAddress,
      to: notifyTo,
      subject: `New signup: ${email}`,
      text: `${email} just signed up to be notified when Panda opens.`,
    });
  } catch (err) {
    console.error('api/subscribe: notification email failed (non-fatal):', err);
  }

  // Best-effort welcome email to the subscriber. Same non-fatal treatment —
  // they're already on the list either way.
  try {
    await resend.emails.send({
      from: fromAddress,
      to: email,
      replyTo: 'support@pandasportsmemorabilia.com',
      subject: "You're on the list",
      text: "Thanks for signing up — we'll email you the moment Panda Sports Memorabilia opens, before it's public anywhere else. No spam in the meantime, just the one email when it's time.",
    });
  } catch (err) {
    console.error('api/subscribe: welcome email failed (non-fatal):', err);
  }

  return res.status(200).json({ ok: true });
}
