/* Homepage only. Features one specific item — currently the Messi jersey —
   by fetching /api/products (the live Stripe catalog) and checking it's
   still actually listed before showing anything. If it's been reserved
   and archived, or the id changes, the section just stays hidden rather
   than advertising something that's no longer for sale. */
(function () {
  'use strict';

  var FEATURED_ID = 'prod_VITB00w6dlJ269';

  var section = document.getElementById('spotlight');
  if (!section) return;

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (currency || 'usd').toUpperCase()
      }).format(amount / 100);
    } catch (e) {
      return '$' + (amount / 100).toFixed(2);
    }
  }

  fetch('/api/products')
    .then(function (response) {
      return response.json().then(function (data) {
        return { httpOk: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (!(result.httpOk && result.data && result.data.ok)) return;

      var item = (result.data.items || []).find(function (i) {
        return i.id === FEATURED_ID;
      });
      if (!item) return;

      var img = section.querySelector('.spotlight__img img');
      var primaryImage = (item.images && item.images[0]) || '';
      if (primaryImage) {
        img.src = primaryImage;
      } else {
        section.querySelector('.spotlight__img').remove();
      }

      section.querySelector('.spotlight__title').textContent = item.name;
      section.querySelector('.spotlight__desc').textContent =
        'One of one. Framed, Beckett-authenticated, and gone for good the moment someone reserves it — no restock, no second jersey.';
      section.querySelector('.spotlight__price').textContent = money(item.amount, item.currency);
      section.querySelector('.spotlight__cta').href = 'product.html?id=' + encodeURIComponent(item.id);

      section.hidden = false;
    })
    .catch(function () {
      /* leave the section hidden — no item to feature */
    });
})();
