// Vercel serverless function backing the homepage contact form (#contact).
// Emails the visitor's question to support@ through Resend, with Reply-To
// set to the visitor so answering is just hitting Reply. Phone is
// optional — when it's given, the email leads with a "call them back"
// line, since that's the promise the site makes.
//
// Uses the same Resend setup as api/subscribe.js (see .env.example):
// RESEND_API_KEY is required; RESEND_NOTIFY_TO and RESEND_FROM are
// optional and default to the same addresses. Fails closed if the key is
// missing, rather than pretending the message went through.

import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC_FAILURE =
  "That didn't go through — try again in a moment, or email support@pandasportsmemorabilia.com directly.";

function field(body, key, max) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  return value.slice(0, max);
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

  // Honeypot — same trick as api/subscribe.js: answer as if it worked.
  if (field(body, 'company', 200)) {
    return res.status(200).json({ ok: true });
  }

  // Strip line breaks from single-line fields: they end up in the email
  // subject and headers.
  const name = field(body, 'name', 120).replace(/[\r\n]+/g, ' ');
  const email = field(body, 'email', 200).replace(/[\r\n]+/g, '');
  const phone = field(body, 'phone', 40).replace(/[\r\n]+/g, ' ');
  const message = field(body, 'message', 5000);

  if (!name) {
    return res.status(400).json({ ok: false, message: 'Add your name so we know who to ask for.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({
      ok: false,
      message: 'That address looks incomplete — check for a typo and try again.',
    });
  }
  if (phone && phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({
      ok: false,
      message: 'That phone number looks too short — check it, or leave it blank.',
    });
  }
  if (!message) {
    return res.status(400).json({ ok: false, message: 'Add your question.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('api/contact: missing RESEND_API_KEY environment variable.');
    return res.status(500).json({
      ok: false,
      message:
        "Something's misconfigured on our end — email support@pandasportsmemorabilia.com directly.",
    });
  }

  const resend = new Resend(apiKey);
  const notifyTo = process.env.RESEND_NOTIFY_TO || 'support@pandasportsmemorabilia.com';
  const fromAddress =
    process.env.RESEND_FROM || 'Panda Sports Memorabilia <info@pandasportsmemorabilia.com>';

  const lines = [
    phone ? `CALL BACK REQUESTED: ${name} left a phone number — ${phone}` : `${name} asked to be answered by email.`,
    '',
    `Name:  ${name}`,
    `Email: ${email}`,
    `Phone: ${phone || '(not given)'}`,
    '',
    'Question:',
    message,
  ];

  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: notifyTo,
      replyTo: email,
      subject: phone ? `Call back: ${name} (${phone})` : `Question from ${name}`,
      text: lines.join('\n'),
    });
    if (error) {
      console.error('api/contact: resend.emails.send error:', error);
      return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
    }
  } catch (err) {
    console.error('api/contact: resend.emails.send threw:', err);
    return res.status(502).json({ ok: false, message: GENERIC_FAILURE });
  }

  return res.status(200).json({ ok: true });
}
