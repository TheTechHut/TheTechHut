#!/usr/bin/env python3
"""Release scheduled blog articles on their dates.

Articles waiting to go live sit in blog/_src/scheduled/<slug>/index.html
(firebase.json ignores every _src folder, so they are never deployed early).
blog/_src/scheduled/schedule.json lists them:

    [{"slug": "...", "date": "YYYY-MM-DD",
      "card": {"title": "...", "excerpt": "...", "image": "https://..."}}]

On or after an article's date this script:
  - writes it to blog/<slug>/index.html, filling {{DATE_ISO}} and {{DATE_LONG}}
    with the day it actually went live,
  - adds its card to the blog index (after the READING:END marker),
  - adds it to sitemap.xml,
  - turns on links to it from articles that are already live.

Links between scheduled articles are written as <a data-sched="slug"> (no href)
and sidebar items as <li data-sched-li="slug" hidden>, so no live page links to
a page that does not exist yet. Once the target is live they become normal links.

Runs every morning in .github/workflows/jobs-snapshot.yml, before the commit and
deploy. Safe to run any number of times: an article already live is left alone.

    python3 scripts/publish_scheduled.py              # today in Nairobi
    python3 scripts/publish_scheduled.py 2026-11-20   # as if it were that day
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://thetechhut.co'
EAT = datetime.timezone(datetime.timedelta(hours=3))
CARD_MARK = '// READING:END'


def long_date(iso):
    d = datetime.date.fromisoformat(iso)
    return '%s, %d %s %d' % (d.strftime('%A'), d.day, d.strftime('%B'), d.year)


def card_date(iso):
    d = datetime.date.fromisoformat(iso)
    return '%s %d, %d' % (d.strftime('%B'), d.day, d.year)


def _card(e, iso):
    c = e['card']
    return ('                {\n'
            '                    id: %s,\n'
            '                    category: "Careers",\n'
            '                    title: %s,\n'
            '                    excerpt: %s,\n'
            '                    author: "The Tech Hut",\n'
            '                    date: %s,\n'
            '                    image: %s,\n'
            '                    likes: 0,\n'
            '                    url: "/blog/%s/"\n'
            '                },\n') % (json.dumps(e['slug']), json.dumps(c['title']), json.dumps(c['excerpt']),
                                      json.dumps(card_date(iso)), json.dumps(c['image']), e['slug'])


def enable_links(html, live):
    for s in live:
        html = html.replace('<a data-sched="%s">' % s, '<a href="/blog/%s/">' % s)
        html = html.replace('<li data-sched-li="%s" hidden>' % s, '<li>')
    return html


def publish(root=ROOT, today=None):
    """Publish every due article. Returns the slugs published on this run."""
    today = today or datetime.datetime.now(EAT).date().isoformat()
    sched_dir = os.path.join(root, 'blog', '_src', 'scheduled')
    path = os.path.join(sched_dir, 'schedule.json')
    if not os.path.isfile(path):
        return []
    sched = json.load(open(path))
    live_page = lambda s: os.path.join(root, 'blog', s, 'index.html')
    done = []
    for e in sorted(sched, key=lambda x: x['date']):
        s = e['slug']
        if e['date'] > today or os.path.exists(live_page(s)):
            continue
        src = os.path.join(sched_dir, s, 'index.html')
        if not os.path.isfile(src):
            print('scheduled article missing: %s' % src)
            continue
        html = open(src).read().replace('{{DATE_ISO}}', today).replace('{{DATE_LONG}}', long_date(today))
        os.makedirs(os.path.dirname(live_page(s)), exist_ok=True)
        open(live_page(s), 'w').write(html)

        idx = os.path.join(root, 'blog', 'index.html')
        b = open(idx).read()
        if '"/blog/%s/"' % s not in b and CARD_MARK in b:
            i = b.index('\n', b.index(CARD_MARK)) + 1
            open(idx, 'w').write(b[:i] + _card(e, today) + b[i:])

        sm = os.path.join(root, 'sitemap.xml')
        if os.path.isfile(sm):
            x = open(sm).read()
            loc = '%s/blog/%s/' % (SITE, s)
            if '<loc>%s</loc>' % loc not in x and '</urlset>' in x:
                row = ('  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n'
                       '    <changefreq>monthly</changefreq>\n    <priority>0.75</priority>\n  </url>\n') % (loc, today)
                open(sm, 'w').write(x.replace('</urlset>', row + '</urlset>'))
        done.append(s)

    live = [e['slug'] for e in sched if os.path.exists(live_page(e['slug']))]
    blog = os.path.join(root, 'blog')
    for name in os.listdir(blog):
        f = os.path.join(blog, name, 'index.html')
        if name.startswith('_') or not os.path.isfile(f):
            continue
        html = open(f).read()
        if 'data-sched' not in html:
            continue
        new = enable_links(html, live)
        if new != html:
            open(f, 'w').write(new)
    return done


if __name__ == '__main__':
    out = publish(today=sys.argv[1] if len(sys.argv) > 1 else None)
    print('published: %s' % (', '.join(out) if out else 'nothing due'))
