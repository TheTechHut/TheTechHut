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
npx wrangler secret put REMOTE_LIST_KEY       # the key from step 3a below
npx wrangler secret put EARLY_ACCESS_INVITE   # the Early Access WhatsApp group invite link
npx wrangler secret put RESEND_API_KEY        # optional — skip it for now
```

Each one prompts, you paste, it goes straight to Cloudflare. The value is never
written to a file and never appears in this repo.

Paystack keys: Dashboard → Settings → API Keys & Webhooks.

#### 3a. Generate the list key yourself

```sh
node scripts/encrypt_remote_list.mjs --new-key
```

The daily job encrypts the paid list with this key into
`data/remote-list.enc.json`, and the buyer's link carries it after `#`, where
`/remote/list/` uses it to decrypt the list in their browser. The repo and the
site only ever hold the encrypted file. Paste the key into **two** places and
nowhere else:

- `wrangler secret put REMOTE_LIST_KEY` (above), so the Worker can build the
  buyer's link
- GitHub → Settings → Secrets and variables → Actions → **REMOTE_LIST_KEY**,
  so the daily job can encrypt the list

Do not put it in a file in this repo. GitHub Pages publishes this repository,
so a key in a file is a public key — that is exactly how the first token
leaked, at `https://thetechhut.co/scripts/remote_token.txt`. A new key retires
every old link: email buyers the new one with
`worker/scripts/send-communities-access.mjs --product remote-list`. Do not paste it
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

## The Daily Savannah weekly roundup (second list)

One Worker, one Brevo account and one API key serve both mailings, but each
product has **its own Brevo list** so people only get what they asked for. The
Worker picks the list from the `product` in the signup request (`cv-pack` is the
default, so older pages keep working; `daily` is the Daily Savannah).

```
signup boxes on /blog/ , /blog/daily/ and the end of every edition
   ──POST /subscribe {product:"daily"}──▶ Worker ──▶ Brevo: confirmation email
link in that email ─▶ /blog/daily/welcome/#t=… ──POST /confirm──▶ Worker
   ──▶ Brevo: add to the DAILY list  +  short welcome email

Sundays 04:30 UTC (07:30 Nairobi): .github/workflows/weekly-roundup.yml
   scripts/send_roundup.py ──▶ Brevo campaign to the DAILY list
```

### Setup

1. **Second list.** *Contacts → Lists → Create a list* named `Daily Savannah`. Note its ID.
   The account, the API key, the verified sender and `SUBSCRIBE_SECRET` are all reused.
2. **Worker secret**, then redeploy (the new code adds the product routing):

   ```sh
   npx wrangler secret put BREVO_LIST_ID_DAILY    # the number from step 1
   npx wrangler deploy
   ```

3. **GitHub secret**: `BREVO_LIST_ID_DAILY` (the existing `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME` are reused). Do **not** change
   `BREVO_LIST_ID`: that is still the CV Pack list.
4. **Check**: `/health` should show both `"newsletter": true` and `"newsletterDaily": true`.
   Sign up on a live Daily Savannah page with your own address, confirm, then run
   **Weekly Daily Savannah roundup** by hand with your address in `test_email`.

### Things worth knowing

- **The roundup covers the seven days that ended yesterday** (on Sunday 18 Oct:
  Sun 11 to Sat 17 Oct). Weeks tile with no gap or overlap, and the Sunday edition
  that goes out with the email is covered the next week.
- **It only includes editions committed to the branch**, so push the week's
  editions before Sunday 07:30 Nairobi time. A week with fewer than three editions
  is skipped unless you tick `force`, and a week is never sent twice (the
  campaign name carries the ISO week).
- **Adding another product** is one entry in `PRODUCTS` and `MAILS` in
  `worker/src/newsletter.js` (its list secret, confirm page and wording), a confirm
  page, a privacy-policy paragraph, and a test.
- Tests: `npm test` (Worker) and
  `python3 -m unittest scripts/tests/test_send_roundup.py scripts/tests/test_send_digest.py`.

---

## The daily job alert (/jobs/daily/)

