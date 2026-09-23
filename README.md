# Panda Sports Memorabilia

A site for Panda Sports Memorabilia. It's live — the shop actually sells
whatever's currently in stock via Stripe (see "Shop & checkout" below),
one item at a time as inventory comes in. The homepage explains the
proposition, links straight into the shop, and also collects email
addresses for new-arrival alerts (see "Email signups" below). The pages
themselves are still plain static HTML
with no build step — open `index.html` directly, or serve the folder with
any static host, and everything renders. What needs Vercel specifically is
the serverless *backend*: `npm install` (Vercel runs this automatically on
deploy) pulls in `resend` and `stripe` for the `api/` functions. Browsing
the site elsewhere works fine; signups, the shop listing and checkout only
work when the API routes are actually running — on Vercel, or via
`vercel dev` locally.

```
index.html             homepage — hero, why, how, what's coming, family, signup
shop.html              live product listing, pulled from Stripe — browse only, click through for one
product.html           one item in full — every photo, description, "Reserve this item"
shop-success.html      where the site sends a buyer after reserving (card saved, not charged)
about.html             origin story, vault, team, philosophy, figures
faq.html               authentication, shipping, sales policy, payment
privacy.html           what we collect, cookies, your rights
refunds.html           all sales final — no refunds, returns or exchanges
terms.html             the rules for using the site and buying from us
sitemap.xml            static list of the real pages, for Search Console / crawlers
robots.txt              allows everything, points at sitemap.xml
assets/css/styles.css  design tokens + every component style
assets/js/main.js      mobile menu, email signups, FAQ accordions
assets/js/shop.js      shop.html only — fetches products, renders the browsable grid
assets/js/product.js   product.html only — finds the item by ?id=, gallery + reserve flow
assets/js/spotlight.js index.html only — features one item on the homepage, if it's still listed
assets/brand/           logo, mark, and favicon files
assets/certificates/     certificate-of-authenticity images, one per item
api/subscribe.js       serverless function: signup -> Resend audience
api/products.js        serverless function: list active Stripe products
api/config.js          serverless function: hands the Stripe publishable key to the browser
api/setup-intent.js    serverless function: create a Stripe Customer + SetupIntent (save a card)
api/order.js           serverless function: reserve an item -> archive + email (no charge)
api/webhook.js         serverless function: invoice.paid -> "you've been charged" email + PDF
package.json           declares the two dependencies (resend, stripe) + Node version
.env.example           the environment variables the api/ functions need
tools/sync-chrome.py   keeps the header/footer identical across pages
vercel.json            clean URLs + cache headers
```

There is no build step, so the header and footer are duplicated into each
page between `CHROME:TOP` / `CHROME:FOOT` comment markers. Edit them in
`index.html` only, then:

```
python3 tools/sync-chrome.py          # push the change to the other pages
python3 tools/sync-chrome.py --check  # exit 1 if any page is stale (CI)
```

## Email signups

Both "Notify me" forms POST to `api/subscribe.js`, a Vercel serverless
function that adds the address to a Resend audience (a real, exportable
contact list — not just a notification) and, best-effort, emails
`support@pandasportsmemorabilia.com` (from `info@pandasportsmemorabilia.com`
— the automated-sender address) so someone sees each signup happen. A
hidden honeypot field on both forms catches simple bots server-side.

**To make it actually work, someone needs to:**

