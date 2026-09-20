Certificate-of-authenticity images for individual shop items.

Stripe's Dashboard only accepts one product photo per item, so a second
image — a piece's certificate — lives here instead, as a plain static
file. To attach one to a listing:

1. Add the image file to this folder and commit it (ask Claude to do this
   if you don't have repo access set up locally).
2. On that item's Product in the Stripe Dashboard, add a Metadata entry:
   key `certificate`, value the filename (e.g. `messi-jersey.jpg`).

`api/products.js` picks that up automatically and appends it to the
item's image gallery on the shop page.
