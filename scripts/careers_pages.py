#!/usr/bin/env python3
"""
Careers-page source: read job postings straight from an employer's own website,
but only from employers that have been checked, and only the way the site allows.

Why this is not "scrape everything"
-----------------------------------
Most company sites forbid bots in their terms or in robots.txt, and this list is
a paid product. So nothing here crawls an employer until someone has read that
employer's terms and robots.txt and written the result into
scripts/careers_sources.json (see "Registry" below). The code then adds its own
limits on top, every run:

  * robots.txt is fetched first and obeyed for every URL requested. If it cannot
    be read (server error, 401/403, 429, network failure) the site is skipped:
    "could not check" is treated as "no".
  * The crawler identifies itself (TheTechHutBot, with a link) and waits between
    requests: at least MIN_PAUSE seconds, longer if robots.txt asks for it.
  * Only https, only the employer's own host, redirects off that host are
    dropped, pages are capped at MAX_BYTES, and each source is capped at
    max_jobs pages per run.
  * Only structured JobPosting data (schema.org JSON-LD, the markup employers
    publish for Google) is read. Nothing is scraped out of page layout.
  * Only a title, a location, a date and the link are kept. Job descriptions
    are never stored, so there is nothing to republish.
  * A problem is a note in the snapshot. It never blocks the Monday digest.

Registry: scripts/careers_sources.json
--------------------------------------
{"sources": [{
    "name":          "Acme",
    "careers_url":   "https://acme.com/careers",
    "sitemap":       "https://acme.com/jobs-sitemap.xml",   optional
    "job_url_pattern": "^https://acme\\.com/careers/[a-z0-9-]+/?$",   optional but
                     needed to follow links or a sitemap; without it only
                     postings on the careers page itself are read
    "max_jobs":      40,                                    optional
    "allowed_by":    "terms-and-robots-reviewed" | "written-permission",
    "reviewed_on":   "2026-10-15",   the day someone read the terms and robots.txt
    "review_note":   "what the terms say, in a sentence",
    "enabled":       true
}]}

An entry with no valid allowed_by, or a reviewed_on older than REVIEW_VALID_DAYS,
is skipped with a note, so approvals expire and get looked at again. To stop
crawling a company (for instance if they ask), set "enabled": false or delete
the entry.

Usage:
  python3 scripts/careers_pages.py --check https://acme.com/careers [--pattern REGEX]
      Report what this crawler would do on that site: robots.txt verdict, whether
      JobPosting data is there, a few sample rows. Fetches at most a handful of
      pages. Run it from your own machine or GitHub Actions; it does not add the
      site to the registry.

Standard library only.
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = os.path.join(ROOT, 'scripts', 'careers_sources.json')

UA_TOKEN = 'TheTechHutBot'
UA = 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)'
TIMEOUT = 20
MAX_BYTES = 1000000
MIN_PAUSE = 2.0
MAX_PAUSE = 10.0                # a Crawl-delay above this is honoured only up to here
REVIEW_VALID_DAYS = 180
DEFAULT_MAX_JOBS = 40
HARD_MAX_JOBS = 100
SITEMAP_INDEX_CHILDREN = 3
ALLOWED_BY = ('terms-and-robots-reviewed', 'written-permission')

WORLDWIDE = ('worldwide', 'anywhere', 'global', 'earth', 'all countries', 'world')


# ---- fetching ------------------------------------------------------------

def http_fetch(url):
    """-> (status, text, final_url). status is None when the request itself failed."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xml,text/plain;q=0.9'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read(MAX_BYTES + 1)
            return r.status, raw[:MAX_BYTES].decode('utf-8', 'replace'), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, '', url
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None, '', url


def host_of(url):
    return (urllib.parse.urlsplit(url).hostname or '').lower()


def bare_host(host):
    return host[4:] if host.startswith('www.') else host


def same_site(url, careers_url):
    """The employer's own site: same host, or a subdomain of it (jobs.acme.com for acme.com)."""
    h, base = host_of(url), bare_host(host_of(careers_url))
    return bool(h) and (bare_host(h) == base or h.endswith('.' + base))


# ---- robots.txt ----------------------------------------------------------

