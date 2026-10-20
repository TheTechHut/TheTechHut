#!/usr/bin/env python3
"""
Daily hiring snapshot.

Fetches every employer feed the jobs board reads, writes a dated snapshot, and
maintains three rolling files the site and the products read:

  data/snapshots/YYYY-MM-DD.json  one day's raw rows, kept for SNAPSHOT_DAYS
                                  and then deleted (not served -- firebase.json
                                  ignores it). A day of rows is about half a
                                  megabyte, so keeping them all would put
                                  ~190MB a year into git history, permanently,
                                  for a static site. The aggregates in
                                  hiring-index.json are the part worth keeping,
                                  and they are tiny.
  data/remote-summary.json        PUBLIC. Company names, role counts and the
                                  location wording, so the sales page can show
                                  live proof the list is real and current.
                                  Deliberately carries no apply links.
  data/l/<token>.json             THE PAID FILE. Every eligible role with its
                                  apply link. The token lives in
                                  scripts/remote_token.txt, which is not served,
                                  so the only way to the file is to be given it.
                                  Rotate the token and buyers get a new URL.
  data/hiring-index.json          rolling counts per company and per skill,
                                  the raw material for a quarterly report

Runs in GitHub Actions. No dependencies beyond the standard library, because a
cron job that needs pip is a cron job that breaks.

Four kinds of source
--------------------
FEEDS      Employers' own career-page APIs (Greenhouse, Lever, Ashby, Pinpoint).
           A feed that fails is a "failure": the Monday digest refuses to guess
           what is new when one is down, so only feeds known to work belong here.
PROBATION  Same kind of feed, but not yet proven. Tried every run; a failure is
           only a note in the snapshot and never blocks anything. Move a feed up
           to FEEDS once the run log shows it answering.
Careers    Employers' own websites, read from the JobPosting markup they publish
pages      for Google. Only employers listed in scripts/careers_sources.json, each
           reviewed by a person for terms and robots.txt, and crawled slowly,
           obeying robots.txt (see scripts/careers_pages.py). A problem is a
           note, never a failure. Not part of the Monday digest yet: a site that
           is down on the baseline day would make all its roles look new.
Himalayas  An aggregator with a free public JSON API that asks for credit and a
           link back (see fetch_himalayas). Tech roles open to Kenya only, capped,
           always linked to the Himalayas listing, never part of the Monday digest
           (whose promise is "links go to the employer's own page"), and a
           problem there is a note, not a failure.

Remote.co and CareerHound are deliberately not sources: their terms forbid
scraping and building a competing list from their listings.
Boards hosted on jobs.deel.com (Deel's ATS) are not read either, even where
robots.txt allows it: Deel's Prohibited Uses (deel.com/legal) forbid robots,
spiders and crawlers collecting data from any Deel website. Employers on Deel,
such as Accelera Digital Group, are linked from /jobs/ under "Employers hiring
directly" instead.

Why "eligible" is narrow
------------------------
"Remote" on a job board usually means "remote, if you already have the right to
work in one named country". Remote, France is not open to someone in Nairobi.
Home based - EMEA is. The ELIGIBLE / BLOCKED lists below encode that difference
and they are the whole point of this script -- be careful loosening them.
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import careers_pages

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SNAPS = os.path.join(DATA, 'snapshots')

# Long enough to recompute a bad run, spot-check a week, or diff a month.
# Beyond that the rolling index already has what a report needs.
SNAPSHOT_DAYS = 45
UA = 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)'
TIMEOUT = 30

# (name, platform, slug) -- mirrors COMPANIES in jobs/index.html, plus the
# global-remote employers found to actually hire into Kenya.
FEEDS = [
    ('M-KOPA',             'ashby',      'm-kopa'),
    ('Andela',             'ashby',      'andela'),
    ('One Acre Fund',      'greenhouse', 'oneacrefund'),
    ('Jumia',              'greenhouse', 'jumia'),
    ('Zipline',            'greenhouse', 'flyzipline'),
    ('GiveDirectly',       'greenhouse', 'givedirectly'),
    ('Canonical',          'greenhouse', 'canonical'),
    ('GitLab',             'greenhouse', 'gitlab'),
    ('Elastic',            'greenhouse', 'elastic'),
    ('Cloudflare',         'greenhouse', 'cloudflare'),
    ('Mozilla',            'greenhouse', 'mozilla'),
    ('Grafana Labs',       'greenhouse', 'grafanalabs'),
    ('Cockroach Labs',     'greenhouse', 'cockroachlabs'),
    ('ConsenSys',          'greenhouse', 'consensys'),
    ('Turing',             'greenhouse', 'turing'),
    ('Moniepoint',         'greenhouse', 'moniepoint'),   # EU-hosted board, same public API
    ('Tala',               'lever',      'tala'),
    ('Apollo Agriculture', 'lever',      'apolloagriculture'),
    ('Supabase',           'ashby',      'supabase'),
    ('Oyster',             'ashby',      'oyster'),
    ('PostHog',            'ashby',      'posthog'),
    ('Railway',            'ashby',      'railway'),
    ('Sun King',           'pinpoint',   'sunking'),
]

# Employers that plausibly hire in Kenya or across Africa, but whose board slugs
# have NOT been checked against the live APIs (the build sandbox cannot reach
# them). A wrong slug costs one line in the run log. Check the log, then move the
# ones that answer into FEEDS and delete the rest.
PROBATION = [
    ('Branch International', 'greenhouse', 'branchinternational'),
    ('Deel',                 'ashby',      'deel'),
    ('Zapier',               'ashby',      'zapier'),
    ('Wave',                 'lever',      'wave'),
]

# ---- Himalayas -----------------------------------------------------------
# https://himalayas.app/jobs/api documents a free public JSON API, asks that
# anything built on it "link back to the URL found on Himalayas" and credit
# Himalayas as the source, and asks that its jobs are not resubmitted to
# Jooble, Neuvoo, Google Jobs or LinkedIn. Its site terms forbid scraping the
# website; the API is the sanctioned way in. Rows therefore always carry the
# Himalayas URL and a `via` credit.
#
# Since October 2026 Himalayas offers free API keys (himalayas.app/signup/developer).
# A key is optional: without one the script uses the shared public allowance.
# With HIMALAYAS_API_KEY set (a GitHub secret) it is sent as
# "Authorization: Bearer <key>", which gives this site its own limits. The key is
# never printed. A rejected key (HTTP 401) is reported in the notes and the run
# carries on without it. Their API terms also say every Apply action must use the
# API's applicationLink, so that is the link we keep when it points at Himalayas.
#
# Permission: in October 2026 Jack at Himalayas confirmed by email that listing
# a capped set of their tech roles, credited and linked back, in the paid
# Remote-from-Kenya list is fine under their API terms. Keep that email.
HIMALAYAS_KEY_ENV = 'HIMALAYAS_API_KEY'
HIMALAYAS_API = 'https://himalayas.app/jobs/api/search?country=KE&limit=20&page=%d'
HIMALAYAS_PAGE_SIZE = 20
HIMALAYAS_MAX_PAGES = 40        # about the newest 800 roles; polite beats complete
HIMALAYAS_KEEP = 300
HIMALAYAS_PAUSE = 1.0           # seconds between pages
HIMALAYAS_MAX_AGE_DAYS = 30
NAIROBI_UTC_OFFSET = 3
HIMALAYAS_TECH_TITLE = re.compile(
    r'\b(engineer|engineering|developer|software|devops|sre|security|data|machine learning|ml|'
    r'product manager|product owner|designer|ux|ui|qa|backend|back-end|frontend|front-end|'
    r'full[- ]?stack|mobile|android|ios|cloud|platform|architect)\b', re.I)
HIMALAYAS_TECH_CATEGORY = re.compile(r'(engineer|software|data|product|design|devops|security|machine)', re.I)

# Two very different things get called "remote", and conflating them is what
# makes every other remote job list useless to a Kenyan.
#
# GLOBAL: a company anywhere in the world will employ you while you sit in
#         Nairobi, and pay you on a non-Kenyan payroll. This is the product.
# LOCAL:  a Kenyan job. Valuable, but that is what /jobs/ is already for, and
#         putting it in a "work remotely for a foreign company" list is a lie.
GLOBAL = [
    'worldwide', 'anywhere', 'global', 'emea',
    'remote in africa', 'remote - africa', 'africa - remote', 'remote, africa',
]
LOCAL = ['kenya', 'nairobi', 'mombasa', 'kisumu', 'eldoret', 'nakuru']

# Pins a role to a single non-African country. Multi-region strings like
# "Home Based - Americas; Home based - EMEA" are still global, because EMEA is
# one of the options on offer, so this is only consulted when no GLOBAL token
# matched at all.
BLOCKED_HINT = re.compile(
    r'\b(united states|usa|u\.s\.|americas|canada|latam|apac|india|'
    r'united kingdom|ireland|germany|france|netherlands|poland|spain|italy|'
    r'sweden|norway|denmark|portugal|australia|singapore|japan|brazil|mexico|'
    r'philippines|vietnam|indonesia|turkey|israel|uae|dubai)\b', re.I)

SKILLS = [
    'python', 'javascript', 'typescript', 'java', 'golang', ' go ', 'rust',
    'react', 'vue', 'angular', 'node', 'django', 'flask', 'rails', 'laravel',
    'php', 'kotlin', 'swift', 'flutter', 'android', 'ios',
    'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'terraform',
    'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka', 'spark',
    'machine learning', 'data engineer', 'data analyst', 'data scientist',
    'devops', 'sre', 'security', 'qa', 'product manager', 'designer',
]


def get(url, headers=None):
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def feed_url(platform, slug):
    return {
        'greenhouse': 'https://boards-api.greenhouse.io/v1/boards/%s/jobs' % slug,
        'lever':      'https://api.lever.co/v0/postings/%s?mode=json' % slug,
        'ashby':      'https://api.ashbyhq.com/posting-api/job-board/%s' % slug,
        'pinpoint':   'https://%s.pinpointhq.com/postings.json' % slug,
    }[platform]


def rows_from(platform, payload):
    """Normalise each platform's shape into (title, location, url, posted)."""
    out = []
    if platform == 'greenhouse':
        for j in payload.get('jobs', []):
            loc = (j.get('location') or {}).get('name', '')
            out.append((j.get('title', ''), loc, j.get('absolute_url', ''), j.get('updated_at', '')))
    elif platform == 'lever':
        for j in payload if isinstance(payload, list) else []:
            cat = j.get('categories') or {}
            out.append((j.get('text', ''), cat.get('location', ''), j.get('hostedUrl', ''),
                        j.get('createdAt', '')))
    elif platform == 'ashby':
        for j in payload.get('jobs', []):
            out.append((j.get('title', ''), j.get('location', ''),
                        j.get('jobUrl') or j.get('applyUrl', ''), j.get('publishedAt', '')))
    elif platform == 'pinpoint':
        for j in payload.get('data', []):
            loc = j.get('location') or {}
            if isinstance(loc, dict):
                loc = loc.get('name') or loc.get('city') or ''
            out.append((j.get('title', ''), loc, j.get('url', ''), j.get('created_at', '')))
    return [(t, (l or '').strip(), u, p) for t, l, u, p in out if t]


