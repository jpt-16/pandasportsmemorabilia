/* Shop page only. Fetches the live product list from /api/products
   (which reads straight from Stripe's Product catalog — that's the
   inventory system, there's no separate database) and renders a
   browsable grid. Each card links to product.html?id=<product id> —
   that's where the full gallery, description and "Reserve this item"
   flow live (see assets/js/product.js). This page itself doesn't touch
   Stripe at all. */
(function () {
  'use strict';

  var root = document.getElementById('shop-root');
  if (!root) return;

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

  function buildCard(item) {
    var li = document.createElement('li');
    li.className = 'shop-card';
    var primaryImage = (item.images && item.images[0]) || null;

    li.innerHTML =
      '<a class="shop-card__link" href="product.html?id=' + encodeURIComponent(item.id) + '">' +
      '<div class="shop-card__img">' +
      (primaryImage ? '<img alt="" loading="lazy">' : '') +
      '</div>' +
      '<div class="shop-card__body">' +
      '<h3 class="shop-card__name"></h3>' +
      '<p class="shop-card__desc"></p>' +
      '<p class="shop-card__price"></p>' +
      '<span class="shop-card__cta"></span>' +
      '</div>' +
      '</a>';

    var img = li.querySelector('img');
    if (img) img.src = primaryImage;
    li.querySelector('.shop-card__name').textContent = item.name;
    li.querySelector('.shop-card__desc').textContent = item.description || '';
    if (item.priceTbd) {
      li.querySelector('.shop-card__price').innerHTML = '<span class="tbd">Price &mdash; not final yet</span>';
    } else {
      li.querySelector('.shop-card__price').textContent = money(item.amount, item.currency);
    }
    li.querySelector('.shop-card__cta').textContent = item.priceTbd
      ? 'See details'
      : 'See details & reserve';

    return li;
  }

  function render(items) {
    if (!items.length) {
      root.innerHTML =
        '<p class="shop-state">Nothing listed right now — check back soon, or ' +
        '<a href="index.html#notify">leave your email</a> to hear the moment something goes up.</p>';
      return;
    }
    var grid = document.createElement('ul');
    grid.className = 'shop-grid';
    items.forEach(function (item) {
      grid.appendChild(buildCard(item));
    });
    root.innerHTML = '';
    root.appendChild(grid);
  }

  fetch('/api/products')
    .then(function (response) {
      return response.json().then(function (data) {
        return { httpOk: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (result.httpOk && result.data && result.data.ok) {
        render(result.data.items || []);
        return;
      }
      throw new Error();
    })
    .catch(function () {
      root.innerHTML =
        '<p class="shop-state" data-state="error">Couldn’t load the shop right now — refresh, ' +
        'or email <a href="mailto:support@pandasportsmemorabilia.com">support@pandasportsmemorabilia.com</a> ' +
        'if it keeps happening.</p>';
    });
})();
