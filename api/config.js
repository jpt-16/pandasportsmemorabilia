// Vercel serverless function that hands the Stripe *publishable* key to the
// browser. Publishable keys (pk_...) are meant to be public — they can only
// tokenize card details, never move money or read account data — but they
// still come from an env var rather than being hardcoded into a committed
// file, so switching between test and live mode is a Vercel setting change,
// not a code change.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    console.error('api/config: missing STRIPE_PUBLISHABLE_KEY environment variable.');
    return res.status(500).json({ ok: false, message: 'Shop is misconfigured.' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ ok: true, publishableKey });
}
