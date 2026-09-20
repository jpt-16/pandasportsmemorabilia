/* Panda Sports Memorabilia — site behaviour.
   Three small jobs: the mobile menu, the email signups, and the FAQ
   accordions. No dependencies. */
(function () {
  'use strict';

  /* ---------- mobile menu ---------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');

  if (burger && nav) {
    var setMenu = function (open) {
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        burger.focus();
      }
    });
  }

  /* ---------- email signup (hero + footer) ----------
     Posts to /api/subscribe (a Vercel serverless function — see that
     file) which adds the address to a Resend audience. The honeypot
     field rides along unfilled by real visitors; a bot that fills every
     field trips it server-side. */
  var valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  document.querySelectorAll('form.signup').forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var honeypot = form.querySelector('input[name="company"]');
    var msg = form.querySelector('.signup__msg');
    var button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = input.value.trim();

      if (!valid.test(email)) {
        input.setAttribute('aria-invalid', 'true');
        msg.dataset.state = 'error';
        msg.textContent = 'That address looks incomplete — check for a typo and try again.';
        input.focus();
        return;
      }

      input.removeAttribute('aria-invalid');
      input.disabled = true;
      button.disabled = true;
      delete msg.dataset.state;
      msg.textContent = 'Adding you\u2026';

      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          company: honeypot ? honeypot.value : ''
        })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { httpOk: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.httpOk && result.data && result.data.ok) {
            msg.dataset.state = 'ok';
            msg.textContent = "You're on the list. We'll email you the day we open.";
            return;
          }
          throw new Error((result.data && result.data.message) || '');
        })
        .catch(function (err) {
          input.disabled = false;
          button.disabled = false;
          msg.dataset.state = 'error';
          msg.textContent =
            err.message ||
            "That didn't go through \u2014 try again in a moment, or email support@pandasportsmemorabilia.com directly.";
        });
    });

    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid');
        msg.textContent = '';
        delete msg.dataset.state;
      }
    });
  });
})();

/* FAQ / consign accordions (<details class nothing, targeted via .qa).
   Native <details> has no open/close transition — content just pops.
   Animate height with the Web Animations API: hardware-accelerated,
   interruptible (a fast double-click doesn't glitch), no library.
   Mirrors the --ease-out token in styles.css — keep both in sync. */
(function () {
  'use strict';

  var items = document.querySelectorAll('.qa details');
  if (!items.length) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

  items.forEach(function (details) {
    var summary = details.querySelector('summary');
    var body = details.querySelector('.qa__body');
    if (!summary || !body) return;

    var animation = null;
    var isClosing = false;
    var isExpanding = false;

    summary.addEventListener('click', function (e) {
      if (reduceMotion) return; // let the native toggle happen instantly
      e.preventDefault();
      if (isClosing || !details.open) {
        expand();
      } else if (isExpanding || details.open) {
        shrink();
      }
    });

    function shrink() {
      isClosing = true;
      var startHeight = details.offsetHeight + 'px';
      var endHeight = summary.offsetHeight + 'px';
      if (animation) animation.cancel();
      animation = details.animate(
        { height: [startHeight, endHeight] },
        { duration: 220, easing: EASE_OUT }
      );
      animation.onfinish = function () { onFinish(false); };
      animation.oncancel = function () { isClosing = false; };
    }

    function expand() {
      details.style.height = details.offsetHeight + 'px';
      details.open = true;
      window.requestAnimationFrame(function () {
        isExpanding = true;
        var startHeight = details.offsetHeight + 'px';
        var endHeight = summary.offsetHeight + body.offsetHeight + 'px';
        if (animation) animation.cancel();
        animation = details.animate(
          { height: [startHeight, endHeight] },
          { duration: 260, easing: EASE_OUT }
        );
        animation.onfinish = function () { onFinish(true); };
        animation.oncancel = function () { isExpanding = false; };
      });
    }

    function onFinish(open) {
      details.open = open;
      animation = null;
      isClosing = false;
      isExpanding = false;
      details.style.height = '';
    }
  });
})();