1. Create a free account at [resend.com](https://resend.com).
2. Add and verify `pandasportsmemorabilia.com` as a sending domain (Resend
   gives you a few DNS records — SPF/DKIM — to add wherever the domain's DNS
   is managed; this is what lets Resend send *from* that domain instead of
   landing in spam). Takes a few minutes to propagate.
3. Create an audience (Resend has been renaming these "Segments" in newer
   dashboards — same feature, either name) and copy its ID.
4. Create an API key at [resend.com/api-keys](https://resend.com/api-keys).
5. In the Vercel project's Settings → Environment Variables, add:
   - `RESEND_API_KEY` — the key from step 4.
   - `RESEND_AUDIENCE_ID` — the ID from step 3.
   - `RESEND_NOTIFY_TO` and `RESEND_FROM` are optional — see `.env.example`
     for what they default to if you skip them.
6. Redeploy (Vercel picks up new environment variables on the next deploy,
   not the running one).

Until that's done, the form fails closed: `api/subscribe.js` checks for
`RESEND_API_KEY`/`RESEND_AUDIENCE_ID` and returns a clear error asking the
visitor to email `support@` directly, rather than silently pretending to
succeed. Test it end-to-end (a real signup, then check it landed in the
Resend audience and the notification email arrived) before pointing real
traffic at the site.

**One thing I couldn't verify from here:** exactly how Resend's API reports
a duplicate signup (someone submitting an email already on the list).
`api/subscribe.js` guesses from the error message ("already exists" /
"duplicate") and treats that case as a success rather than an error — worth
confirming once real signups are flowing, since if Resend's actual wording
differs, a repeat signup would show a (harmless but unnecessary) error
message instead of the normal success one.

## Shop & checkout

There's no separate database or admin panel for inventory — **Stripe's own
Product catalog is the inventory system.** Add a Product in the Stripe
Dashboard (name, description, a photo, a one-time Price) and it appears
on `shop.html`; archive it there once it sells and it disappears from
the site. `api/products.js` lists active products for both pages.

`shop.html` is browse-only — a grid of cards (photo, name, price) that
each link to `product.html?id=<product id>`, where the actual item lives:
every photo, the full description, and "Reserve this item". Splitting it
this way (rather than cramming the reserve form into every grid card, an
earlier version of this site) means a buyer sees a proper single-item
page — closer to how a normal e-commerce product page reads — before
committing to anything, and the reserve flow only has to exist in one
place. `api/setup-intent.js` + `api/order.js` handle whatever gets
submitted from there — see "Reserve now, save the card, charge on ship"
below for the whole flow.

### Certificate images

The Dashboard's "Add product" screen only accepts one photo per product.
To show a second image — a piece's certificate of authenticity — add the
file to `assets/certificates/` in this repo (see that folder's own
README for the exact steps), then set a **Metadata** entry on the Stripe
Product: key `certificate`, value the filename. `api/products.js` reads
that metadata key and appends `assets/certificates/<filename>` to the
item's image list. Both `shop.html` (a small thumbnail gallery, cropped
to fit the grid card) and `product.html` (the full, uncropped photos —
this is where a buyer should be able to actually see every detail,
including the certificate) render every image in the list as a
swipeable set (plain CSS scroll-snap, no library) with dot indicators
once there's more than one. Metadata itself isn't image-capped, so this
works entirely within Stripe's existing product record — no separate
content system.

### Pricing not settled yet

Sometimes a piece is listed before its price is final. Set a **Metadata**
entry on the Stripe Product: key `price_tbd`, value `true`. The Price
object underneath is untouched (so it still sorts normally and nothing
breaks if you forget to unset the flag later), but `api/products.js`
passes a `priceTbd: true` flag to the front end, which shows a "Price —
not final yet" badge instead of a dollar amount on both `shop.html` and
`product.html`, and hides the "Reserve this item" button and the whole
order form entirely — nobody should save a card against a price that
isn't settled. Remove the metadata key (or set it to anything other than
`true`) once the price is locked in.

### Homepage spotlight

`index.html` features one specific item — its Stripe product id is
hardcoded as `FEATURED_ID` at the top of `assets/js/spotlight.js`. On
load it fetches `/api/products` and only shows the section if that id is
still in the active list, so a sold/archived item never gets advertised
on the homepage; swap `FEATURED_ID` to feature something else, or clear
it and hide the section by deleting the `spotlight.js` script tag if
nothing should be featured for a while.

### Reserve now, save the card, charge on ship

On `product.html`, clicking "Reserve this item" opens an inline form for
name, shipping address, and a card — the card field itself is Stripe's
own, embedded on the page via Stripe.js (loaded in `product.html`, wired
up in `assets/js/product.js`), so the raw card number never reaches our
server, only Stripe's. That's what keeps this out of PCI-compliance
territory beyond the simplest tier: we're never the one handling card
data.

What actually happens on submit, in order:

1. The browser POSTs `{ email }` to `api/setup-intent.js`, which creates a
   Stripe Customer and a SetupIntent (`usage: 'off_session'` — this is
   what allows the saved card to be charged later without the buyer
   present) and returns a client secret.
2. The browser calls `stripe.confirmCardSetup()` with that secret and the
   Card Element — this is the step where the card details actually leave
   the browser, going straight to Stripe, never through our server. It
   comes back with a payment method id.