A third product on the same signup Worker: people subscribe on
`/jobs/daily/`, confirm on `/jobs/daily/welcome/`, and land on their own
Brevo list. Every morning, right after the **Daily hiring snapshot** workflow
succeeds, `.github/workflows/daily-jobs.yml` runs
`scripts/send_digest.py --daily`, which emails the roles, in any country, that are
new since the previous day whose feeds all answered (never more than three days
back), skipping anything seen in the past week, including the same role re-posted
under a new link. Nothing is sent on a day with no new roles, and a date is never sent twice
(the campaign is named `Daily openings YYYY-MM-DD`). Roles open to remote hires anywhere are the paid Remote
list and are never included; Kenya-based roles are listed first in each field.

### Setup

1. **Third list.** In Brevo, *Contacts → Lists → Create a list* named `Daily job alert`. Note its ID.
2. **Worker secret**, then redeploy:

   ```sh
   npx wrangler secret put BREVO_LIST_ID_JOBS    # the number from step 1
   npx wrangler deploy
   ```

3. **GitHub secret**: `BREVO_LIST_ID_JOBS`. The existing `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME` are reused.
4. **Check**: `/health` shows `"newsletterJobs": true`. Sign up on `/jobs/daily/`
   with your own address, confirm, then run **Daily job alert** by hand with your
   address in `test_email` (or tick `dry_run`).

---

## The prompt marketplace (/prompt-marketplace/)

Community members post AI prompts, free or paid, and buy each other's. Code:
`src/market.js` (one Durable Object, `Market`) and `prompt-marketplace/index.html`.

- **Accounts:** email only. `POST /market/login` emails a sign-in link (Brevo) that
  works once, for 20 minutes; the page swaps it for a signed 60-day session kept in
  the browser. The first sign-in creates the account. No passwords are stored.
- **Money:** Paystack split payments. When a seller saves a payout bank account we
  create a Paystack **subaccount** with `percentage_charge: 10`, so each sale sends
  90% to the seller (Paystack settles them directly) and 10% to The Tech Hut.
  Paystack's fee comes out of the seller's share (`bearer: subaccount`). Prices are
  always taken from the server; a paid prompt only unlocks after `/transaction/verify`
  (or the `charge.success` webhook) shows the full amount in KES.
- **Rules:** free prompts need no payout account; paid ones cost KES 50–20,000; 20
  new prompts per member per day; a prompt reported 5 times is hidden; a sold prompt
  that its seller removes stays with its buyers.

### Setup

1. **Paystack:** make sure split payments / subaccounts are enabled on your Kenyan
   account (Settings → Subaccounts). Test in test mode first: add a payout account,
   post a KES 50 prompt, buy it from another email, and check the split in the dashboard.
2. **Worker secret**, then deploy (adds the `Market` Durable Object, migration v3):

   ```sh
   npx wrangler secret put MARKET_SECRET    # any long random string
   npx wrangler deploy
   ```

   Optional: set `MARKET_ADMINS` (comma-separated emails) under `[vars]` to let those
   accounts remove any prompt.
3. **Check:** `/health` shows `"market": true`. Sign in on /prompt-marketplace/ with
   your own email.

Tests: `node test/market.test.mjs` (part of `npm test`).

---

## The games arcade (live count, visits, leaderboards)

`/games/` shows how many people are on the games pages, total visits, and
three weekly leaderboards: most played games, top players and longest
sittings. Everything lives in one Durable Object, `GameStats`
(`src/games.js`). The page scripts are `assets/js/games-live.js` (pings,
shared with the player page) and `assets/js/games-arcade.js` (the boards and
the player card).

### Setup

The binding and migration are in `wrangler.toml`, so a deploy from the Mac
creates everything:

```sh
cd ~/Desktop/Robbie/Projects/TheTechHut/worker
npx wrangler deploy
```

Until that deploy, the page hides the counter and the arcade instead of
showing errors. Totals start from zero on the first deploy.

### Sign in with Google (optional)

Players can always join with a nickname. To also offer Google sign-in, which
puts a verified tick next to the nickname:

1. In Google Cloud console: APIs & Services → Credentials → Create
   credentials → OAuth client ID → Web application. Under "Authorised
   JavaScript origins" add `https://thetechhut.co` and
   `https://www.thetechhut.co`. No redirect URI is needed.
