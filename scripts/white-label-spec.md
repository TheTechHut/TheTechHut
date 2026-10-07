# A live jobs board for your community — what you actually get

Send this to anyone who asks for detail after the pitch page. It is deliberately
specific about limits, because the deals that go wrong are the ones where the
buyer expected a listings platform.

Live example: <https://thetechhut.co/jobs>

---

## The idea in one paragraph

Community job boards die because they depend on employers posting to them, and
employers will not. This one has no posting step. It reads each employer's own
recruitment system directly, in the visitor's browser, every time the page
loads. If a role is open on the employer's site it is on the board; when they
close it, it vanishes. Nobody maintains a listing, ever.

## What you receive

- A single-page jobs board on your domain, your colours, your logo.
- Up to 20 employer feeds wired up and verified working.
- Search, plus filters for job type, category, region and date posted.
- A region classifier tuned to your market — for Lagos that is
  Lagos / rest of Nigeria / remote / elsewhere, and so on.
- An "employers hiring directly" panel for the companies we cannot read, so
  your audience still gets to them.
- Deployment onto free static hosting, handed over working.
- The rate card we use to sell featured slots on ours. Use it or ignore it.

## What it runs on

A static HTML page. No server, no database, no build step, no API keys, and
nothing to renew. It calls the recruitment systems straight from the visitor's
browser, so hosting costs nothing at any traffic level and there is no bill to
be surprised by. Netlify, Vercel, GitHub Pages, Firebase Hosting or your
existing host — all fine.

## Which employers we can read

**Readable today**

| System | How we read it |
|---|---|
| Greenhouse | public board API |
| Lever | public postings API |
| Ashby | public job-board API |
| Pinpoint | public postings feed |
| SmartRecruiters | public postings API |
| WordPress careers pages | the site's own REST API |

**Not readable from a browser**

Oracle Recruiting Cloud, Oracle Taleo, Workday, SuccessFactors and JazzHR all
refuse cross-origin requests. Those employers get a link-out panel instead.
This is a limitation of their systems, not of the board, and no amount of money
changes it — anyone who tells you otherwise is planning to scrape, which breaks
terms of service and stops working without warning.

Across the Kenyan market, roughly two thirds of the employers we wanted were
readable and a third were not. Expect something similar. The free feasibility
check tells you your actual number before you pay anything.

## What it does not do

- Employers cannot post to it. There is no employer login, because there is no
  employer account. If you want a listings platform where companies upload
  jobs, this is the wrong product.
- No applicant tracking, no CV collection, no application forms. Every apply
  button opens the employer's own posting. You are a signpost, not an
  intermediary — which is also why you carry none of the data-protection risk.
- No email alerts out of the box. It can be added; say so up front.
- No salary data, because most employers do not publish it.

## Price

| | One-off | Monthly |
|---|---|---|
| Feasibility check | free | — |
| Set up and run for you | KSh 5,000 | KSh 2,500 |
| Code handed over, you maintain it | KSh 15,000 | none |

The monthly is not a hosting fee — hosting is free. It pays for fixing feeds
when employers switch systems, which happens a few times a year per board, and
for adding two new employers a month.

## How a setup goes

1. You send ten to twenty target employers. *(you)*
2. We check every one and report which are readable. *(2 working days, free)*
3. You decide to go ahead; we take the setup fee. *(you)*
4. We build it with your branding and your filters. *(about a week)*
5. You point a domain or subdomain at it. *(you, 10 minutes)*
6. It is live. Monthly starts the following month.

## Fair warnings

- A board for a non-technical community will be thin. These recruitment systems
  are a tech-sector habit.
- The first week is the honeymoon. Traffic comes from you promoting it, not
  from the board existing — budget for that.
- You will be asked for roles the board does not have. The link-out panel exists
  precisely for that moment.

---

The Tech Hut · info@thetechhut.co · +254 115 017 058
