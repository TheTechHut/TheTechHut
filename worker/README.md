# thetechhut-pay

The Paystack backend for thetechhut.co. It is the only thing that ever holds
the secret key, which is the whole reason it exists: the site is static on
Firebase Hosting, and a static site cannot keep a secret.

It answers two questions the browser is not allowed to answer for itself —
**what does this cost** and **did this payment actually happen**.

---

## Setup, about fifteen minutes

### 1. A Cloudflare account

Free, no card. <https://dash.cloudflare.com/sign-up>

### 2. Deploy

**Run this in Terminal on your Mac**, not through Claude. Deploying needs a
Cloudflare login, and `wrangler login` opens a browser and waits for a callback
on your own machine — it cannot complete anywhere else.

```sh
cd ~/Desktop/Robbie/Projects/TheTechHut/worker
npm install             # must run on the Mac: wrangler ships per-platform binaries
npx wrangler login      # opens the browser once
npx wrangler deploy
```

That prints your Worker URL:

```
https://thetechhut-pay.<your-subdomain>.workers.dev
```

Keep it. It goes into `API_BASE` in `assets/js/pay.js`.

### 3. Set the secrets

**Never put these in a file. Never paste them into a chat, including to me.**
`wrangler secret put` reads from your terminal and sends them straight to
Cloudflare.

```sh
npx wrangler secret put PAYSTACK_SECRET_KEY   # sk_test_… for now
npx wrangler secret put REMOTE_LIST_TOKEN     # 16f1bf974ed1cd96
npx wrangler secret put RESEND_API_KEY        # optional — skip it for now
```

Each one prompts, you paste, it goes straight to Cloudflare. The value is never
written to a file and never appears in this repo.

Paystack keys: Dashboard → Settings → API Keys & Webhooks.

Without `RESEND_API_KEY` nothing breaks — the buyer still sees their access
link on screen the moment payment clears, they just do not also get an email.

### 4. Point the site at it

In `assets/js/pay.js`:

```js
var PUBLIC_KEY = 'pk_test_…';   // pk_live_… when you go live
var API_BASE   = 'https://thetechhut-pay.<your-subdomain>.workers.dev';
```

Both are safe in the repo. The public key is designed to be public.

### 5. Tell Paystack where to send events

Dashboard → Settings → API Keys & Webhooks → Webhook URL:

```
https://thetechhut-pay.<your-subdomain>.workers.dev/webhook
```

This is not optional in Kenya. M-Pesa confirmation happens on the customer's
phone and plenty of people close the tab before it lands — without the webhook
those payments are real but leave no trace on our side.

---

## Test before you take real money

Use **test** keys for all of this. Paystack's test cards are at
<https://paystack.com/docs/payments/test-payments/>.

- [ ] `curl https://<worker>/health` returns `ok: true` and the product list
- [ ] Buy the Remote List on the site; the popup opens without leaving the page
- [ ] Pay with a test card; the access link appears on screen
- [ ] The link actually opens the list
- [ ] **Check the amount Paystack reports is 500, not 5 or 50,000.** Paystack
      charges in subunits and getting it wrong is wrong by a factor of 100.
      Do not take the code's word for it, read it off the dashboard.
- [ ] Try a failing test card; nothing unlocks
- [ ] In the dashboard, resend a webhook event and confirm it returns 200
- [ ] `npm test` passes

Then swap both keys to live, redeploy, and buy something small yourself.

---

## What it refuses to do

The tests in `test/worker.test.mjs` exist for these, and they are the parts
worth keeping if the code is ever rewritten:

- **The price never comes from the browser.** The client sends a product key.
  A page that posts its own amount lets anyone pay one shilling for the bundle.
- **A payment is not real because the browser said so.** Verification calls
  Paystack with the secret key. Checking only `status` is the usual mistake —
  it accepts a KES 1 payment for a KES 1,500 product, so the amount and the
  currency are both checked too.
- **Webhooks are verified by HMAC-SHA512** against the raw body. An unsigned
  or forged event is rejected.
- **No secret key, no service.** It fails closed rather than pretending.

## Day to day

```sh
npm test                 # the suite above, no network needed
npx wrangler tail        # live logs
npx wrangler deploy      # ship a change
```

## Changing a price

`PRODUCTS` in `src/index.js` is the only place a price is decided. Change it
there, redeploy, and change the page copy to match. `LABELS` in
`assets/js/pay.js` is display only — if the two disagree, the Worker wins and
the page is the thing that is lying to the customer.