3. The browser POSTs everything else — name, address, that customer id
   and payment method id — to `api/order.js`, which: confirms the payment
   method really belongs to that customer, saves it as their **default
   payment method** and records their shipping address on the Stripe
   Customer, archives the Stripe Product (so it can't be reserved twice),
   and sends two emails — a "you're reserved, card saved, not charged
   yet" note to the buyer, and a "pack this up" notice to `support@` with
   the shipping details and the Stripe Customer id (see the info@/support@
   split above: `info@` is the automated sender, `support@` is the human
   inbox both land in).

No charge happens at any point in that sequence — the card is saved, not
billed.

**The buyer is only ever charged once, automatically, after the item
actually ships:**

**Stripe Dashboard → Invoices → Create invoice** for that customer, one
line item for the price, collection method set to **"Charge
automatically"** (not "Send invoice") **→ Finalize.** Because the card is
already saved as the customer's default payment method, Stripe charges it
on its own the moment the invoice is finalized — no email for the buyer
to open, no button for them to click. The Stripe MCP connector can also
do this directly if asked to, using the customer id from the order
notification email.

Why a saved card instead of authorize-then-capture (an earlier approach
in this codebase's history): a `capture_method: 'manual'` PaymentIntent
authorization expires if not captured within roughly a week, which risked
having to ask the buyer to pay again if an order sat unshipped too long.
A saved payment method on a Customer doesn't expire on that kind of
timer — it charges automatically whenever the invoice is finalized,
whether that's tomorrow or next month. The tradeoff is the same as before:
finalizing that invoice is still a manual step, so a forgotten order stays
un-invoiced (and uncharged) indefinitely.

**To make it actually work, someone needs to:**

1. Create a [Stripe](https://dashboard.stripe.com) account. Everything
   below can be done in test mode first with a `sk_test_.../pk_test_...`
   key pair — test mode has its own separate Products, Customers and
   Invoices, completely isolated from live mode, so nothing you list or
   charge while testing shows up once you switch to the real keys.
2. Add each item for sale as a Product (Dashboard → Product catalog →
   Add product): name, photo(s), description, and a one-time Price. Every
   item here is one-of-a-kind, so there's no "quantity" concept to set —
   one Product, one Price, reserved once, then archived.
3. Get both keys from Dashboard → Developers → API keys and set
   `STRIPE_SECRET_KEY` (starts `sk_`) and `STRIPE_PUBLISHABLE_KEY` (starts
   `pk_`) in Vercel's Environment Variables. The publishable key isn't a
   secret — `api/config.js` hands it to the browser on request — but it
   still comes from an env var rather than being hardcoded, so switching
   test/live mode is a Vercel setting, not a code change.
4. Add a webhook endpoint (Dashboard → Developers → Webhooks → Add
   endpoint) pointed at `https://<your-domain>/api/webhook`, listening for
   the `invoice.paid` event — that's what fires the moment an
   automatically-collected invoice actually charges a buyer's saved card,
   and it's the only thing that triggers the "you've been charged, it's
   on its way" email — sent with a real invoice PDF attached (fetched
   from Stripe's `invoice_pdf` URL, which is publicly fetchable with no
   API key needed), so the buyer gets a proper receipt regardless of any
   Stripe dashboard email setting. Copy the endpoint's signing secret into
   `STRIPE_WEBHOOK_SECRET`. Nothing else in this flow needs Stripe to call
   back into the site — reserving doesn't, and finalizing an invoice is a
   manual Dashboard action, not something the site triggers.
5. Redeploy.

Until the Stripe keys are set, `api/products.js`, `api/setup-intent.js`
and `api/order.js` all fail closed with a clear "shop is misconfigured"
message rather than silently breaking; `api/webhook.js` does the same if
`STRIPE_WEBHOOK_SECRET` is missing. Test the whole loop in Stripe's test
mode (list a test product, reserve it through the site with [a Stripe
test card](https://docs.stripe.com/testing#cards), confirm the product
auto-archives and both emails arrive, then create a test-mode invoice set
to charge automatically and confirm it actually charges the saved card
*and* that the buyer gets the "you've been charged" email) before
switching to live keys and listing anything real.

**Known gaps, by design, not oversight:**

- **No inventory reservation guarantee.** Two people submitting the order
  form on the same one-of-a-kind item within the same few seconds could
  both get through; `api/order.js` archives the product the instant the
  first request lands, which closes that window to milliseconds, but it
  isn't a hard lock. If it ever actually happens, just don't invoice the
  second order — nothing was ever charged, so there's nothing to refund.
- **Charging is entirely manual.** Nothing in this codebase finalizes a
  Stripe Invoice automatically. That's deliberate for now — see above —
  but means a forgotten order stays un-invoiced (and uncharged)
  indefinitely with no reminder beyond the original "pack this up" email.
- **An automatic charge can still fail.** Some cards require additional
  authentication (3D Secure) for a charge made without the cardholder
  present, which an off-session automatic charge can't complete on its
  own. Rare for ordinary US domestic cards, but real — if it happens,
  Stripe surfaces it in the Dashboard (and, since there's no
  `invoice.payment_failed` webhook, that's the only place it shows up —
  `api/webhook.js` only listens for `invoice.paid`); the fallback is to
  send that buyer a regular payable invoice instead.
- **The "you've been charged" email can in principle arrive twice.**
  Stripe can redeliver the same webhook event more than once; `api/webhook.js`
  doesn't deduplicate, so a retried `invoice.paid` delivery would send a
  second copy. Same tradeoff already accepted elsewhere in this codebase —
  fine at this volume, not worth the extra machinery yet.
- **Prices are all-inclusive by policy, not by calculation.** The site
  states, and `api/order.js`'s internal notification email reminds
  whoever invoices, that standard shipping (priority, via FedEx/UPS/
  another reputable carrier), tax, fees and insurance are already folded
  into the listed price — the invoice should match that number, with one
  exception: if a buyer separately asks for faster, expedited shipping,
  that cost gets added on top. Nothing in code enforces any of this,
  including the expedited case — there's no form field for requesting it
  and no calculation of what it should cost, so it's handled entirely by
  email and added to the invoice by hand. It depends on whoever prices an
  item in the Stripe Dashboard accounting for expected standard-shipping
  and insurance cost in the number they set.
- **No accounts, guest ordering only.** Deliberate — see the "what's next"
  reasoning if this ever gets revisited: one-of-a-kind inventory doesn't
  benefit much from repeat-purchase account features, and forced sign-in
  is one of the biggest causes of cart abandonment for a small, new store.

## Design system

The mark is black, white and one green, so the site is too.

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#0F0F10` | the brand's dark background — matches the icon PNG's own ground exactly |
| `--black` | `#0B0B0C` | brand ink; text on paper, and lettering on green fills |
| `--ink-2` / `--char` / `--char-2` | `#161618` `#1F2023` `#2A2B2F` | graphite steps for panels and plinths |
| `--paper` / `--paper-2` | `#F4F4F1` `#E6E6E1` | the light bands |
| `--green` | `#40B75B` | brand green, straight from the logo handoff |
| `--green-lite` | `#7BDC96` | accent text and links on dark |
| `--green-deep` | `#15773B` | accent text on paper — `--green` is only 2.3:1 there and fails |
| `--warn` | `#E0453A` | **negative states only** — declined items, invalid fields. Never decoration. |
| `--steel` / `--slate` | `#8E9398` `#585D63` | body text on dark / on paper |

**Green never carries white text.** Buttons are a green fill with `--ink`
lettering, which is both the higher-contrast pairing and the one that matches
the mark.

Type is three roles: **Archivo** for display — the weight and width axes carry
the wordmark's condensed oblique, so headlines set `font-stretch` rather than
relying on stroke contrast; **Barlow Condensed** for lot numbers, labels and
UI; **Barlow** for body copy.

Two structural rules the pages stick to:

- **Nothing is shown that doesn't exist.** The marketing pages (home,
  about, FAQ) carry no invented product cards, prices or inventory
  counts — the homepage's "what we'll be stocking" section lists
  categories, not specific items, since it doesn't know what's in stock.
  `shop.html` is the one exception, and it isn't really an exception: it
  shows real Stripe products, live, and shows nothing at all (with an
  honest "nothing listed right now" message) rather than a placeholder
  when the shelf is empty.
- **The hero is typographic.** No illustration, no mocked-up product. The
  green rules from the logo are the layout system.

The site commits to a single visual theme, so it paints every colour
explicitly rather than inheriting a host background.

## Placeholder content to replace before launch

- **Authentication partners** (Veritas, Meridian, Hallmark, Holograph) are
  invented marks standing in for real third-party authenticators. Swap them for
  your actual partners' names and licensed logos.
- **One unsettled item left, marked "Coming soon"** (`.tbd` pill): the
  business's registered street address, on Terms and Privacy. Everything
  else that used to carry this pill is now answered — dispatch time
  (about a week, not locked in), international shipping (US-only for now,
  email support@ if you're elsewhere), payment plans (no), record
  retention (3 years), governing law (US federal + Massachusetts), and
  business structure (sole proprietorship, no LLC). Search the HTML for
  `class="tbd"` to find the one that's left.
- **Privacy, Refunds and Terms are a drafted starting point, not a legally
  reviewed set of documents.** Each carries a small note box at the top saying
  so. Before relying on them: confirm the registered business address, and
  have someone who does this professionally read all three. They're
  internally consistent with each
  other and with the FAQ's existing claims (all sales final, all-inclusive
  pricing) — don't let a future edit to one contradict the others.
- **There are two live addresses, split by who's sending, not by topic:**
  `support@pandasportsmemorabilia.com` is the one shown to people — the
  footer's email icon on every page, the FAQ contact block, the homepage
  "Who we are" line, every contact point on the Refund Policy, and the two
  legal pages. `info@pandasportsmemorabilia.com` is the *From* address on
  anything the system sends automatically without a human typing it — right
  now just `api/subscribe.js`'s signup notification (see below), later any
  order-confirmation or launch-announcement email. Replies to those still
  land in `support@`, since that's the `to` address. Both mailboxes need to
  actually exist and be monitored before launch — these are the only
  contact routes on the site, so a bounce on either means a lost customer
  with no trace.
  If that split doesn't match how the two inboxes are actually set up,
  search each file for the address that's wrong rather than assuming a
  single find-and-replace fixes it — they're deliberately not identical
  across the site.
- **Jake is the one who reads and answers all of it** — not "one of the
  four of us" on rotation, which the copy claimed before this was
  corrected. His About bio and role label reflect this; if that ever
  changes, update both plus the four inline mentions of his name
  (`grep -n "Jake reads\|Jake answers"`).
- **The brand renamed from "Panda Sports Collectibles" to "Panda Sports
  Memorabilia"** after launch prep began — every occurrence of the old
  name, the old lockup text, and the old email domain has been swept and
  replaced, including deleting `assets/brand/panda-logo.png`, the one
  deployed asset that still had the old wordmark baked into it (unused by
  any page, but publicly reachable at its own URL — and the likely source
  of a Google result surfacing the old name). The GitHub repo has since
  been renamed too, to `jpt-16/pandasportsmemorabilia`.
- **The family is Josh, Jake, Nolan and Liam Twohig** — the site itself only
  ever names them by first name (last names were deliberately pulled from
  every page), and it's family-run and says that and no more. Do not
  reintroduce the last name, the family structure,
  the fact that it runs alongside other jobs, or anything else that frames
  the shop as small or part-time: it reads as a disclaimer, not as candour,
  and it costs more trust than the honesty buys.
- **No authenticator is named anywhere**, because it isn't known yet whether
  stock carries third-party authentication and, if so, from whom. The copy is
  written to hold either way: we don't write our own certificates, and the
  listing states what documentation a piece carries. If that changes, the copy
  can get stronger — but don't strengthen it before you know.
- **The social icons point nowhere.** They link to the signup until real
  profiles exist; a `CONFIRM` comment marks the spot.
- Product art is inline SVG in the `<symbol>` sprite at the top of each page.
  Replace `<use href="#i-…">` references with real photography when it's shot;
  the plinth styling is built to sit behind cut-out product shots.

## Brand assets

`assets/brand/` holds the mascot mark (replacing the original brand handoff's
panda icon) plus the original wordmark handoff.

- `panda-mark.png` — the mascot face, solid dark art on an opaque white
  background (not transparent). Use only on light grounds.
- `panda-mark-reversed.png` — the same mark in white on a transparent
  background. This is what's actually in the header and footer
  (`.lockup__mark`), since both sit on the dark `--ink` masthead/footer.
  `.lockup__mark`'s CSS aspect ratio (58×38) is tuned to this file's own
  crop — if it's ever replaced, recompute the ratio rather than reusing
  these numbers blindly.
- `favicon-16.png`, `favicon-32.png`, `apple-touch-icon-180.png` — generated
  from `panda-mark-reversed.png`, composited onto a `#0F0F10` (`--ink`)
  square so the icon's own background matches the site's actual dark theme
  regardless of the browser chrome around it. Regenerate from that source if
  the mark changes; don't hand-edit these PNGs directly.
- `panda-logo-memorabilia-horizontal.png`, `panda-logo-memorabilia-stacked.png`
  — full mark + wordmark lockups on white, used as the `og:image` /
  `twitter:image` for link previews (see each page's `<head>`). Not used
  anywhere else — the on-page wordmark is still live text (see below), not
  a flattened image, for crispness and accessibility.
- `panda-logo-memorabilia-dark.png`, `panda-logo-memorabilia-dark-badge.png`
  — the same lockups on black; the badge (circular) variant is a good fit
  for a social profile picture, but nothing in this repo wires it in
  automatically — upload it wherever that's set separately.
The wordmark is set live in **Anton**, at the proportions originally lifted
from the brand handoff's wordmark reference (not itself in this repo):
PANDA 150 / SPORTS 54 / (third line) 54, letter-spacing -3 / +10 / +8 at
that scale. The third line now reads "MEMORABILIA" (11 letters instead of
the original 12-letter word);
the same letter-spacing carries over fine, but it was tuned by eye for the
old word, so nudge it if it ever looks loose or tight against the panda
mark. Anton is headline and wordmark only, per the handoff — never body
copy. Archivo still sets the hero and section headings.

## Sitemap & robots.txt

`sitemap.xml` and `robots.txt` sit at the repo root, served as static files
at `/sitemap.xml` and `/robots.txt` (that's what Search Console needs).
The sitemap only lists the real, canonical pages a search engine should
index — home, shop, about, faq, terms, privacy, refunds — using the clean
URLs `vercel.json`'s `cleanUrls: true` actually serves (`/shop`, not
`/shop.html`; these match every page's own `og:url` meta tag). It
deliberately leaves out `product.html`, since a bare `/product` with no
`?id=` just shows a "no item was specified" state and there's no static
list of every product id to enumerate (items come and go via Stripe, not
a build step), and `shop-success.html`, since that's a post-reservation
confirmation page, not something search should send anyone to. If Search
Console still can't fetch it after a deploy, check the URL is exactly
`https://www.pandasportsmemorabilia.com/sitemap.xml` in the Search
Console property, not a `www.`-mismatched or `http://` variant.

## A note on caching

`vercel.json` sets `/assets/*` to `max-age=0, must-revalidate`. Do **not**
change this to `immutable` with a long max-age unless the filenames become
content-hashed (`styles.a1b2c3.css`). These are plain paths, so an immutable
header makes browsers serve a stale stylesheet against fresh HTML — the page
renders with new markup and old CSS, which looks like the site is broken
rather than cached. That happened once already; the `?v=2` on the stylesheet
and script links is what flushed it.

## Claims the copy makes

The site states, as fact: that stock is bought through auction houses and
dealers rather than direct from athletes; that every item arrives here before
it is listed and is checked against whatever documentation came with it; that
we never write our own certificates; that the listed price is all-inclusive —
standard shipping, tax, fees and insurance already folded in, nothing added
at invoice time except expedited shipping a buyer separately requested;
that a card is saved securely at reservation but not charged until the
order actually ships, at which point it's charged automatically; and that
every sale is final, no refunds or exchanges for any reason, including a
piece that turns out not authentic or arrives damaged. Each of those is
load-bearing — if any stops being true, change the copy the same day.

Everything else about the shop is written in the future tense on purpose. The
site says what Panda intends to do, because Panda hasn't done it yet.

No supplier is named anywhere, by choice. Where stock comes from is nobody
else's business; describing it inaccurately would be a different matter.

## Still carrying the old name

The git repository, its directory, and the Vercel project are all still
`thesportshedco`. Nothing in the site depends on them, but renaming the Vercel
project (and pointing a `pandasports` domain at it) is worth doing before this
is shared.

## Accessibility notes

Skip link, visible focus rings, `aria-expanded` on the menu, `role="status"` on
form responses, and a `prefers-reduced-motion` block that disables the hero
lift. Every accent pairing is checked: `--green-lite` on ink, `--green-deep` on
paper, and `--ink` on green fills all clear 4.5:1.
