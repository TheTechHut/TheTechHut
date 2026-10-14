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
npx wrangler secret put REMOTE_LIST_TOKEN     # the value from step 3a below
npx wrangler secret put EARLY_ACCESS_INVITE   # the Early Access WhatsApp group invite link
npx wrangler secret put RESEND_API_KEY        # optional — skip it for now
```

Each one prompts, you paste, it goes straight to Cloudflare. The value is never
written to a file and never appears in this repo.

Paystack keys: Dashboard → Settings → API Keys & Webhooks.

#### 3a. Generate the list token yourself

```sh
openssl rand -hex 16
```

Paste that same value into **two** places and nowhere else:

- `wrangler secret put REMOTE_LIST_TOKEN` (above), so the Worker can build the
  buyer's link
- GitHub → Settings → Secrets and variables → Actions → **REMOTE_LIST_TOKEN**,
  so the daily job knows what to name the file

Do not put it in a file in this repo. GitHub Pages publishes this repository,
so a token in a file is a public token — that is exactly how the first one
leaked, at `https://thetechhut.co/scripts/remote_token.txt`. Do not paste it
into a chat either, including to me: I do not need it, and a transcript is one
more copy of it.

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

---

## The CV Pack email list (Brevo)

`/cv-pack/` collects an email and sends the person a keyword checklist, then a
digest of new Kenya-based openings every Monday. The Worker handles signup and
the GitHub Action sends the digest. Brevo holds the list and does the
unsubscribing.

```
form on /cv-pack/ ──POST /subscribe──▶ Worker ──▶ Brevo: confirmation email
                                                   (nothing is on the list yet)
link in that email ─▶ /cv-pack/welcome/#t=… ──POST /confirm──▶ Worker
                         ──▶ Brevo: add to list  +  welcome email with the checklist

Mondays 04:30 UTC: .github/workflows/weekly-digest.yml
   scripts/send_digest.py ──▶ Brevo campaign to the list (has Brevo's unsubscribe link)
```

### Setup, about twenty minutes

1. **Brevo account.** <https://www.brevo.com> (the free plan works to start; see
   limits below).
2. **Sender.** *Senders, Domains & Dedicated IPs*: add `thetechhut.co` as a domain and
   add the DNS records Brevo shows (DKIM and DMARC) wherever the domain's DNS lives,
   then add and verify the sender address (for example `hello@thetechhut.co`).
   Skip the DNS step and the confirmation emails will mostly land in spam.
3. **List.** *Contacts → Lists → Create a list* named `CV Pack`. Note its numeric ID.
4. **Attributes (optional).** *Contacts → Settings → Contact attributes*: add two text
   attributes, `ROLE` and `SOURCE`. Without them people are still added, just without
   their target role.
5. **API key.** *SMTP & API → API keys → Generate*. Do not paste it into a chat or a file.
6. **Worker secrets**, from `worker/` in your own Terminal:

   ```sh
   npx wrangler secret put BREVO_API_KEY
   npx wrangler secret put BREVO_LIST_ID          # the number from step 3
   npx wrangler secret put BREVO_SENDER_EMAIL     # the verified sender from step 2
   npx wrangler secret put SUBSCRIBE_SECRET       # paste the output of: openssl rand -hex 32
   npx wrangler secret put BREVO_SENDER_NAME      # optional, default "The Tech Hut"
   npx wrangler deploy
   ```

7. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_SENDER_EMAIL`, and optionally `BREVO_SENDER_NAME`.
   The Action runs only if `chore/redesign` is the default branch, same as the
   daily snapshot.

### Check it works

```sh
curl https://thetechhut-pay.<your-subdomain>.workers.dev/health   # "newsletter": true
```

Then sign up on the live page with your own address, click the link in the
email, press the button, and confirm the checklist arrives and you appear in the
Brevo list. To test the digest, run the **Weekly openings digest** workflow by
hand with your address in `test_email`: one copy goes to you and nobody else.

### Things worth knowing

- **Only Kenya-based roles** go in the digest. The remote-from-Kenya list is the
  paid product and is never included.
- **The week can be thin.** The feeds currently carry roughly 30 Kenya-based roles
  in total, so a typical week has a handful of new ones. When there are none, the
  Action sends nothing rather than an empty email, and it will not send the same
  ISO week twice. It also refuses to send if the latest snapshot had a feed failure,
  because a failed feed makes old roles look new.
- **Brevo's free plan has a daily sending cap** (300 emails a day when this was
  written; check current limits). Every confirmation, every welcome and every
  digest recipient counts. A list much larger than that needs a paid plan, or the
  digest will not reach everyone.
- **Spam protection is light**: an address check, a hidden honeypot field and a
  confirmation step. Someone could still make the form send confirmation emails to
  addresses they do not own, and each one counts against the cap. If that happens,
  add a Cloudflare rate-limiting rule on `/subscribe`.
- The keyword checklist lives in one place, `worker/src/checklist.js`, which the
  welcome email and the digest both read. Edit it there.
- Tests: `npm test` (Worker) and `python3 -m unittest scripts/tests/test_send_digest.py`.