class Robots:
    """What robots.txt lets us do on one site. Unknown means no."""

    def __init__(self, parser=None, blocked_reason='', sitemaps=None, delay=None):
        self.parser = parser
        self.blocked_reason = blocked_reason
        self.sitemaps = sitemaps or []
        self.delay = delay

    def allowed(self, url):
        if self.blocked_reason:
            return False
        return self.parser is None or self.parser.can_fetch(UA_TOKEN, url)


def load_robots(careers_url, fetch):
    parts = urllib.parse.urlsplit(careers_url)
    url = '%s://%s/robots.txt' % (parts.scheme, parts.netloc)
    status, text, _ = fetch(url)
    if status is None:
        return Robots(blocked_reason='robots.txt could not be fetched (network error)')
    if status in (401, 403, 429) or status >= 500:
        return Robots(blocked_reason='robots.txt answered HTTP %s, so the site is skipped' % status)
    if status != 200:
        return Robots()                       # 404 and friends: no robots.txt, nothing forbidden
    if re.match(r'\s*<', text) or '<html' in text[:500].lower():
        return Robots()                       # a web app answering every path with its page, not a robots file
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    rp.modified()                             # without this can_fetch() refuses everything
    delay = rp.crawl_delay(UA_TOKEN)
    return Robots(parser=rp, sitemaps=list(rp.site_maps() or []), delay=delay)


# ---- registry ------------------------------------------------------------

def load_sources(path=REGISTRY, today=None):
    """-> (sources, notes). Only fully reviewed, unexpired, enabled entries come back."""
    today = today or datetime.date.today()
    notes = []
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return [], []
    except ValueError as e:
        return [], ['careers registry is not valid JSON: %s' % e]
    out = []
    for i, s in enumerate(data.get('sources', []) if isinstance(data, dict) else []):
        name = str(s.get('name') or '#%d' % (i + 1))
        if s.get('enabled') is False:
            continue
        url = s.get('careers_url') or ''
        if not url.startswith('https://') or not host_of(url):
            notes.append('careers source %s skipped: careers_url must be an https URL' % name)
            continue
        if s.get('allowed_by') not in ALLOWED_BY:
            notes.append('careers source %s skipped: allowed_by must be one of %s' % (name, ', '.join(ALLOWED_BY)))
            continue
        try:
            reviewed = datetime.date.fromisoformat(str(s.get('reviewed_on')))
        except ValueError:
            notes.append('careers source %s skipped: reviewed_on is missing or not a date' % name)
            continue
        age = (today - reviewed).days
        if age > REVIEW_VALID_DAYS or age < 0:
            notes.append('careers source %s skipped: terms review from %s is out of date, re-check and update reviewed_on' % (name, reviewed))
            continue
        pattern = s.get('job_url_pattern')
        if pattern:
            try:
                re.compile(pattern)
            except re.error as e:
                notes.append('careers source %s skipped: job_url_pattern is not a valid regex (%s)' % (name, e))
                continue
        out.append(s)
    return out, notes


# ---- JobPosting extraction -----------------------------------------------

LD_JSON = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
TAGS = re.compile(r'<[^>]+>')


def _clean(text, limit=200):
    return re.sub(r'\s+', ' ', html.unescape(TAGS.sub(' ', str(text or '')))).strip()[:limit]


def _walk(node):
    if isinstance(node, list):
        for n in node:
            yield from _walk(n)
    elif isinstance(node, dict):
        yield node
        for key in ('@graph', 'itemListElement', 'item'):
            if key in node:
                yield from _walk(node[key])


def job_postings(page_html):
    """Every schema.org JobPosting object in the page's JSON-LD blocks."""
    found = []
    for block in LD_JSON.findall(page_html or ''):
        data = None
        for candidate in (block.strip(), html.unescape(block.strip())):
            try:
                data = json.loads(candidate)
                break
            except ValueError:
                continue
        if data is None:
            continue
        for obj in _walk(data):
            kind = obj.get('@type')
            kinds = kind if isinstance(kind, list) else [kind]
            if 'JobPosting' in kinds:
                found.append(obj)
    return found


