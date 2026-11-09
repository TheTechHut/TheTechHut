#!/usr/bin/env python3
"""
The Monday openings digest, and the daily job alert (--daily).

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

Daily mode (--daily) sends the same kind of email every morning to the
daily jobs list (thetechhut.co/jobs/daily): roles that are new since the most
recent earlier snapshot without feed failures, at most 3 days back. It uses
BREVO_LIST_ID_JOBS instead of BREVO_LIST_ID, includes roles in any country
(except those open to remote hires anywhere, which are the paid list), sends nothing on a day with no
new roles, and never sends the same date twice. Runs from
.github/workflows/daily-jobs.yml.

Usage:
  python3 scripts/send_digest.py --daily [--dry-run | --test EMAIL]
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
PER_FAMILY = 6
OVERALL_CAP = 30
DAILY_PER_FAMILY = 5      # kept short: the rest of the day's roles are one link away on the jobs board
DAILY_OVERALL_CAP = 20

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
    """ISO date/time, or a unix epoch in seconds or milliseconds (Lever sends
    milliseconds) -> date, or None."""
    if s is None or s == '' or isinstance(s, bool):
        return None
    if isinstance(s, (int, float)):
        try:
            secs = s / 1000.0 if s > 1e11 else s
            return datetime.datetime.fromtimestamp(secs, datetime.timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace('Z', '+00:00')).date()
    except ValueError:
        return None


DAILY_MAX_GAP_DAYS = 3    # daily: compare with the previous clean day, never older than this
DAILY_MEMORY_DAYS = 7     # daily: a role seen on any clean day this past week is not new again


def _job_key(r):
    norm = lambda x: re.sub(r'\W+', ' ', (x or '').lower()).strip()
    return 'k:' + norm(r.get('company')) + '|' + norm(r.get('title')) + '|' + norm(r.get('location'))


def _clean(path):
    with open(path, encoding='utf-8') as fh:
        return not json.load(fh).get('failures')


def find_new_roles(snaps_dir, today=None, daily=False):
    """-> (latest_date, baseline_date, [role, ...]) or raises ValueError with a plain reason."""
    snaps = load_snapshots(snaps_dir)
    if not snaps:
        raise ValueError('no snapshots found in ' + snaps_dir)
    latest = max(d for d in snaps if today is None or d <= today)
    if daily:
        if today is not None and latest != today:
            raise ValueError('no snapshot for %s yet (latest is %s)' % (today, latest))
        # The previous day whose feeds all answered: a feed that failed on the
        # baseline day would make all of its roles look new today.
        candidates = sorted((d for d in snaps if 1 <= (latest - d).days <= DAILY_MAX_GAP_DAYS and _clean(snaps[d])), reverse=True)
        if not candidates:
            raise ValueError('no clean snapshot in the %d days before %s' % (DAILY_MAX_GAP_DAYS, latest))
        baseline = candidates[0]
    else:
        candidates = [d for d in snaps if (latest - d).days >= MIN_GAP_DAYS]
        if not candidates:
            raise ValueError('not enough history: need a snapshot at least %d days older than %s' % (MIN_GAP_DAYS, latest))
        baseline = min(candidates, key=lambda d: abs((latest - d).days - BASELINE_TARGET_DAYS))

    with open(snaps[latest], encoding='utf-8') as fh:
        now = json.load(fh)
    with open(snaps[baseline], encoding='utf-8') as fh:
        before = json.load(fh)
    extra_seen = set()
    if daily:
        # Some feeds drop a role for a day and bring it back; without this it
        # would be emailed as new each time it reappears.
        for d in snaps:
            if d != baseline and 1 <= (latest - d).days <= DAILY_MEMORY_DAYS and _clean(snaps[d]):
                with open(snaps[d], encoding='utf-8') as fh:
                    extra_seen.update(r.get('url') for r in json.load(fh).get('roles', []))
                    fh.seek(0)
                    extra_seen.update(_job_key(r) for r in json.load(fh).get('roles', []))
    if now.get('failures'):
        # A feed that failed today makes yesterday's roles look "new" tomorrow.
        raise ValueError('the latest snapshot has feed failures (%s); refusing to guess what is new' % ', '.join(map(str, now['failures'])))
    seen = {r.get('url') for r in before.get('roles', [])} | extra_seen
    if daily:
        # The same opening re-posted under a new link is not news either.
        seen |= {_job_key(r) for r in before.get('roles', [])}
    out, urls = [], set()
    for r in now.get('roles', []):
        # Himalayas rows link to Himalayas, not the employer, and the digest promises
        # employer links; they are also not feeds whose failure should matter here.
        if r.get('platform') in ('himalayas', 'jobicy', 'remoteok'):
            continue
        # Careers-page rows are skipped for now: a site that failed on the baseline
        # day would make every one of its roles look new. Revisit once a few
        # sources have a clean run history.
        if r.get('platform') == 'careers-page':
            continue
        # Weekly: Kenya-based roles only. Daily: roles in any country, except those
        # open to remote hires anywhere (reach 'global'), which are the paid list.
        if (r.get('reach') == 'global') if daily else (r.get('reach') != 'local'):
            continue
        if not r.get('url') or r['url'] in seen or r['url'] in urls:
            continue
        if daily and _job_key(r) in seen:
            continue
        posted = parse_posted(r.get('posted'))
        if posted and (latest - posted).days > STALE_AFTER_DAYS:
            continue
        urls.add(r['url'])
        out.append(r)
    out.sort(key=lambda r: (FAMILY_ORDER.index(family_of(r.get('title'))), r.get('reach') != 'local',
                            (r.get('company') or '').lower(), (r.get('title') or '').lower()))
    return latest, baseline, out


def esc(s):
    return html.escape(str(s or ''), quote=True)


INK, MINT, GREEN, TEXT, MUTED, DIM, RULE, PAPER2 = '#073B4C', '#06D6A0', '#046B52', '#2D3B45', '#4A5568', '#5B6B7B', '#CFE0E6', '#F7FAFC'
SERIF = "Newsreader,Georgia,'Times New Roman',serif"
SANS = "'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif"
MONO = "'IBM Plex Mono',Menlo,Consolas,monospace"
REMOTE_SUMMARY = os.path.join(ROOT, 'data', 'remote-summary.json')


def remote_numbers():
    """Live counts for the Remote-From-Kenya List call to action, or None."""
    try:
        with open(REMOTE_SUMMARY, encoding='utf-8') as fh:
            d = json.load(fh)
        if int(d.get('role_count') or 0) > 0 and int(d.get('company_count') or 0) > 0:
            return int(d['role_count']), int(d['company_count'])
    except (OSError, ValueError, TypeError):
        pass
    return None


def _label(text, color=GREEN):
    return ('<p style="margin:0 0 8px;font-family:%s;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:%s">%s</p>'
            % (MONO, color, text))


def render_email(*, kicker, headline, intro, sections, remote, why, preheader, luck='Good luck this week.'):
    """One self-contained, table-based HTML email: header, sections, product CTA, close.
    Inline styles throughout, so it holds up in Gmail, Outlook and phone mail apps."""
    cta = ''
    if remote:
        roles, cos = remote
        cta = (
            '<tr><td style="padding:8px 28px 8px">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:%s;border-radius:4px">'
            '<tr><td style="padding:22px 24px 24px">'
            '%s'
            '<p style="margin:0 0 10px;font-family:%s;font-size:24px;line-height:1.2;font-weight:700;color:#ffffff">'
            'Work from Nairobi, <em style="color:%s;font-weight:500">paid from abroad.</em></p>'
            '<p style="margin:0 0 18px;font-family:%s;font-size:16px;line-height:1.55;color:#CFE0E6">'
            '<b style="color:#ffffff">%s remote roles at %d companies</b> that hire from Kenya, in the Remote-From-Kenya List.</p>'
            '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:%s;border-radius:3px">'
            '<a href="%s/remote/?utm_source=email&amp;utm_medium=%s" style="display:inline-block;padding:13px 22px;font-family:%s;font-size:16px;font-weight:700;color:%s;text-decoration:none">'
            'Get the list for KES 500 &rarr;</a></td></tr></table>'
            '</td></tr></table></td></tr>'
        ) % (INK, _label('From The Tech Hut', MINT), SERIF, MINT, SANS, '{:,}'.format(roles), cos, MINT, SITE,
             'daily-alert' if 'daily' in why else 'weekly-digest', SANS, INK)

    return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">'
        '<title>%(headline)s</title>'
        '<style>@media (max-width:620px){.px{padding-left:18px!important;padding-right:18px!important}.h1{font-size:30px!important}}</style>'
        '</head><body style="margin:0;padding:0;background:%(paper2)s">'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0">%(preheader)s</div>'
        '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:%(paper2)s"><tr><td align="center" style="padding:24px 10px">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%%;max-width:600px;background:#ffffff;border:1px solid %(rule)s">'

        # 1. header
        '<tr><td style="background:%(ink)s;padding:14px 28px" class="px">'
        '<span style="font-family:%(serif)s;font-size:22px;font-weight:700;color:#ffffff">The Tech Hut<span style="color:%(mint)s">.</span></span>'
        '</td></tr>'
        '<tr><td style="padding:30px 28px 22px;border-bottom:3px double %(ink)s" class="px">'
        '%(kicker)s'
        '<h1 class="h1" style="margin:0 0 12px;font-family:%(serif)s;font-size:36px;line-height:1.1;font-weight:700;color:%(ink)s">%(headline)s</h1>'
        '<p style="margin:0;font-family:%(sans)s;font-size:17px;line-height:1.55;color:%(muted)s">%(intro)s</p>'
        '</td></tr>'

        # 2. body sections
        '%(sections)s'

        # all of today's roles
        '<tr><td style="padding:14px 28px 22px" class="px">'
        '<a href="%(site)s/jobs/" style="font-family:%(sans)s;font-size:15px;font-weight:700;color:%(green)s">See every open role on the jobs board &rarr;</a>'
        '</td></tr>'

        # 3. call to action
        '%(cta)s'

        # 4. close
        '<tr><td style="padding:22px 28px 14px" class="px">'
        '<p style="margin:0;font-family:%(sans)s;font-size:15px;line-height:1.55;color:%(text)s">'
        '%(luck)s &mdash; <span style="font-family:%(serif)s;color:%(ink)s">The Tech Hut</span></p>'
        '</td></tr>'
        '<tr><td style="padding:16px 28px 20px;border-top:1px solid %(rule)s" class="px">'
        '<p style="margin:0;font-family:%(sans)s;font-size:12px;line-height:1.6;color:%(dim)s">'
        'You asked for this on %(why)s. <a href="{{ unsubscribe }}" style="color:%(dim)s">Unsubscribe</a> &middot; '
        '<a href="mailto:info@thetechhut.co" style="color:%(dim)s">info@thetechhut.co</a></p>'
        '</td></tr>'
        '</table></td></tr></table></body></html>'
    ) % {
        'headline': esc(headline), 'preheader': esc(preheader), 'kicker': _label(kicker), 'intro': intro,  # kicker is fixed text and dates, already HTML
        'sections': sections,
        'cta': cta, 'why': esc(why), 'site': SITE, 'luck': esc(luck),
        'green': GREEN, 'ink': INK, 'mint': MINT, 'text': TEXT, 'muted': MUTED, 'dim': DIM, 'rule': RULE, 'paper2': PAPER2,
        'serif': SERIF, 'sans': SANS, 'mono': MONO,
    }


def build_digest(snaps_dir, today=None, checklist=None, daily=False):
    checklist = checklist or load_checklist()
    latest, baseline, roles = find_new_roles(snaps_dir, today, daily)
    n = len(roles)
    employers = len({r.get('company') for r in roles})
    iso = latest.isocalendar()
    week_label = '%d-W%02d' % (iso[0], iso[1])
    when = latest.strftime('%-d %B')
    s_ = '' if n == 1 else 's'
    es = '' if employers == 1 else 's'
    if daily:
        subject = '%d new opening%s today' % (n, s_)
        kicker = 'Daily openings &middot; %s' % latest.strftime('%A %-d %B')
        since = 'since yesterday' if (latest - baseline).days == 1 else 'since %s' % baseline.strftime('%A')
        why = 'thetechhut.co/jobs/daily'
        headline = subject
        intro = 'From %d employer%s, %s. Each link opens the employer\'s own application page.' % (employers, es, since)
    else:
        subject = '%d new Kenyan tech opening%s this week' % (n, s_)
        kicker = 'Monday openings &middot; week of %s' % when
        since = 'since last week'
        why = 'thetechhut.co/cv-pack'
        headline = '%d new opening%s in Kenya this week' % (n, s_)
        intro = 'Kenya-based roles from %d employer%s, %s. Each link opens the employer\'s own application page.' % (employers, es, since)

    groups = {f: [r for r in roles if family_of(r.get('title')) == f] for f in FAMILY_ORDER}
    shown, sections = 0, []
    for f in FAMILY_ORDER:
        rows = groups[f]
        if not rows:
            continue
        fam = checklist['families'][f]
        items = []
        for r in rows[:DAILY_PER_FAMILY if daily else PER_FAMILY]:
            if shown >= (DAILY_OVERALL_CAP if daily else OVERALL_CAP):
                break
            shown += 1
            loc = r.get('location') or ('Location not listed' if daily else 'Kenya')
            items.append(
                '<tr><td style="padding:9px 0;border-bottom:1px solid %s">'
                '<a href="%s" style="font-family:%s;font-size:16px;line-height:1.3;font-weight:700;color:%s;text-decoration:none">%s</a>'
                '<p style="margin:2px 0 0;font-family:%s;font-size:14px;line-height:1.4;color:%s">'
                '<b style="color:%s">%s</b> &middot; %s</p>'
                '</td></tr>'
                % (RULE, esc(r['url']), SANS, INK, esc((r.get('title') or '').strip()), SANS, MUTED, TEXT,
                   esc(r.get('company')), esc(loc)))
        if not items:
            continue
        more = len(rows) - len(items)
        more_html = ('<p style="margin:12px 0 0;font-family:%s;font-size:14px;color:%s">+ %d more %s role%s on '
                     '<a href="%s/jobs/" style="color:%s;font-weight:700">the jobs board</a></p>'
                     % (SANS, MUTED, more, esc(fam['label']).lower(), '' if more == 1 else 's', SITE, GREEN)) if more > 0 else ''
        sections.append(
            '<tr><td style="padding:20px 28px 4px" class="px">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr>'
            '<td style="border-top:2px solid %s;padding-top:10px">'
            '<span style="font-family:%s;font-size:20px;font-weight:700;color:%s">%s</span>'
            '<span style="font-family:%s;font-size:13px;color:%s;margin-left:8px">%d new</span>'
            '</td></tr></table>'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0">%s</table>%s'
'</td></tr>'
            % (INK, SERIF, INK, esc(fam['label']), MONO, GREEN, len(rows), ''.join(items), more_html))

    body = render_email(kicker=kicker, headline=headline, intro=intro, sections=''.join(sections),
                        remote=remote_numbers(), why=why,
                        preheader='%d new role%s from %d employer%s, %s.' % (n, s_, employers, es, since),
                        luck='Good luck today.' if daily else 'Good luck this week.')

    return {
        'subject': subject, 'html': body, 'count': n, 'employers': employers,
        'week': week_label, 'name': ('Daily openings ' + latest.isoformat()) if daily else ('Monday openings ' + week_label),
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
    ap.add_argument('--daily', action='store_true', help='daily job alert to BREVO_LIST_ID_JOBS')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'digest-preview.html'))
    a = ap.parse_args(argv)

    try:
        today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date() if a.daily else None
        d = build_digest(SNAPS, today=today, daily=a.daily)
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
        print('digest: no new roles, nothing sent')
        return 0

    key = os.environ.get('BREVO_API_KEY', '')
    sender = {'name': os.environ.get('BREVO_SENDER_NAME') or 'The Tech Hut', 'email': os.environ.get('BREVO_SENDER_EMAIL', '')}
    list_env = 'BREVO_LIST_ID_JOBS' if a.daily else 'BREVO_LIST_ID'
    list_id = os.environ.get(list_env, '')
    if not (key and sender['email'] and list_id.isdigit()):
        print('digest: BREVO_API_KEY, %s and BREVO_SENDER_EMAIL must all be set' % list_env, file=sys.stderr)
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
