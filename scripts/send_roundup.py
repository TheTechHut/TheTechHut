#!/usr/bin/env python3
"""
The Daily Savannah weekly roundup.

Reads the edition fragments in blog/daily/_src/editions/ (the same files
scripts/build_daily.py turns into pages), picks the editions dated in the seven
days that ended yesterday, and sends them to the Daily Savannah Brevo list as
one campaign. Runs from .github/workflows/weekly-roundup.yml on Sunday morning.

Why "the seven days that ended yesterday": on Sunday 18 Oct that is Sun 11 Oct
to Sat 17 Oct. Each week then starts where the last one stopped, so no edition
is sent twice and none is skipped. The edition for the Sunday the email goes out
is covered the following week.

A week is never sent twice (the campaign name carries the ISO week and is
checked first), and a week with fewer than MIN_EDITIONS editions is not sent
unless you pass --force, so a gap in publishing does not produce a thin email.

This list is separate from the CV Pack list on purpose: people only get what
they signed up for.

Environment (GitHub secrets):
  BREVO_API_KEY         v3 API key
  BREVO_LIST_ID_DAILY   numeric id of the Daily Savannah list
  BREVO_SENDER_EMAIL    a sender verified in Brevo
  BREVO_SENDER_NAME     optional, default "The Tech Hut"

Usage:
  python3 scripts/send_roundup.py --dry-run             write a preview file, send nothing
  python3 scripts/send_roundup.py --test you@x.com      send ONE copy to that address only
  python3 scripts/send_roundup.py                       create and send the campaign
  python3 scripts/send_roundup.py --force               send even if the week is thin or already sent
  python3 scripts/send_roundup.py --today 2026-10-18    pretend today is this date (for previews)

Standard library only, so a cron job never breaks on pip.
"""
import argparse
import datetime
import html
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from send_digest import brevo   # one Brevo client for both mailings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDITIONS = os.path.join(ROOT, 'blog', 'daily', '_src', 'editions')
SITE = 'https://thetechhut.co'

WINDOW_DAYS = 7
MIN_EDITIONS = 3
HEADLINES_PER_EDITION = 6
SUBJECT_MAX = 78


def strip_tags(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t or '')).strip()


def plain(t):
    """Fragment markup -> plain text with entities decoded."""
    return html.unescape(strip_tags(t))


def esc(s):
    return html.escape(str(s or ''), quote=True)


def parse_edition(path):
    slug = os.path.basename(path)[:-5]
    with open(path, encoding='utf-8') as fh:
        raw = fh.read()
    body = re.sub(r'<!--.*?-->', '', raw, flags=re.S)
    m = re.search(r'<!--\s*number:\s*(.*?)\s*-->', raw)
    number = m.group(1) if m else ''
    m = re.search(r'<p class="edition-lede">(.*?)</p>', raw, re.S)
    lede = plain(m.group(1)) if m else ''
    m = re.search(r'<article class="lead">.*?<h3>(.*?)</h3>', body, re.S)
    lead = plain(m.group(1)) if m else ''
    stories = [plain(h) for h in re.findall(r'<article class="story">.*?<h3>(.*?)</h3>', body, re.S)]
    return {
        'slug': slug,
        'date': datetime.date.fromisoformat(slug),
        'number': number,
        'lede': lede,
        'lead': lead,
        'stories': stories,
        'count': (1 if lead else 0) + len(stories),
    }


def load_editions(directory):
    out = []
    if not os.path.isdir(directory):
        return out
    for f in sorted(os.listdir(directory)):
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}\.html', f):
            ed = parse_edition(os.path.join(directory, f))
            if ed['lead']:                      # a fragment with no lead is not an edition
                out.append(ed)
    return out


def window_for(today):
    """The seven days that ended yesterday -> (first_day, last_day)."""
    last = today - datetime.timedelta(days=1)
    return last - datetime.timedelta(days=WINDOW_DAYS - 1), last


def day_label(d):
    return '%s %d %s' % (d.strftime('%A'), d.day, d.strftime('%B'))


def short(text, limit):
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(' ', 1)[0].rstrip(' ,;:-')
    return cut + '…'