def _names(value):
    """Place/Country/AdministrativeArea objects or plain strings -> list of names."""
    out = []
    for v in value if isinstance(value, list) else [value]:
        if isinstance(v, dict):
            v = v.get('name') or v.get('addressCountry')
            if isinstance(v, dict):
                v = v.get('name')
        if isinstance(v, str) and v.strip():
            out.append(_clean(v, 60))
    return out


def location_text(obj):
    """A location string in the wording the board's eligibility rules already understand."""
    remote = str(obj.get('jobLocationType') or '').upper() == 'TELECOMMUTE'
    if remote:
        names = _names(obj.get('applicantLocationRequirements'))
        if not names:
            return 'Remote'                   # remote, but open to whom is not stated: not counted as eligible
        if any(w in n.lower() for n in names for w in WORLDWIDE):
            return 'Worldwide'
        return 'Remote, ' + ', '.join(names[:4])
    places = []
    locs = obj.get('jobLocation')
    for loc in locs if isinstance(locs, list) else [locs]:
        if not isinstance(loc, dict):
            continue
        addr = loc.get('address')
        if isinstance(addr, dict):
            bits = [_names(addr.get(k)) for k in ('addressLocality', 'addressRegion', 'addressCountry')]
            text = ', '.join(b[0] for b in bits if b)
        else:
            text = ', '.join(_names(addr)) or ', '.join(_names(loc.get('name')))
        if text and text not in places:
            places.append(text)
    return '; '.join(places[:3])


def _date(value):
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def posting_row(obj, page_url, company, careers_url, today=None):
    """A JobPosting -> snapshot row, or None. Keeps title, place, date and link; never the description."""
    today = today or datetime.date.today()
    title = _clean(obj.get('title') or obj.get('name'))
    if not title:
        return None
    until = _date(obj.get('validThrough'))
    if until and until < today:
        return None
    link = obj.get('url') if isinstance(obj.get('url'), str) else ''
    if not (link.startswith('https://') and same_site(link, careers_url)):
        link = page_url
    if not (link.startswith('https://') and same_site(link, careers_url)):
        return None
    posted = _date(obj.get('datePosted'))
    return {
        'company': company, 'platform': 'careers-page', 'title': title,
        'location': location_text(obj), 'url': link,
        'posted': posted.isoformat() if posted else '',
    }


# ---- discovery -----------------------------------------------------------

HREF = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\']', re.I)


def page_links(page_html, base_url, pattern):
    if not pattern:
        return []
    rx = re.compile(pattern)
    out = []
    for href in HREF.findall(page_html or ''):
        url = urllib.parse.urljoin(base_url, html.unescape(href)).split('#')[0]
        if rx.search(url) and url not in out:
            out.append(url)
    return out


def sitemap_urls(sitemap_url, pattern, fetch, robots, careers_url, sleep, pause, budget):
    """URLs from a sitemap (or the first few children of a sitemap index) that match pattern.
    budget is a one-item list: requests still allowed this run."""
    rx = re.compile(pattern)
    out, queue, seen = [], [sitemap_url], set()
    children = 0
    while queue and budget[0] > 0:
        url = queue.pop(0)
        if url in seen or not same_site(url, careers_url) or not robots.allowed(url):
            continue
        seen.add(url)
        sleep(pause)
        budget[0] -= 1
        status, text, final = fetch(url)
        if status != 200 or not same_site(final, careers_url):
            continue
        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            continue
        locs = [(el.text or '').strip() for el in root.iter() if el.tag.endswith('}loc') or el.tag == 'loc']
        if root.tag.endswith('sitemapindex'):
            for loc in locs:
                if children < SITEMAP_INDEX_CHILDREN:
                    queue.append(loc)
                    children += 1
        else:
            out.extend(u for u in locs if rx.search(u))
    return out


# ---- one source ----------------------------------------------------------

