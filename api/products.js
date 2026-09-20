// Vercel serverless function backing the Shop page. Stripe's own Product
// catalog *is* the inventory system here — there's no separate database.
// Josh or Jake adds an item as a Product in the Stripe Dashboard (photo,
// price, description) and archives it once it sells; this endpoint just
// lists whatever's currently active, cheapest first.
//
// The Dashboard's "Add product" screen only accepts one photo per
// product, but a piece often has a second image worth showing — its
// certificate of authenticity. Rather than fight that limit, a second
// image can be added via the product's Metadata (plain text, not
// image-capped): set a key called `certificate` to a filename that
// exists in assets/certificates/ (ask Claude to add the file to the repo
// first — see README, "Certificate images"). If that metadata key is
// set, this endpoint appends it to the images array as a second photo.

import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    console.error('api/products: missing STRIPE_SECRET_KEY environment variable.');
    return res.status(500).json({ ok: false, message: 'Shop is misconfigured.' });
  }

  const stripe = new Stripe(apiKey);

  try {
    const products = await stripe.products.list({
      active: true,
      limit: 100,
      expand: ['data.default_price'],
    });

    const items = products.data
      .filter((p) => p.default_price && p.default_price.unit_amount != null)
      .map((p) => {
        const images = Array.isArray(p.images) ? p.images.slice() : [];

        // Metadata value becomes part of a URL path — strip anything that
        // isn't a plain filename before trusting it, even though only
        // Jake/Josh can set it via the Stripe Dashboard.
        const certificateFile = p.metadata && typeof p.metadata.certificate === 'string'
          ? p.metadata.certificate.replace(/[^a-zA-Z0-9._-]/g, '')
          : '';
        if (certificateFile) {
          images.push(`assets/certificates/${certificateFile}`);
        }

        return {
          id: p.id,
          priceId: p.default_price.id,
          name: p.name,
          description: p.description || '',
          images,
          amount: p.default_price.unit_amount,
          currency: p.default_price.currency,
        };
      })
      .sort((a, b) => a.amount - b.amount);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('api/products: stripe.products.list threw:', err);
    return res.status(502).json({ ok: false, message: "Couldn't load the shop right now." });
  }
}