def classify(loc):
    """-> 'global' | 'local' | '' for a location string."""
    low = (loc or '').lower()
    if any(k in low for k in GLOBAL):
        return 'global'
    if any(k in low for k in LOCAL):
        return 'local'
    return ''


def pinned_elsewhere(loc):
    """True when a location names one non-African country and nothing wider."""
    return bool(BLOCKED_HINT.search(loc or ''))


def himalayas_location(restrictions):
    """Himalayas lists the places a role is open to; an empty list means anywhere.
    -> a location string the classifier understands, or None when the role is
    pinned somewhere that excludes Kenya."""
    named = [str(x).strip() for x in (restrictions or []) if str(x).strip()]
    if not named:
        return 'Worldwide'
    low = [x.lower() for x in named]
    if 'kenya' in low:
        return 'Kenya'
    if any(x in ('worldwide', 'anywhere', 'global') for x in low):
        return 'Worldwide'
    if any(x in ('africa', 'east africa', 'sub-saharan africa') for x in low):
        return 'Remote, Africa'
    if 'emea' in low:
        return 'EMEA'
    return None


def _from_unix(value):
    try:
        return datetime.datetime.fromtimestamp(int(value), datetime.timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def himalayas_rows(payload, now=None):
    """Keep the Himalayas roles a Kenyan can take: open to Kenya by place and by
    time zone, technical, recent, not expired, and linked to Himalayas."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    out = []
    for j in (payload.get('jobs') if isinstance(payload, dict) else None) or []:
        title = str(j.get('title') or '').strip()
        company = str(j.get('companyName') or '').strip()
        apply = str(j.get('applicationLink') or '').strip()
        listing = str(j.get('guid') or '').strip()
        url = apply if apply.startswith('https://himalayas.app/') else listing
        # Only ever link to Himalayas itself: that is the credit they ask for, and
        # it means a malformed or hostile feed row cannot send a buyer elsewhere.
        if not (title and company and url.startswith('https://himalayas.app/')):
            continue
        loc = himalayas_location(j.get('locationRestrictions'))
        if loc is None:
            continue
        tz = j.get('timezoneRestrictions') or []
        if tz and NAIROBI_UTC_OFFSET not in tz:
            continue
        posted = _from_unix(j.get('pubDate'))
        if posted and (now - posted).days > HIMALAYAS_MAX_AGE_DAYS:
            continue
        expiry = _from_unix(j.get('expiryDate'))
        if expiry and expiry < now:
            continue
        cats = ' '.join(str(c) for c in list(j.get('categories') or []) + list(j.get('parentCategories') or []))
        if not (HIMALAYAS_TECH_TITLE.search(title) or HIMALAYAS_TECH_CATEGORY.search(cats)):
            continue
        out.append({
            'company': company, 'platform': 'himalayas', 'title': title, 'location': loc,
            'url': url, 'posted': posted.isoformat() if posted else '',
            'reach': classify(loc), 'via': 'Himalayas',
        })
    return out


def himalayas_key(env=None):
    """-> (key or '', note or ''). Only a plain token is accepted, so nothing odd ends up in a header."""
    raw = ((env if env is not None else os.environ).get(HIMALAYAS_KEY_ENV) or '').strip()
    if not raw:
        return '', ''
    if not re.fullmatch(r'[A-Za-z0-9._~+/=-]{8,256}', raw):
        return '', 'Himalayas: %s is set but does not look like a key; using public access' % HIMALAYAS_KEY_ENV
    return raw, ''


def fetch_himalayas(fetch=None, sleep=time.sleep, now=None, env=None):
    """-> (rows, notes). Never raises; a problem ends paging and is reported as a note.
    fetch(url, headers) returns parsed JSON; headers carry the API key when there is one."""
    fetch = fetch or get
    key, note = himalayas_key(env)
    rows, notes, seen = [], ([note] if note else []), set()
    page = 1
    while page <= HIMALAYAS_MAX_PAGES:
        headers = {'Authorization': 'Bearer ' + key} if key else {}
        try:
            payload = fetch(HIMALAYAS_API % page, headers)
        except urllib.error.HTTPError as e:
            if e.code == 401 and key:
                # Their docs: a bad key never falls back by itself. We do, once, so the list still updates.
                notes.append('Himalayas rejected the API key (HTTP 401); check the %s secret. Carried on without it.' % HIMALAYAS_KEY_ENV)
                key = ''
                continue
            notes.append('Himalayas page %d: HTTP %s%s' % (page, e.code, ' (rate limited, stopped)' if e.code == 429 else ''))
            break
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
            notes.append('Himalayas page %d: %s' % (page, e))
            break
        jobs = (payload.get('jobs') if isinstance(payload, dict) else None) or []
        if not jobs:
            break
        for r in himalayas_rows(payload, now):
            if r['url'] not in seen:
                seen.add(r['url'])
                rows.append(r)
        if len(jobs) < HIMALAYAS_PAGE_SIZE:
            break
        page += 1
        sleep(HIMALAYAS_PAUSE)
    rows.sort(key=lambda r: r['posted'], reverse=True)
    return rows[:HIMALAYAS_KEEP], notes


def fetch_careers_sources(registry=None, fetch=None, sleep=time.sleep, today=None):
    """-> (rows, notes) from the vetted employer websites in the registry. Never raises."""
    sources, notes = careers_pages.load_sources(registry or careers_pages.REGISTRY, today)
    rows = []
    for src in sources:
        try:
            got, n = careers_pages.crawl_source(src, fetch=fetch, sleep=sleep, today=today)
        except Exception as e:                # crawl_source already guards itself; this is the second net
            got, n = [], ['%s: unexpected error, skipped: %s' % (src.get('name'), e)]
        for r in got:
            r['reach'] = classify(r['location'])
        notes.extend(n)
        rows.extend(got)
        print('  %-20s %-11s %4d roles' % (src['name'], 'careers-page', len(got)))
    return rows, notes


def main():
    today = datetime.date.today().isoformat()
    os.makedirs(SNAPS, exist_ok=True)

    snapshot, failures, notes = [], [], []
    for proven, feeds in ((True, FEEDS), (False, PROBATION)):
        for name, platform, slug in feeds:
            try:
                payload = get(feed_url(platform, slug))
            except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as e:
                msg = '%s (%s/%s): %s' % (name, platform, slug, e)
                # A feed on probation is allowed to be wrong; a proven one is not.
                (failures if proven else notes).append(msg if proven else 'on probation, did not answer: ' + msg)
                continue
            rows = rows_from(platform, payload)
            for title, loc, url, posted in rows:
                snapshot.append({
                    'company': name, 'platform': platform, 'title': title,
                    'location': loc, 'url': url, 'posted': posted,
                    'reach': classify(loc),
                })
            print('  %-20s %-11s %4d roles%s' % (name, platform, len(rows), '' if proven else '   (probation: it answers, consider moving to FEEDS)'))

    # Vetted employer websites next. A role an ATS feed already carries wins.
    cp_rows, cp_notes = fetch_careers_sources()
    notes.extend(cp_notes)
    have = {(r['company'].lower(), r['title'].lower()) for r in snapshot}
    snapshot.extend(r for r in cp_rows if (r['company'].lower(), r['title'].lower()) not in have)

    # Himalayas last, and dropping any role an employer already carries, so
    # a company's own listing always wins over the aggregator's copy of it.
    hm_rows, hm_notes = fetch_himalayas()
    notes.extend(hm_notes)
    have = {(r['company'].lower(), r['title'].lower()) for r in snapshot}
    hm_rows = [r for r in hm_rows if (r['company'].lower(), r['title'].lower()) not in have]
    snapshot.extend(hm_rows)
    print('  %-20s %-11s %4d roles kept' % ('Himalayas', 'api', len(hm_rows)))

    if not snapshot:
        print('every feed failed; refusing to write an empty snapshot')
        for f in failures:
            print('   ', f)
        return 1

    with open(os.path.join(SNAPS, today + '.json'), 'w') as fh:
        json.dump({'date': today, 'count': len(snapshot), 'failures': failures,
                   'notes': notes, 'roles': snapshot}, fh, separators=(',', ':'))

    # ---- the product: public summary + token-gated full list ------------
    by_co = {}
    for r in snapshot:
        if r['reach'] != 'global':
            continue
        c = by_co.setdefault(r['company'], {
            'company': r['company'], 'platform': r['platform'],
            'eligible': 0, 'locations': [], 'roles': [],
        })
        c['eligible'] += 1
        if r['location'] not in c['locations']:
            c['locations'].append(r['location'])
        if len(c['roles']) < 40:
            role = {'title': r['title'], 'location': r['location'], 'url': r['url']}
            if r.get('via'):
                role['via'] = r['via']
            c['roles'].append(role)

    companies = sorted(by_co.values(), key=lambda c: -c['eligible'])
    totals = {c['company']: 0 for c in companies}
    for r in snapshot:
        if r['company'] in totals:
            totals[r['company']] += 1
    for c in companies:
        c['total'] = totals[c['company']]
        c['locations'] = c['locations'][:6]

    meta = {'updated': today,
            'company_count': len(companies),
            'role_count': sum(c['eligible'] for c in companies),
            'local_role_count': sum(1 for r in snapshot if r['reach'] == 'local'),
            'roles_scanned': len(snapshot)}
    if hm_rows:
        meta['sources'] = ['Himalayas']

    # public: enough to prove the list is real, nothing anyone can apply with
    summary = dict(meta)
    summary['companies'] = [{'company': c['company'], 'platform': c['platform'],
                             'eligible': c['eligible'], 'total': c['total'],
                             'locations': c['locations']} for c in companies]
    with open(os.path.join(DATA, 'remote-summary.json'), 'w') as fh:
        json.dump(summary, fh, indent=1)

    # paid: the same companies with every role and its apply link.
    # The token only ever comes from the environment. A file in this repo gets
    # published by GitHub Pages, which is exactly how the first one leaked.
    token = (os.environ.get('REMOTE_LIST_TOKEN') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,64}', token):
        print('\n!! REMOTE_LIST_TOKEN missing or malformed -- the paid list was '
              'NOT written.\n   Set it under Settings -> Secrets and variables '
              '-> Actions.\n   The public summary is still current.')
    else:
        full = dict(meta)
        full['companies'] = companies
        os.makedirs(os.path.join(DATA, 'l'), exist_ok=True)
        with open(os.path.join(DATA, 'l', token + '.json'), 'w') as fh:
            json.dump(full, fh, indent=1)
        print('paid list written for the configured token')

    # ---- data/hiring-index.json: the rolling report data ----------------
    idx_path = os.path.join(DATA, 'hiring-index.json')
    idx = {'days': {}, 'skills': {}, 'companies': {}}
    if os.path.exists(idx_path):
        try:
            idx = json.load(open(idx_path))
        except ValueError:
            pass

    skills = {}
    for r in snapshot:
        t = (' ' + r['title'] + ' ').lower()
        for s in SKILLS:
            if s in t:
                skills[s.strip()] = skills.get(s.strip(), 0) + 1

    idx.setdefault('days', {})[today] = {
        'roles': len(snapshot),
        'global': sum(1 for r in snapshot if r['reach'] == 'global'),
        'local': sum(1 for r in snapshot if r['reach'] == 'local'),
        'companies': len({r['company'] for r in snapshot}),
    }
    idx['skills'] = idx.get('skills', {})
    idx['skills'][today] = skills
    idx['companies'] = idx.get('companies', {})
    for c in companies:
        slot = idx['companies'].setdefault(c['company'], {})
        slot[today] = c['eligible']

    # keep two years, which is plenty for a quarterly report
    cutoff = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
    for key in ('days', 'skills'):
        idx[key] = {d: v for d, v in idx[key].items() if d >= cutoff}
    for co in idx['companies']:
        idx['companies'][co] = {d: v for d, v in idx['companies'][co].items() if d >= cutoff}

    with open(idx_path, 'w') as fh:
        json.dump(idx, fh, separators=(',', ':'), sort_keys=True)

    # ---- prune old raw snapshots -----------------------------------
    keep_from = (datetime.date.today() - datetime.timedelta(days=SNAPSHOT_DAYS)).isoformat()
    pruned = 0
    for name in sorted(os.listdir(SNAPS)):
        if not name.endswith('.json'):
            continue
        if name[:-5] < keep_from:
            try:
                os.remove(os.path.join(SNAPS, name))
                pruned += 1
            except OSError:
                pass
    if pruned:
        print('pruned %d snapshot(s) older than %s' % (pruned, keep_from))

    print('\nsnapshot %s: %d roles scanned, %d work-from-Kenya across %d companies, '
          '%d Kenya-based'
          % (today, len(snapshot), sum(1 for r in snapshot if r['reach'] == 'global'),
             len(companies), sum(1 for r in snapshot if r['reach'] == 'local')))
    if failures:
        print('feeds that did not answer:')
        for f in failures:
            print('   ', f)
    if notes:
        print('notes (these never block the digest):')
        for n in notes:
            print('   ', n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