def build_roundup(directory, today=None):
    """-> dict (subject, html, name, ...). Raises ValueError with a plain reason when there is nothing to send."""
    today = today or datetime.date.today()
    first, last = window_for(today)
    eds = [e for e in load_editions(directory) if first <= e['date'] <= last]
    if not eds:
        raise ValueError('no editions dated %s to %s' % (first, last))
    eds.sort(key=lambda e: e['date'], reverse=True)          # newest first, like the site
    stories = sum(e['count'] for e in eds)
    iso = last.isocalendar()
    week = '%d-W%02d' % (iso[0], iso[1])

    blocks = []
    for e in eds:
        url = '%s/blog/daily/%s/' % (SITE, e['slug'])
        heads = e['stories'][:HEADLINES_PER_EDITION]
        more = len(e['stories']) - len(heads)
        items = ''.join('<li style="margin:0 0 4px">%s</li>' % esc(h) for h in heads)
        blocks.append(
            '<div style="margin:0 0 26px">'
            '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4a5568">%s%s</p>'
            '<h3 style="margin:0 0 6px;font-family:Poppins,Arial,sans-serif;font-size:18px;line-height:1.3">'
            '<a href="%s" style="color:#073B4C;text-decoration:none">%s</a></h3>'
            '%s'
            '%s'
            '<p style="margin:8px 0 0;font-size:14px"><a href="%s" style="color:#046b52;font-weight:700;text-decoration:none">Read the full edition &rarr;</a></p>'
            '</div>' % (
                esc(day_label(e['date'])),
                (' &middot; ' + esc(e['number'])) if e['number'] else '',
                esc(url), esc(e['lead']),
                ('<p style="margin:0 0 8px;font-size:15px">%s</p>' % esc(e['lede'])) if e['lede'] else '',
                ('<ul style="margin:0;padding-left:20px;font-size:14px;color:#4a5568">%s%s</ul>' % (
                    items,
                    ('<li style="margin:0;list-style:none;margin-left:-20px;padding-top:2px">+ %d more in the edition</li>' % more) if more > 0 else '',
                )) if items else '',
                esc(url)))

    n = len(eds)
    subject = 'The week in Kenyan tech: ' + short(eds[0]['lead'], SUBJECT_MAX - len('The week in Kenyan tech: '))
    body = (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
        '<p style="font-family:Poppins,Arial,sans-serif;font-weight:700;font-size:20px;margin:0 0 6px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
        '<p style="margin:0 0 20px;color:#4a5568;font-size:14px">The Daily Savannah, %s to %s</p>'
        '<p>%d edition%s and %d stor%s from the week, newest first. Every story in an edition links to its original source.</p>'
        '%s'
        '<hr style="border:0;border-top:1px solid #dfe6ed;margin:28px 0 14px">'
        '<p style="font-size:12px;color:#4a5568">You are receiving this because you asked for the Daily Savannah weekly roundup on thetechhut.co. '
        '<a href="{{ unsubscribe }}" style="color:#4a5568">Unsubscribe</a> in one click.</p>'
        '</div>'
    ) % (esc(day_label(first)), esc(day_label(last)), n, '' if n == 1 else 's', stories,
         'y' if stories == 1 else 'ies', ''.join(blocks))

    return {
        'subject': subject, 'html': body, 'editions': n, 'stories': stories,
        'week': week, 'name': 'Daily Savannah weekly ' + week,
        'first': first, 'last': last,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--test', metavar='EMAIL')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--today', metavar='YYYY-MM-DD')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'roundup-preview.html'))
    a = ap.parse_args(argv)

    today = datetime.date.fromisoformat(a.today) if a.today else None
    try:
        r = build_roundup(EDITIONS, today)
    except ValueError as e:
        print('roundup: nothing sent -', e)
        return 0
    print('roundup: %d editions, %d stories (%s to %s)' % (r['editions'], r['stories'], r['first'], r['last']))

    if a.dry_run:
        with open(a.out, 'w', encoding='utf-8') as fh:
            fh.write(r['html'].replace('{{ unsubscribe }}', '#'))
        print('roundup: subject "%s"' % r['subject'])
        print('roundup: preview written to', a.out)
        return 0
    if r['editions'] < MIN_EDITIONS and not a.force:
        print('roundup: only %d edition(s) this week (need %d), nothing sent. Use --force to send anyway.' % (r['editions'], MIN_EDITIONS))
        return 0

    key = os.environ.get('BREVO_API_KEY', '')
    sender = {'name': os.environ.get('BREVO_SENDER_NAME') or 'The Tech Hut', 'email': os.environ.get('BREVO_SENDER_EMAIL', '')}
    list_id = os.environ.get('BREVO_LIST_ID_DAILY', '')
    if not (key and sender['email'] and list_id.isdigit()):
        print('roundup: BREVO_API_KEY, BREVO_LIST_ID_DAILY and BREVO_SENDER_EMAIL must all be set', file=sys.stderr)
        return 1

    if a.test:
        status, body = brevo('/smtp/email', key, 'POST', {
            'sender': sender, 'to': [{'email': a.test}], 'subject': '[TEST] ' + r['subject'],
            'htmlContent': r['html'].replace('{{ unsubscribe }}', '#'), 'tags': ['roundup-test']})
        print('roundup: test email', 'sent to ' + a.test if status < 300 else 'FAILED %s %s' % (status, body))
        return 0 if status < 300 else 1

    status, body = brevo('/emailCampaigns?type=classic&limit=100&sort=desc', key)
    if status >= 300:
        print('roundup: could not list campaigns: %s %s' % (status, body), file=sys.stderr)
        return 1
    if any(c.get('name') == r['name'] for c in body.get('campaigns', [])) and not a.force:
        print('roundup: "%s" already exists, not sending twice' % r['name'])
        return 0

    status, body = brevo('/emailCampaigns', key, 'POST', {
        'name': r['name'], 'subject': r['subject'], 'sender': sender, 'type': 'classic',
        'htmlContent': r['html'], 'recipients': {'listIds': [int(list_id)]}})
    if status >= 300 or 'id' not in body:
        print('roundup: could not create the campaign: %s %s' % (status, body), file=sys.stderr)
        return 1
    status, body2 = brevo('/emailCampaigns/%d/sendNow' % body['id'], key, 'POST')
    if status >= 300:
        print('roundup: campaign %d created but sendNow failed: %s %s' % (body['id'], status, body2), file=sys.stderr)
        return 1
    print('roundup: campaign %d sent' % body['id'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
