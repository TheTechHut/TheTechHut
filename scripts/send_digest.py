#!/usr/bin/env python3
"""
The Monday openings digest.

Reads the daily snapshots in data/snapshots/, finds the Kenya-based roles that
appeared on the employer feeds in the last week, and sends them to the Brevo
list as a campaign. Runs from .github/workflows/weekly-digest.yml.

What counts as "new": a Kenya-based role (reach == 'local', the same rule the
jobs board uses) whose apply URL was not in the snapshot from about a week
earlier, and whose posting date is not stale. Nothing is sent when there is
nothing new, and a week is never sent twice (the campaign name carries the
ISO week and is checked first).

The REMOTE list (roles that employ you from Nairobi on foreign payroll) is the
paid product and is deliberately never included here.

Environment (GitHub secrets):
  BREVO_API_KEY        v3 API key
  BREVO_LIST_ID        numeric list id (same one the Worker adds people to)
  BREVO_SENDER_EMAIL   a sender verified in Brevo
  BREVO_SENDER_NAME    optional, default "The Tech Hut"

Usage:
  python3 scripts/send_digest.py --dry-run             write digest-preview.html, send nothing
  python3 scripts/send_digest.py --test you@x.com      send ONE copy to that address only
  python3 scripts/send_digest.py                       create and send the campaign
  python3 scripts/send_digest.py --force               send even if the week looks empty/duplicate

Standard library only, so a cron job never breaks on pip.
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPS = os.path.join(ROOT, 'data', 'snapshots')
CHECKLIST_JS = os.path.join(ROOT, 'worker', 'src', 'checklist.js')
SITE = 'https://thetechhut.co'
BREVO = 'https://api.brevo.com/v3'

MIN_GAP_DAYS = 3          # a baseline closer than this makes "new" meaningless
BASELINE_TARGET_DAYS = 7
STALE_AFTER_DAYS = 30     # a role posted months ago that just re-entered a feed is not news
PER_FAMILY = 15
OVERALL_CAP = 60

FAMILY_ORDER = ['engineering', 'data', 'product', 'design', 'ops']
# First match wins, so "Product Designer" is design and "Data Engineer" is data.
FAMILY_RULES = [
    ('design', r'\b(designer|design|ux|ui|graphic|illustrator)\b'),
    ('data', r'\b(data|analyst|analytics|machine learning|ml|scientist|bi)\b'),
    ('product', r'\b(product manager|product owner|product)\b'),
    ('engineering', r'\b(engineer|engineering|developer|software|backend|frontend|front-end|back-end|full[- ]?stack|devops|sre|qa|android|ios|mobile|platform|architect|cloud|security)\b'),
]


def load_checklist():
    """worker/src/checklist.js is the single source: valid JSON after `=`."""
    with open(CHECKLIST_JS, encoding='utf-8') as fh:
        src = fh.read()
    start = src.index('{', src.index('CHECKLIST'))
    end = src.rindex('}')
    return json.loads(src[start:end + 1])


def family_of(title):
    t = (title or '').lower()
    for fam, pat in FAMILY_RULES:
        if re.search(pat, t):
            return fam
    return 'ops'


def load_snapshots(snaps_dir):
    out = {}
    if not os.path.isdir(snaps_dir):
        return out
    for f in os.listdir(snaps_dir):
        m = re.fullmatch(r'(\d{4}-\d{2}-\d{2})\.json', f)
        if m:
            out[datetime.date.fromisoformat(m.group(1))] = os.path.join(snaps_dir, f)
    return out


def parse_posted(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).date()
    except ValueError:
        return None


def find_new_roles(snaps_dir, today=None):
    """-> (latest_date, baseline_date, [role, ...]) or raises ValueError with a plain reason."""
    snaps = load_snapshots(snaps_dir)
    if not snaps:
        raise ValueError('no snapshots found in ' + snaps_dir)
    latest = max(d for d in snaps if today is None or d <= today)
    candidates = [d for d in snaps if (latest - d).days >= MIN_GAP_DAYS]
    if not candidates:
        raise ValueError('not enough history: need a snapshot at least %d days older than %s' % (MIN_GAP_DAYS, latest))
    baseline = min(candidates, key=lambda d: abs((latest - d).days - BASELINE_TARGET_DAYS))

    with open(snaps[latest], encoding='utf-8') as fh:
        now = json.load(fh)
    with open(snaps[baseline], encoding='utf-8') as fh:
        before = json.load(fh)
    if now.get('failures'):
        # A feed that failed today makes yesterday's roles look "new" tomorrow.
        raise ValueError('the latest snapshot has feed failures (%s); refusing to guess what is new' % ', '.join(map(str, now['failures'])))
    seen = {r.get('url') for r in before.get('roles', [])}
    out, urls = [], set()
    for r in now.get('roles', []):
        # Himalayas rows link to Himalayas, not the employer, and the digest promises
        # employer links; they are also not feeds whose failure should matter here.
        if r.get('platform') == 'himalayas':
            continue
        if r.get('reach') != 'local' or not r.get('url') or r['url'] in seen or r['url'] in urls:
            continue
        posted = parse_posted(r.get('posted'))
        if posted and (latest - posted).days > STALE_AFTER_DAYS:
            continue
        urls.add(r['url'])
        out.append(r)
    out.sort(key=lambda r: (FAMILY_ORDER.index(family_of(r.get('title'))), (r.get('company') or '').lower(), (r.get('title') or '').lower()))
    return latest, baseline, out


def esc(s):
    return html.escape(str(s or ''), quote=True)


def build_digest(snaps_dir, today=None, checklist=None):
    checklist = checklist or load_checklist()
    latest, baseline, roles = find_new_roles(snaps_dir, today)
    n = len(roles)
    employers = len({r.get('company') for r in roles})
    iso = latest.isocalendar()
    week_label = '%d-W%02d' % (iso[0], iso[1])
    when = latest.strftime('%-d %B')
    subject = '%d new Kenyan tech opening%s this week' % (n, '' if n == 1 else 's')

    groups = {f: [r for r in roles if family_of(r.get('title')) == f] for f in FAMILY_ORDER}
    shown, parts, platforms_seen = 0, [], []
    for f in FAMILY_ORDER:
        rows = groups[f]
        if not rows:
            continue
        fam = checklist['families'][f]
        items = []
        for r in rows[:PER_FAMILY]:
            if shown >= OVERALL_CAP:
                break
            shown += 1
            plat = (r.get('platform') or '').lower()
            if plat and plat not in platforms_seen:
                platforms_seen.append(plat)
            pl = checklist['platforms'].get(plat, {}).get('label') or plat.title() or 'the employer site'
            loc = r.get('location') or 'Kenya'
            items.append(
                '<p style="margin:0 0 10px"><a href="%s" style="color:#073B4C;font-weight:700;text-decoration:none">%s</a><br>'
                '<span style="color:#4a5568;font-size:14px">%s · %s · applies through %s</span></p>'
                % (esc(r['url']), esc((r.get('title') or '').strip()), esc(r.get('company')), esc(loc), esc(pl)))
        more = len(rows) - len(items)
        parts.append(
            '<h3 style="margin:26px 0 10px;font-family:Poppins,Arial,sans-serif;font-size:17px">%s <span style="color:#4a5568;font-weight:400">(%d)</span></h3>%s%s'
            '<p style="margin:6px 0 0;font-size:13px;color:#4a5568"><b>Keywords to check your CV for:</b> %s.</p>'
            % (esc(fam['label']), len(rows), ''.join(items),
               ('<p style="margin:0;font-size:13px;color:#4a5568">+ %d more at <a href="%s/jobs/">thetechhut.co/jobs</a></p>' % (more, SITE)) if more > 0 else '',
               esc(', '.join(fam['terms']))))

    tips = ''.join(
        '<p style="margin:0 0 8px;font-size:14px"><b>%s.</b> %s</p>' % (esc(checklist['platforms'][p]['label']), esc(checklist['platforms'][p]['tip']))
        for p in platforms_seen if p in checklist['platforms'])

    body = (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
        '<p style="font-family:Poppins,Arial,sans-serif;font-weight:700;font-size:20px;margin:0 0 6px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
        '<p style="margin:0 0 20px;color:#4a5568;font-size:14px">Monday openings, week of %s</p>'
        '<p>%d new Kenya-based role%s appeared on the employer feeds we read since last week, from %d employer%s. '
        'Every link goes to the employer\'s own application page.</p>'
        '%s'
        '%s'
        '<div style="background:#f0f4f8;border-radius:12px;padding:14px 16px;margin:28px 0 0">'
        '<p style="margin:0 0 8px;font-family:Poppins,Arial,sans-serif;font-weight:700">How these systems read your CV</p>%s</div>'
        '<p style="margin:26px 0 0;font-size:14px">Looking for roles that will employ you from Nairobi on a foreign payroll? That is a separate, paid list: '
        '<a href="%s/remote/">thetechhut.co/remote</a>.</p>'
        '<hr style="border:0;border-top:1px solid #dfe6ed;margin:28px 0 14px">'
        '<p style="font-size:12px;color:#4a5568">You are receiving this because you asked for it on thetechhut.co/cv-pack. '
        '<a href="{{ unsubscribe }}" style="color:#4a5568">Unsubscribe</a> in one click.</p>'
        '</div>'
    ) % (esc(when), n, '' if n == 1 else 's', employers, '' if employers == 1 else 's',
         ''.join(parts), '', tips or '<p style="margin:0;font-size:14px">Open the guide at <a href="%s/cv-pack/">thetechhut.co/cv-pack</a>.</p>' % SITE, SITE)

    return {
        'subject': subject, 'html': body, 'count': n, 'employers': employers,
        'week': week_label, 'name': 'Monday openings ' + week_label,
        'latest': latest, 'baseline': baseline,
    }


def brevo(path, key, method='GET', payload=None):
    req = urllib.request.Request(
        BREVO + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode() or '{}'
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or '{}'
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {'message': raw[:300]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--test', metavar='EMAIL')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'digest-preview.html'))
    a = ap.parse_args(argv)

    try:
        d = build_digest(SNAPS)
    except ValueError as e:
        print('digest: nothing sent -', e)
        return 0
    print('digest: %d new roles from %d employers (%s vs %s)' % (d['count'], d['employers'], d['latest'], d['baseline']))

    if a.dry_run:
        with open(a.out, 'w', encoding='utf-8') as fh:
            fh.write(d['html'].replace('{{ unsubscribe }}', '#'))
        print('digest: preview written to', a.out)
        return 0
    if d['count'] == 0 and not a.force:
        print('digest: no new roles this week, nothing sent')
        return 0

    key = os.environ.get('BREVO_API_KEY', '')
    sender = {'name': os.environ.get('BREVO_SENDER_NAME') or 'The Tech Hut', 'email': os.environ.get('BREVO_SENDER_EMAIL', '')}
    list_id = os.environ.get('BREVO_LIST_ID', '')
    if not (key and sender['email'] and list_id.isdigit()):
        print('digest: BREVO_API_KEY, BREVO_LIST_ID and BREVO_SENDER_EMAIL must all be set', file=sys.stderr)
        return 1

    if a.test:
        status, body = brevo('/smtp/email', key, 'POST', {
            'sender': sender, 'to': [{'email': a.test}], 'subject': '[TEST] ' + d['subject'],
            'htmlContent': d['html'].replace('{{ unsubscribe }}', '#'), 'tags': ['digest-test']})
        print('digest: test email', 'sent to ' + a.test if status < 300 else 'FAILED %s %s' % (status, body))
        return 0 if status < 300 else 1

    status, body = brevo('/emailCampaigns?type=classic&limit=100&sort=desc', key)
    if status >= 300:
        print('digest: could not list campaigns: %s %s' % (status, body), file=sys.stderr)
        return 1
    if any(c.get('name') == d['name'] for c in body.get('campaigns', [])) and not a.force:
        print('digest: "%s" already exists, not sending twice' % d['name'])
        return 0

    status, body = brevo('/emailCampaigns', key, 'POST', {
        'name': d['name'], 'subject': d['subject'], 'sender': sender, 'type': 'classic',
        'htmlContent': d['html'], 'recipients': {'listIds': [int(list_id)]}})
    if status >= 300 or 'id' not in body:
        print('digest: could not create the campaign: %s %s' % (status, body), file=sys.stderr)
        return 1
    status, body2 = brevo('/emailCampaigns/%d/sendNow' % body['id'], key, 'POST')
    if status >= 300:
        print('digest: campaign %d created but sendNow failed: %s %s' % (body['id'], status, body2), file=sys.stderr)
        return 1
    print('digest: campaign %d sent' % body['id'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
