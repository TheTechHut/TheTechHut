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
import urllib.error
import urllib.request

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
    ('Tala',               'lever',      'tala'),
    ('Apollo Agriculture', 'lever',      'apolloagriculture'),
    ('Supabase',           'ashby',      'supabase'),
    ('Oyster',             'ashby',      'oyster'),
    ('PostHog',            'ashby',      'posthog'),
    ('Railway',            'ashby',      'railway'),
    ('Sun King',           'pinpoint',   'sunking'),
]

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


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
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


def main():
    today = datetime.date.today().isoformat()
    os.makedirs(SNAPS, exist_ok=True)

    snapshot, failures = [], []
    for name, platform, slug in FEEDS:
        try:
            payload = get(feed_url(platform, slug))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as e:
            failures.append('%s (%s/%s): %s' % (name, platform, slug, e))
            continue
        rows = rows_from(platform, payload)
        for title, loc, url, posted in rows:
            snapshot.append({
                'company': name, 'platform': platform, 'title': title,
                'location': loc, 'url': url, 'posted': posted,
                'reach': classify(loc),
            })
        print('  %-20s %-11s %4d roles' % (name, platform, len(rows)))

    if not snapshot:
        print('every feed failed; refusing to write an empty snapshot')
        for f in failures:
            print('   ', f)
        return 1

    with open(os.path.join(SNAPS, today + '.json'), 'w') as fh:
        json.dump({'date': today, 'count': len(snapshot), 'failures': failures,
                   'roles': snapshot}, fh, separators=(',', ':'))

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
            c['roles'].append({'title': r['title'], 'location': r['location'], 'url': r['url']})

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
    return 0


if __name__ == '__main__':
    sys.exit(main())
