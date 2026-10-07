/* ============================================================================
   The Tech Hut — checkout.

   Paystack's popup opens on the page, so nobody leaves the site to pay.

   TWO VALUES TO SET
   -----------------
   PUBLIC_KEY  your pk_test_… key while testing, pk_live_… when you go live.
               This one is meant to be public; it is safe in this file.
   API_BASE    the Worker URL from `wrangler deploy`, e.g.
               https://thetechhut-pay.<subdomain>.workers.dev
               or https://api.thetechhut.co once the custom domain is set up.

   Leave either blank and every buy button falls back to WhatsApp with the
   product and price already written into the message. Nothing is ever broken;
   it just costs you a message instead of being automatic.

   WHAT THIS FILE DELIBERATELY DOES NOT DO
   ---------------------------------------
   It never decides a price, and it never decides that a payment succeeded.
   Both of those come from the Worker, which is the only thing holding the
   secret key. Everything here is presentation — if someone edits it in the
   console, the worst they get is a different-looking popup.
   ============================================================================ */
(function () {
    'use strict';

    var PUBLIC_KEY = '';
    var API_BASE = '';

    var WHATSAPP = '254115017058';
    var INLINE_JS = 'https://js.paystack.co/v2/inline.js';

    /* Display only. The Worker charges from its own list; if these ever
       disagree, the Worker wins and the page is the thing that is wrong. */
    var LABELS = {
        'remote-list':   { name: 'The Remote-From-Kenya List',  kes: 500 },
        'ats-pass':      { name: 'ATS Pass',                    kes: 1000 },
        'bundle':        { name: 'The Job Hunt Bundle',         kes: 1500 },
        'early-monthly': { name: 'Early Access — one month',    kes: 250 },
        'early-quarter': { name: 'Early Access — three months', kes: 600 },
        'early-annual':  { name: 'Early Access — one year',     kes: 2000 },
        'cv-blueprint':  { name: 'The CV Blueprint',            kes: 250 }
    };

    var configured = function () { return !!(PUBLIC_KEY && API_BASE); };

    function waLink(key) {
        var p = LABELS[key] || { name: key, kes: 0 };
        return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(
            'Hi, I would like to buy ' + p.name + (p.kes ? ' (KSh ' + p.kes.toLocaleString('en-KE') + ')' : '') + '.');
    }

    /* ---------------------------------------------------------------- modal */

    var CSS = [
        '.tthpay-veil{position:fixed;inset:0;background:rgba(7,59,76,.55);z-index:9998;',
        'display:flex;align-items:center;justify-content:center;padding:20px}',
        '.tthpay{background:#fff;border-radius:18px;max-width:420px;width:100%;padding:28px;',
        'box-shadow:0 24px 60px rgba(7,59,76,.3);font-family:"Inter",system-ui,sans-serif;position:relative}',
        '.tthpay h3{font-family:"Poppins","Inter",sans-serif;color:#073B4C;font-size:19px;margin:0 0 6px}',
        '.tthpay p{color:#4a5568;font-size:13.5px;margin:0 0 16px;line-height:1.6}',
        '.tthpay label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;',
        'text-transform:uppercase;color:#5b6b7b;margin:0 0 5px}',
        '.tthpay input{width:100%;box-sizing:border-box;border:1px solid rgba(7,59,76,.18);border-radius:10px;',
        'padding:12px 14px;font:inherit;font-size:14px;color:#073B4C;margin:0 0 14px;background:#fff}',
        '.tthpay input:focus{outline:0;border-color:#06D6A0}',
        '.tthpay .row{display:flex;gap:10px;align-items:center;margin-top:4px}',
        '.tthpay button{font-family:"Poppins","Inter",sans-serif;font-weight:600;font-size:14px;',
        'border:0;border-radius:9999px;padding:12px 22px;cursor:pointer}',
        '.tthpay .go{background:#06D6A0;color:#073B4C;flex:1}',
        '.tthpay .go:hover{background:#05b384;color:#fff}',
        '.tthpay .go[disabled]{opacity:.6;cursor:default}',
        '.tthpay .x{background:transparent;color:#5b6b7b;padding:12px 14px}',
        '.tthpay .err{color:#9b2020;font-size:13px;font-weight:600;margin:0 0 12px;display:none}',
        '.tthpay .amt{font-family:ui-monospace,Menlo,monospace;color:#073B4C;font-weight:700}',
        '.tthpay .ok{background:rgba(6,214,160,.12);border:1px solid rgba(6,214,160,.35);',
        'border-radius:12px;padding:14px;margin:0 0 14px;word-break:break-all}',
        '.tthpay .ok a{color:#046b52;font-weight:700}'
    ].join('');

    function styles() {
        if (document.getElementById('tthpay-css')) return;
        var s = document.createElement('style');
        s.id = 'tthpay-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function close(veil) {
        if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
        document.removeEventListener('keydown', onEsc);
    }
    var current = null;
    function onEsc(e) { if (e.key === 'Escape') close(current); }

    function modal(html) {
        styles();
        close(current);
        var veil = document.createElement('div');
        veil.className = 'tthpay-veil';
        veil.innerHTML = '<div class="tthpay" role="dialog" aria-modal="true">' + html + '</div>';
        veil.addEventListener('click', function (e) { if (e.target === veil) close(veil); });
        document.body.appendChild(veil);
        current = veil;
        document.addEventListener('keydown', onEsc);
        return veil;
    }

    /* ------------------------------------------------------------- paystack */

    var loading = null;
    function loadInline() {
        if (window.PaystackPop) return Promise.resolve();
        if (loading) return loading;
        loading = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = INLINE_JS;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load Paystack')); };
            document.head.appendChild(s);
        });
        return loading;
    }

    function api(path, body) {
        return fetch(API_BASE.replace(/\/$/, '') + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json().catch(function () { return {}; }); });
    }

    /* The popup's callback shape has changed between InlineJS versions, so the
       reference we got from /initialize is what we trust, not the callback's
       payload. Whichever way the popup closes, we ask the Worker. */
    function openPopup(accessCode) {
        return loadInline().then(function () {
            return new Promise(function (resolve) {
                var popup = new window.PaystackPop();
                var done = false;
                var finish = function (how) { if (!done) { done = true; resolve(how); } };
                var cbs = {
                    onSuccess: function () { finish('success'); },
                    onCancel: function () { finish('cancel'); },
                    onClose: function () { finish('cancel'); },
                    onError: function () { finish('error'); }
                };
                if (typeof popup.resumeTransaction === 'function') {
                    popup.resumeTransaction(accessCode, cbs);
                } else if (typeof popup.newTransaction === 'function') {
                    popup.newTransaction(Object.assign({ key: PUBLIC_KEY, accessCode: accessCode }, cbs));
                } else {
                    finish('error');
                }
            });
        });
    }

    function buy(key) {
        var p = LABELS[key] || { name: key, kes: 0 };
        if (!configured()) { window.open(waLink(key), '_blank', 'noopener'); return; }

        var veil = modal([
            '<h3>' + p.name + '</h3>',
            '<p>KSh <span class="amt">' + p.kes.toLocaleString('en-KE') + '</span> — one payment, by M-Pesa or card.',
            ' We only need an email to send your receipt and access to.</p>',
            '<p class="err" id="tthErr"></p>',
            '<label for="tthName">Your name</label>',
            '<input id="tthName" type="text" autocomplete="given-name" placeholder="First name">',
            '<label for="tthEmail">Email</label>',
            '<input id="tthEmail" type="email" autocomplete="email" placeholder="you@email.com">',
            '<div class="row"><button class="go" id="tthGo">Pay KSh ' + p.kes.toLocaleString('en-KE') + '</button>',
            '<button class="x" id="tthX">Cancel</button></div>'
        ].join(''));

        var err = veil.querySelector('#tthErr');
        var go = veil.querySelector('#tthGo');
        var email = veil.querySelector('#tthEmail');
        var name = veil.querySelector('#tthName');
        veil.querySelector('#tthX').addEventListener('click', function () { close(veil); });
        setTimeout(function () { name.focus(); }, 30);

        function fail(msg) {
            err.textContent = msg;
            err.style.display = 'block';
            go.disabled = false;
            go.textContent = 'Try again';
        }

        go.addEventListener('click', function () {
            var e = (email.value || '').trim();
            if (e.indexOf('@') < 1 || e.indexOf('.') < 2) { fail('That email does not look right.'); return; }
            err.style.display = 'none';
            go.disabled = true;
            go.textContent = 'Opening…';

            api('/initialize', { product: key, email: e, name: (name.value || '').trim() })
                .then(function (init) {
                    if (!init.access_code) throw new Error(init.error || 'could not start the payment');
                    return openPopup(init.access_code).then(function () {
                        go.textContent = 'Checking…';
                        return api('/verify', { reference: init.reference });
                    });
                })
                .then(function (res) {
                    if (!res || !res.paid) {
                        fail(res && res.reason === 'underpaid'
                            ? 'That payment came through for less than the price. Message us and we will sort it out.'
                            : 'No completed payment found yet. If you paid by M-Pesa it can take a moment — reload and we will check again.');
                        return;
                    }
                    var d = res.delivery || {};
                    modal([
                        '<h3>Thank you — that went through.</h3>',
                        '<p>' + p.name + ', KSh ' + Number(res.amount).toLocaleString('en-KE') + '.',
                        res.emailed ? ' A copy is on its way to your email.' : '',
                        '</p>',
                        d.kind === 'link'
                            ? '<div class="ok"><strong>' + d.label + '</strong><br><a href="' + d.url + '">' + d.url + '</a></div><p>' + (d.note || '') + '</p>'
                            : '<div class="ok"><strong>' + d.label + '</strong></div><p>' + (d.note || '') + '</p>',
                        '<p style="font-size:12px;color:#5b6b7b">Reference ' + res.reference + '</p>',
                        '<div class="row"><button class="go" id="tthDone">Done</button></div>'
                    ].join(''));
                    document.getElementById('tthDone').addEventListener('click', function () { close(current); });
                })
                .catch(function () {
                    fail('Something went wrong on our side. Nothing has been charged — try again, or message us on WhatsApp.');
                });
        });

        email.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go.click(); });
    }

    /* ---------------------------------------------------------------- wiring */

    function wire() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-pay]'), function (el) {
            var key = el.getAttribute('data-pay');
            if (!configured()) {
                el.setAttribute('href', waLink(key));
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener');
                return;
            }
            el.setAttribute('href', '#');
            el.removeAttribute('target');
            el.addEventListener('click', function (ev) { ev.preventDefault(); buy(key); });
        });
    }

    window.TTH_PAY = {
        buy: buy,
        isLive: configured,
        whatsapp: waLink,
        checkout: function (key) { return configured() ? '#' : waLink(key); },
        link: function (key) { return configured() ? '#' : ''; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }
})();
