/* product.html only. Reads ?id=<stripe product id> from the URL, finds
   that item in /api/products, and renders the full detail view — every
   photo (including a certificate, uncontrolled and uncropped, unlike the
   shop grid's thumbnail), the full description, and the "Reserve this
   item" flow: a card collected directly by Stripe's own embedded field
   (this script never sees the card number — Stripe.js tokenizes it and
   hands back a payment method id). Submitting saves that card on a
   Stripe Customer and reserves the item; no charge happens on this page.
   The card is charged later, automatically, once the item ships (see
   api/order.js and README.md). */
(function () {
  'use strict';

  var root = document.getElementById('product-root');
  if (!root) return;

  var crumb = document.getElementById('product-crumb');
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var CARD_STYLE = {
    base: {
      color: '#0B0B0C',
      fontFamily: '"Barlow", system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: '16px',
      '::placeholder': { color: '#585D63' }
    },
    invalid: { color: '#E0453A' }
  };

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

  function getProductId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function showMessage(html) {
    root.innerHTML = '<div class="wrap"><p class="shop-state" data-state="error">' + html + '</p></div>';
  }

  function buildGalleryHtml(images) {
    if (!images || !images.length) {
      return '<div class="product__img"></div>';
    }
    var imgs = images.map(function () {
      return '<img alt="" loading="lazy">';
    }).join('');
    var dots = images.length > 1
      ? '<div class="product__dots">' +
        images.map(function (_, i) {
          return '<span' + (i === 0 ? ' class="is-active"' : '') + '></span>';
        }).join('') +
        '</div>'
      : '';
    return '<div class="product__img"><div class="product__gallery">' + imgs + '</div>' + dots + '</div>';
  }

  function render(item, stripe) {
    document.title = item.name + ' — Panda Sports Memorabilia';
    if (crumb) crumb.textContent = item.name;

    root.innerHTML =
      '<div class="wrap">' +
      '<p class="product__back"><a href="shop.html">&larr; Back to the shop</a></p>' +
      '<div class="product">' +
      buildGalleryHtml(item.images) +
      '<div class="product__info">' +
      '<h1 class="product__name"></h1>' +
      '<p class="product__price"></p>' +
      '<p class="product__desc"></p>' +
      '<button class="btn btn--primary product__buy" type="button">Reserve this item</button>' +
      '<form class="order-form" hidden>' +
      '  <label class="sr">Full name</label>' +
      '  <input class="order-form__name" type="text" autocomplete="name" placeholder="Full name" required>' +
      '  <label class="sr">Email address</label>' +
      '  <input class="order-form__email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>' +
      '  <label class="sr">Address line 1</label>' +
      '  <input class="order-form__address1" type="text" autocomplete="address-line1" placeholder="Street address" required>' +
      '  <label class="sr">Address line 2</label>' +
      '  <input class="order-form__address2" type="text" autocomplete="address-line2" placeholder="Apt / unit (optional)">' +
      '  <label class="sr">City</label>' +
      '  <input class="order-form__city" type="text" autocomplete="address-level2" placeholder="City" required>' +
      '  <label class="sr">State</label>' +
      '  <input class="order-form__state" type="text" autocomplete="address-level1" placeholder="State" required>' +
      '  <label class="sr">ZIP code</label>' +
      '  <input class="order-form__zip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="ZIP" required>' +
      '  <label class="sr">Card details</label>' +
      '  <div class="order-form__card"></div>' +
      '  <p class="order-form__fine">US shipping only for now. Your card is saved securely with Stripe and charged automatically once your order ships &mdash; nothing is charged today.</p>' +
      '  <div class="hp" aria-hidden="true">' +
      '    <label>Leave this field blank</label>' +
      '    <input class="order-form__hp" type="text" tabindex="-1" autocomplete="off">' +
      '  </div>' +
      '  <div class="order-form__actions">' +
      '    <button class="btn btn--primary" type="submit">Confirm reservation</button>' +
      '    <button class="btn btn--ghost order-form__cancel" type="button">Cancel</button>' +
      '  </div>' +
      '  <p class="signup__msg order-form__msg" role="status"></p>' +
      '</form>' +
      '</div>' +
      '</div>' +
      '<p class="shop-legal">Team names, logos and league marks shown here belong to their respective owners &mdash; we’re an independent reseller, not affiliated with, sponsored by, or endorsed by any team, league or athlete. Condition is our own assessment unless a piece carries a third-party grading slab. See our <a href="terms.html">Terms</a> for details.</p>' +
      '</div>';

    var galleryImgs = root.querySelectorAll('.product__gallery img');
    (item.images || []).forEach(function (src, i) {
      if (galleryImgs[i]) galleryImgs[i].src = src;
    });
    root.querySelector('.product__name').textContent = item.name;
    root.querySelector('.product__desc').textContent = item.description || '';
    root.querySelector('.product__price').textContent = money(item.amount, item.currency);

    var gallery = root.querySelector('.product__gallery');
    var dots = root.querySelectorAll('.product__dots span');
    if (gallery && dots.length) {
      gallery.addEventListener('scroll', function () {
        var index = Math.round(gallery.scrollLeft / gallery.clientWidth);
        dots.forEach(function (dot, i) {
          dot.classList.toggle('is-active', i === index);
        });
      });
    }

    var buyBtn = root.querySelector('.product__buy');
    var form = root.querySelector('.order-form');
    var cancelBtn = root.querySelector('.order-form__cancel');
    var msg = root.querySelector('.order-form__msg');

    // Mounted lazily, on first reveal, rather than while the form is still
    // `hidden` — a Stripe Element mounted into a display:none container can
    // size itself to zero and stay that way even after the container
    // becomes visible.
    var cardElement = null;

    buyBtn.addEventListener('click', function () {
      buyBtn.hidden = true;
      form.hidden = false;

      if (!cardElement) {
        var elements = stripe.elements();
        cardElement = elements.create('card', { style: CARD_STYLE });
        var cardContainer = form.querySelector('.order-form__card');
        cardElement.mount(cardContainer);
        cardElement.on('focus', function () {
          cardContainer.classList.add('is-focused');
        });
        cardElement.on('blur', function () {
          cardContainer.classList.remove('is-focused');
        });
        cardElement.on('change', function (event) {
          cardContainer.classList.toggle('is-invalid', !!event.error);
        });
      }

      form.querySelector('.order-form__name').focus();
    });

    cancelBtn.addEventListener('click', function () {
      form.hidden = true;
      buyBtn.hidden = false;
      msg.textContent = '';
      delete msg.dataset.state;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var honeypot = form.querySelector('.order-form__hp').value.trim();
      var name = form.querySelector('.order-form__name').value.trim();
      var email = form.querySelector('.order-form__email').value.trim();
      var address1 = form.querySelector('.order-form__address1').value.trim();
      var address2 = form.querySelector('.order-form__address2').value.trim();
      var city = form.querySelector('.order-form__city').value.trim();
      var state = form.querySelector('.order-form__state').value.trim();
      var zip = form.querySelector('.order-form__zip').value.trim();

      if (!EMAIL_RE.test(email) || !name || !address1 || !city || !state || !zip) {
        msg.dataset.state = 'error';
        msg.textContent = 'Fill in your name, email and full shipping address.';
        return;
      }

      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      delete msg.dataset.state;
      msg.textContent = 'Saving your card…';

      var idempotencyKey =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random().toString(36).slice(2);

      fetch('/api/setup-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, company: honeypot })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { httpOk: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!(result.httpOk && result.data && result.data.ok && result.data.clientSecret)) {
            throw new Error((result.data && result.data.message) || '');
          }

          var clientSecret = result.data.clientSecret;
          var customerId = result.data.customerId;

          return stripe
            .confirmCardSetup(clientSecret, {
              payment_method: {
                card: cardElement,
                billing_details: { name: name, email: email }
              }
            })
            .then(function (setupResult) {
              if (setupResult.error) {
                throw new Error(setupResult.error.message || "That card didn't go through.");
              }

              msg.textContent = 'Reserving…';

              return fetch('/api/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  priceId: item.priceId,
                  name: name,
                  email: email,
                  address1: address1,
                  address2: address2,
                  city: city,
                  state: state,
                  zip: zip,
                  customerId: customerId,
                  paymentMethodId: setupResult.setupIntent.payment_method,
                  company: honeypot,
                  idempotencyKey: idempotencyKey
                })
              });
            });
        })
        .then(function (response) {
          return response.json().then(function (data) {
            return { httpOk: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.httpOk && result.data && result.data.ok) {
            window.location.href = 'shop-success.html';
            return;
          }
          throw new Error((result.data && result.data.message) || '');
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          msg.dataset.state = 'error';
          msg.textContent = err.message || "That didn't go through — try again in a moment.";
        });
    });
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (data) {
        return { httpOk: response.ok, data: data };
      });
    });
  }

  var productId = getProductId();
  if (!productId) {
    showMessage('No item was specified. <a href="shop.html">Back to the shop</a>.');
    return;
  }

  Promise.all([fetchJson('/api/config'), fetchJson('/api/products')])
    .then(function (results) {
      var configResult = results[0];
      var productsResult = results[1];

      if (!(configResult.httpOk && configResult.data && configResult.data.ok && configResult.data.publishableKey)) {
        throw new Error('config');
      }
      if (!(productsResult.httpOk && productsResult.data && productsResult.data.ok)) {
        throw new Error('products');
      }
      if (typeof window.Stripe !== 'function') {
        throw new Error('stripe.js');
      }

      var item = (productsResult.data.items || []).find(function (i) {
        return i.id === productId;
      });
      if (!item) {
        showMessage('Couldn’t find that item — it may already be reserved. <a href="shop.html">Back to the shop</a>.');
        return;
      }

      var stripe = window.Stripe(configResult.data.publishableKey);
      render(item, stripe);
    })
    .catch(function () {
      showMessage('Couldn’t load that item right now — refresh, or email <a href="mailto:support@pandasportsmemorabilia.com">support@pandasportsmemorabilia.com</a> if it keeps happening.');
    });
})();