2. Put the client id in `GOOGLE_CLIENT_ID` in `wrangler.toml` and at the top
   of `assets/js/games-arcade.js`.
3. `npx wrangler secret put GAMES_SECRET` and paste any long random string
   (`openssl rand -base64 32`). It signs player ids; changing it later gives
   Google players new ids.
4. `npx wrangler deploy`, then push the site.

The Worker checks Google's token itself and keeps only a scrambled id, never
the email.

### How it counts

- **Online now**: tabs that have pinged in the last 75 seconds.
- **Visits**: one per tab session on `/games/`; at most 30 an hour per IP.
- **Play time**: only on the player page, only while it is on screen. Each
  ping adds the time since that tab's last ping, at most 35 seconds. A
  player's time counts once however many tabs they open, and one IP earns
  time in at most six tabs at once.
- **Players**: only people who joined with a nickname or Google appear on
  the player boards. Rude nicknames are refused (the list is in `games.js`).
- **Weeks** run Monday 00:00 to Sunday 23:59 Nairobi time. Player records are
  kept for 12 months; "Leave the leaderboard" deletes all of them.
- **New games**: add the slug to `src/game-slugs.js` as well as
  `assets/js/games-data.js` and redeploy; `npm test` fails if they differ.

### Things worth knowing

- Writes are batched once a minute, so a busy week stays inside the free
  plan's Durable Object limits. The limit to watch is Worker requests: each
  player costs about two a minute, and the free plan allows 100,000 a day
  (about 800 hours of play), shared with payments and signups.
- The boards are public at `GET /games/board` (cached for 20 seconds).
- To check it from Terminal:
  `curl -s https://thetechhut-pay.thetechhut.workers.dev/games/board`

## Checkout protection (bots)

`src/payguard.js`. Bots were calling `/initialize` with made-up details, and
every call left a customer and an abandoned transaction in Paystack. Before
the Worker calls Paystack now, a checkout must:

1. come from one of our pages (`Origin`), with the hidden `website` field empty;
2. pass Cloudflare Turnstile, once `TURNSTILE_SECRET` is set (below);
3. be inside the limits: 5 per IP per 10 minutes, 20 per IP a day, 6 per email
   and 6 per WhatsApp number a day, 200 overall an hour (`LIMITS`);
4. use an email whose domain exists and takes mail (MX over DNS-over-HTTPS).

The `PayGuard` Durable Object keeps the counters (as SHA-256 hashes, never the
email or number) and one record per order, so a receipt is emailed once per
payment however often `/verify` or the webhook fire. `/health` shows
`checkoutGuard` and `turnstile` so you can see both are on.

### Switching on Turnstile

1. Cloudflare dashboard → Turnstile → Add widget. Hostnames `thetechhut.co`
   and `www.thetechhut.co`; widget mode **Managed**.
2. Put the **site key** in `TURNSTILE_SITE_KEY` at the top of
   `assets/js/pay.js` and deploy the site.
3. Then set the **secret key** on the Worker:
   `npx wrangler secret put TURNSTILE_SECRET`
   (in that order: the Worker only demands the check once it has the secret).

## African Tech Community Database delivery

A paid `communities` order shows the database link on the page and emails it
(`/verify` and the webhook, once per payment). The link is the secret
`COMMUNITIES_URL` (a `https://….notion.site/…` page), not a file, because this
repo is public. Receipts go through Resend if `RESEND_API_KEY` is set,
otherwise through Brevo with the newsletter key and sender.

People who bought before this: `scripts/send-communities-access.mjs` reads
their orders from Paystack and sends them the same email. Dry run by default;
instructions at the top of the file.

### The members page (replaces the public Notion page)

`/communities/db/` shows the database only to people holding the access link
`https://thetechhut.co/communities/db/#<key>`. The list is stored encrypted in
`data/communities.enc.json`; the key is the part after `#`, which never reaches
any server. Source and key live in `private/` (git-ignored). To update the list,
export the Notion page as Markdown to `private/communities-export.md` and run
`node scripts/build_communities.mjs`. To retire a leaked link, run it with
`--new-key`, set the new link as `COMMUNITIES_URL`, and email buyers.
