/* ============================================================================
   The Tech Hut — Paystack checkout links, all in one place.

   HOW TO USE THIS FILE
   --------------------
   Create a payment page in your Paystack dashboard (Storefront → Payment
   Pages), copy its link, and paste it next to the matching key below. That is
   the only edit needed — every buy button on the site reads from here.

   While a key is empty the button still works: it opens WhatsApp with the
   product name and price already written, so you can take the payment by hand.
   Nothing is ever broken, it just costs you a message.

   Paystack settlement for a Kenyan account is KES, and it accepts M-Pesa and
   cards, which is why it is the default here over a manual till number.

   Keep the amount in the comment matching the amount on the Paystack page. If
   they drift, the page is lying to the customer, and the page is what they read.
   ============================================================================ */
(function () {
    'use strict';

    var PAYSTACK = {
        /* new products — create these */
        'remote-list':    '',                                     /* KSh   500  */
        'ats-pass':       '',                                      /* KSh 1,000  */
        'bundle':         '',                                      /* KSh 1,500  */
        'early-monthly':  '',                                      /* KSh   250  */
        'early-quarter':  '',                                      /* KSh   600  */
        'early-annual':   '',                                      /* KSh 2,000  */

        /* already live — these are your existing Paystack pages */
        'cv-blueprint':   'https://paystack.shop/pay/tpzhsf8a1w',  /* KSh   250  */
        'seo-kit':        'https://paystack.shop/pay/559v-00uot'   /* KES 4,500  */
    };

    var WHATSAPP = '254115017058';

    function waLink(label) {
        return 'https://wa.me/' + WHATSAPP + '?text=' +
            encodeURIComponent('Hi, I would like to buy ' + (label || 'a product') + '.');
    }

    var api = {
        /* '' when the key has no Paystack page yet */
        link: function (key) {
            return PAYSTACK[key] || '';
        },
        /* the Paystack page if it exists, otherwise a pre-written WhatsApp message */
        checkout: function (key, label) {
            return PAYSTACK[key] || waLink(label);
        },
        isLive: function (key) {
            return !!PAYSTACK[key];
        },
        whatsapp: waLink
    };

    /* Any element with data-pay="<key>" becomes a checkout button.
       data-pay-label is what gets written into the WhatsApp message. */
    function wire() {
        var nodes = document.querySelectorAll('[data-pay]');
        Array.prototype.forEach.call(nodes, function (el) {
            var key = el.getAttribute('data-pay');
            var label = el.getAttribute('data-pay-label') || key;
            el.setAttribute('href', api.checkout(key, label));
            if (!api.isLive(key)) {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener');
            }
        });
    }

    window.TTH_PAY = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }
})();