def crawl_source(src, fetch=None, sleep=time.sleep, today=None):
    """-> (rows, notes). Never raises."""
    fetch = fetch or http_fetch
    name, careers = src['name'], src['careers_url']
    pattern = src.get('job_url_pattern')
    max_jobs = max(1, min(int(src.get('max_jobs') or DEFAULT_MAX_JOBS), HARD_MAX_JOBS))
    rows, notes, seen_rows, visited = [], [], set(), set()
    try:
        robots = load_robots(careers, fetch)
        if robots.blocked_reason:
            return [], ['%s: %s' % (name, robots.blocked_reason)]
        if not robots.allowed(careers):
            return [], ['%s: robots.txt disallows the careers page, not crawled' % name]
        pause = max(MIN_PAUSE, min(MAX_PAUSE, float(robots.delay or 0)))
        budget = [max_jobs + 6]               # every request after robots.txt comes out of this

        def get(url):
            sleep(pause)
            budget[0] -= 1
            status, text, final = fetch(url)
            if status == 200 and not same_site(final, careers):
                return None, '', final        # redirected off the employer's site
            return status, text, final

        def take(page_html, page_url):
            got = 0
            for obj in job_postings(page_html):
                row = posting_row(obj, page_url, name, careers, today)
                key = (row['url'], row['title'])
                if row and key not in seen_rows:
                    seen_rows.add(key)
                    rows.append(row)
                    got += 1
            return got

        status, text, final = get(careers)
        if status != 200:
            return [], ['%s: careers page answered %s' % (name, status if status else 'nothing')]
        visited.add(careers)
        take(text, final)
        candidates = page_links(text, final, pattern)

        sitemap = src.get('sitemap')
        sitemaps = [sitemap] if sitemap else robots.sitemaps[:2]
        if pattern:
            for sm in sitemaps:
                candidates += sitemap_urls(sm, pattern, fetch, robots, careers, sleep, pause, budget)

        fetched = 0
        for url in dict.fromkeys(candidates):
            if fetched >= max_jobs or budget[0] <= 0:
                notes.append('%s: stopped at the %d-page cap, more postings exist' % (name, max_jobs))
                break
            if url in visited or not same_site(url, careers):
                continue
            if not robots.allowed(url):
                notes.append('%s: robots.txt disallows %s, skipped' % (name, url))
                continue
            fetched += 1
            visited.add(url)
            status, page, final = get(url)
            if status == 200:
                take(page, final)
        if not rows:
            notes.append('%s: no JobPosting data found (the site may not publish it, or the pattern matched nothing)' % name)
    except Exception as e:                    # a bad site must never stop the daily snapshot
        notes.append('%s: unexpected error, skipped: %s' % (name, e))
    return rows, notes


# ---- CLI check -----------------------------------------------------------

def check(url, pattern=None, fetch=None, sleep=time.sleep):
    """What would the crawler do on this site? -> list of report lines."""
    fetch = fetch or http_fetch
    lines = []
    if not url.startswith('https://'):
        return ['careers URL must start with https://']
    robots = load_robots(url, fetch)
    if robots.blocked_reason:
        return ['BLOCKED: ' + robots.blocked_reason]
    lines.append('robots.txt: %s' % ('allows the careers page' if robots.allowed(url) else 'DISALLOWS the careers page'))
    lines.append('crawl-delay: %s' % (robots.delay if robots.delay else 'none stated (we wait %.0fs anyway)' % MIN_PAUSE))
    lines.append('sitemaps listed: %s' % (', '.join(robots.sitemaps) or 'none'))
    if not robots.allowed(url):
        lines.append('Stop here: do not add this site to the registry.')
        return lines
    src = {'name': host_of(url), 'careers_url': url, 'job_url_pattern': pattern, 'max_jobs': 3}
    rows, notes = crawl_source(src, fetch=fetch, sleep=sleep)
    lines.append('postings read: %d (sample limited to 3 pages)' % len(rows))
    for r in rows[:5]:
        lines.append('  - %s | %s | %s' % (r['title'], r['location'] or '(no location)', r['url']))
    lines += ['note: ' + n for n in notes]
    lines.append('This does NOT check the site\'s terms of use. Read them, then add the entry to scripts/careers_sources.json.')
    return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', metavar='URL', required=True)
    ap.add_argument('--pattern', metavar='REGEX')
    a = ap.parse_args(argv)
    print('\n'.join(check(a.check, a.pattern)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
