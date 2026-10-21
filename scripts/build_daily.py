#!/usr/bin/env python3
"""Build The Daily Savannah from source fragments.

Sources (the only files you edit):
  blog/daily/_src/layout.html          shared chrome: <style>, header, footer, script
  blog/daily/_src/editions/YYYY-MM-DD.html   one edition per file, e.g.
      <!-- date: Saturday, 29 August 2026 -->
      <!-- number: Edition Nº 3 -->
      <p class="edition-lede">One sentence framing the day.</p>
      <article class="lead"> ... </article>
      <div class="story-list"> ... </div>
      <div class="numbers"> ... </div>

Outputs (generated - do not hand-edit):
  blog/daily/index.html                listing of all editions
  blog/daily/YYYY-MM-DD/index.html     one page per edition, with prev/next nav

Run:  python3 scripts/build_daily.py
"""
import re, os, html, datetime, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, 'blog', 'daily')
SRC = os.path.join(DAILY, '_src')
EDS = os.path.join(SRC, 'editions')
SITE = 'https://thetechhut.co'
FONTS = '  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&amp;family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&amp;display=swap" rel="stylesheet">\n  <link rel="stylesheet" href="/assets/css/thh.css">\n  <link rel="stylesheet" href="/assets/css/blog.css">'

def section(layout, name, pattern):
    m = re.search(pattern, layout, re.S)
    if not m:
        sys.exit('build_daily.py: could not find %s in _src/layout.html' % name)
    return m.group(0)

layout = open(os.path.join(SRC, 'layout.html')).read()
STYLE  = section(layout, '<style>',  r'<style>.*?</style>')
HEADER = section(layout, 'header',   r'<a class="skip".*?(?=\n<!-- /HEADER -->)')
FOOTER = section(layout, 'footer',   r'<div class="pagefoot">.*?</footer>')
SCRIPT = section(layout, 'script',   r'<script>.*?</script>')
SIGNUP = section(layout, 'signup',   r'<aside class="subscribe".*?</aside>')
SIGNUP_JS = section(layout, 'signup script', r'<script id="signup-js">.*?</script>')

MONTHS = {m: i for i, m in enumerate(
    ['January','February','March','April','May','June','July','August','September',
     'October','November','December'], 1)}

def strip_tags(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t)).strip()

def load(slug):
    raw = open(os.path.join(EDS, slug + '.html')).read()
    d = {'slug': slug, 'date': datetime.date(*map(int, slug.split('-')))}
    m = re.search(r'<!--\s*date:\s*(.*?)\s*-->', raw)
    d['datetext'] = m.group(1) if m else d['date'].strftime('%A, %-d %B %Y')
    m = re.search(r'<!--\s*number:\s*(.*?)\s*-->', raw)
    d['no'] = m.group(1) if m else ''
    m = re.search(r'<p class="edition-lede">(.*?)</p>', raw, re.S)
    d['lede'] = m.group(1).strip() if m else ''
    stripped = re.sub(r'<!--.*?-->', '', raw, flags=re.S)   # comments must never leak into markup
    i = stripped.find('<article class="lead">')
    d['body'] = stripped[i:].strip() if i != -1 else ''
    m = re.search(r'<article class="lead">.*?<h3>(.*?)</h3>', d['body'], re.S)
    d['lead_title'] = m.group(1).strip() if m else d['datetext']
    m = re.search(r'<div class="pic"><img src="([^"]+)"[^>]*?alt="([^"]*)"', d['body'])
    d['img'], d['alt'] = (m.group(1), m.group(2)) if m else ('', 'The Daily Savannah')
    d['count'] = d['body'].count('<article class="story">') + (1 if d['body'] else 0)
    d['allheads'] = re.findall(r'<article class="story">.*?<h3>(.*?)</h3>', d['body'], re.S)
    d['heads'] = d['allheads'][:3]
    m = re.search(r'<article class="lead">.*?<span class="kicker">(.*?)</span>', d['body'], re.S)
    d['kicker'] = re.sub(r'^\s*Featured\s*·\s*', '', strip_tags(m.group(1))) if m else ''
    if '<!--' in d['body'] or '<section' in d['body']:
        sys.exit('build_daily.py: malformed fragment %s.html' % d['slug'])
    return d

def head(title, desc, url, img, alt, og_type='article'):
    t = html.escape(strip_tags(title), quote=True)
    d = html.escape(strip_tags(desc)[:300], quote=True)
    big = html.escape(re.sub(r'w=\d+', 'w=1200', img.replace('&amp;', '&')), quote=True) if img else ''
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{t}</title>
  <meta name="description" content="{d}">
  <meta name="keywords" content="Kenya tech news, Kenyan startups, M-Pesa, fintech Kenya, Nairobi tech, Silicon Savannah, Safaricom, Kenya AI policy, daily tech digest">
  <meta name="author" content="The Tech Hut">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#073B4C">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/assets/img/favicon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="canonical" href="{url}">
  <!-- Open Graph -->
  <meta property="og:type" content="{og_type}">
  <meta property="og:site_name" content="The Tech Hut">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{d}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{big}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{html.escape(alt, quote=True)}">
  <meta property="og:locale" content="en_KE">
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{t}">
  <meta name="twitter:description" content="{d}">
  <meta name="twitter:image" content="{big}">
{FONTS}
</head>
<body>'''

slugs = sorted(f[:-5] for f in os.listdir(EDS)
               if re.fullmatch(r'\d{4}-\d{2}-\d{2}\.html', f))
if not slugs:
    sys.exit('build_daily.py: no editions in _src/editions/')
eds = [load(s) for s in slugs]
eds.sort(key=lambda d: d['date'], reverse=True)   # newest first

# ---- lead-image reuse check -------------------------------------------------
# Every edition card on /blog/ and /blog/daily/ shows its lead image, so a
# repeated one reads as a duplicate post. Warn loudly; never silently ship it.
_seen = {}
_dupes = []
for _d in sorted(eds, key=lambda x: x['date']):
    _key = re.sub(r'\?.*$', '', _d['img'])
    if not _key:
        continue
    if _key in _seen:
        _dupes.append('  %s reuses the lead image of %s  (%s)'
                      % (_d['slug'], _seen[_key], _key.rsplit('/', 1)[-1]))
    else:
        _seen[_key] = _d['slug']
if _dupes:
    print('build_daily.py: WARNING - duplicate lead images:')
    print('\n'.join(_dupes))

# ---- per-edition pages ----
for i, d in enumerate(eds):
    newer = eds[i-1] if i > 0 else None
    older = eds[i+1] if i + 1 < len(eds) else None
    nav = ''
    if older:
        nav += (f'<a class="prev" href="/blog/daily/{older["slug"]}/">'
                f'<small>Previous edition</small>&larr; {older["datetext"]}</a>')
    if newer:
        nav += (f'<a class="next" href="/blog/daily/{newer["slug"]}/">'
                f'<small>Next edition</small>{newer["datetext"]} &rarr;</a>')
    nav = f'<div class="ed-nav">{nav}</div>' if nav else ''
    url = f'{SITE}/blog/daily/{d["slug"]}/'
    lead_t = html.unescape(strip_tags(d['lead_title']))
    plus = '; '.join(html.unescape(strip_tags(h)) for h in d['heads'])
    seo_title = f'{lead_t} — The Daily Savannah, {d["datetext"]}'
    seo_desc = f'{lead_t}. Plus: {plus}.' if plus else d['lede']
    page = head(seo_title, seo_desc, url, d['img'], d['alt'])
    earlier = ''.join(
        f'<li><a href="/blog/daily/{e["slug"]}/">{e["lead_title"]}</a><time>{e["datetext"]}</time></li>'
        for e in eds[i+1:i+6])
    page += f'''
{STYLE}

{HEADER}

<main id="main">
  <header class="art-hero">
    <figure class="pic"><img src="{d['img']}" alt="{html.escape(d['alt'], quote=True)}" fetchpriority="high" decoding="async" onerror="this.remove()"></figure>
    <div class="panel">
      <a class="cat" href="/blog/daily/">The Daily Savannah &middot; {html.escape(d['no'])}</a>
      <h1>{d['lead_title']}</h1>
      <p class="by"><b>The Daily Savannah</b> &middot; <time datetime="{d['slug']}">{d['datetext']}</time> &middot; {d['count']} stories</p>
    </div>
  </header>

  <div class="wrap art-body">
    <section class="edition">
      <p class="lede">{d['lede']}</p>

      {d['body']}

      {SIGNUP}

      {nav}
    </section>

    <aside class="side">
      <div class="picks"><h2>Earlier editions</h2><ul>{earlier}</ul></div>
      <div class="promo">
        <span class="label">About the Daily</span>
        <h3>Kenyan tech, every evening</h3>
        <p>A digest of Kenya's tech ecosystem at 9:00 PM Nairobi time. Every story links to its source.</p>
        <a class="link-arrow" href="/blog/daily/">All editions &rarr;</a>
      </div>
    </aside>
  </div>
</main>

{FOOTER}

{SIGNUP_JS}
{SCRIPT}
</body>
</html>
'''
    os.makedirs(os.path.join(DAILY, d['slug']), exist_ok=True)
    open(os.path.join(DAILY, d['slug'], 'index.html'), 'w').write(page)

# ---- index listing ----
latest = eds[0]
def card(d):
    teasers = ''.join(f'<li>{t}</li>' for t in d['heads'])
    return f'''      <li>
        <a href="/blog/daily/{d['slug']}/" tabindex="-1" aria-hidden="true"><img class="thumb" src="{d['img']}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{{className:'thumb blank'}}))"></a>
        <div>
          <span class="cat">{html.escape(d['no'])} &middot; {d['count']} stories</span>
          <h3><a href="/blog/daily/{d['slug']}/">{d['lead_title']}</a></h3>
          <ul class="heads">{teasers}</ul>
          <div class="by"><b>The Daily Savannah</b> &middot; {d['datetext']}</div>
        </div>
      </li>'''

def over(d, big=False):
    return (f'<a class="over{" big" if big else ""}" href="/blog/daily/{d["slug"]}/">'
            f'<img src="{d["img"]}" alt="" decoding="async" onerror="this.remove()">'
            f'<span class="cap"><span class="cat">{html.escape(d["no"])} &middot; {html.escape(d["kicker"] or "Lead story")}</span>'
            f'<h3>{d["lead_title"]}</h3><span class="by">{d["datetext"]}</span></span></a>')

index = head('The Daily Savannah | The Tech Hut Blog',
             "The Tech Hut's automated daily digest of Kenya's tech ecosystem — startups, "
             "fintech, policy, and infrastructure. A fresh edition every evening at 9:00 PM EAT.",
             f'{SITE}/blog/daily/', f'{SITE}/assets/img/social/daily.jpg',
             'The Daily Savannah: African tech in one read', 'website')
tonight = ''.join(f'<li><a href="/blog/daily/{latest["slug"]}/">{h}</a></li>' for h in latest['allheads'])
index += f'''
{STYLE}

{HEADER}

<main id="main">
  <div class="topband">
    <div class="wrap">
      <div class="plate">The Daily <em>Savannah</em><small>Kenya's tech ecosystem, every evening at 9:00 PM EAT</small></div>
      <div class="top-grid">
        {over(latest, True)}
        <div class="top-stack">{''.join(over(e) for e in eds[1:3])}</div>
        <div class="top-heads"><h2>Also in {html.escape(latest['no'])}</h2><ul>{tonight}</ul></div>
      </div>
    </div>
  </div>

  <div class="wrap feedwrap">
    <section id="latest" aria-labelledby="all-h">
      <div class="feedhead"><h2 id="all-h">All editions</h2><span class="filter">{len(eds)} editions</span></div>
      <ul class="river">
{chr(10).join(card(d) for d in eds)}
      </ul>
    </section>

    <div class="side">
      {SIGNUP}
      <div class="picks">
        <h2>From the blog</h2>
        <ul>
          <li><a href="/blog/dangote-ipo-fintech/">Fintechs Powering the Dangote IPO</a></li>
          <li><a href="/blog/jobs/">Landing tech jobs in Kenya: the real talk</a></li>
          <li><a href="/blog/ai_job_apocalypse/">The AI job apocalypse is coming. Are you prepared?</a></li>
          <li><a href="/blog/">Everything on the blog</a></li>
        </ul>
      </div>
    </div>
  </div>
</main>

{FOOTER}

{SIGNUP_JS}
</body>
</html>
'''
open(os.path.join(DAILY, 'index.html'), 'w').write(index)
print(f'Built {len(eds)} editions + index (latest: {latest["slug"]})')
for d in eds:
    print(f'  /blog/daily/{d["slug"]}/  {d["no"]:<22} {d["count"]} stories')

# ---- inject recent editions into the main blog listing (/blog/) ----
MAX_ON_BLOG = 5          # how many daily editions appear on /blog/ alongside the articles
blog_index = os.path.join(ROOT, 'blog', 'index.html')
if os.path.exists(blog_index):
    import json as _json
    b = open(blog_index).read()
    START, END = '// DAILY:START', '// DAILY:END'
    if START in b and END in b:
        rows = []
        for d in eds[:MAX_ON_BLOG]:
            title = html.unescape(strip_tags(d['lead_title']))
            excerpt = html.unescape(strip_tags(d['lede']))
            img = html.unescape(re.sub(r'w=\d+', 'w=800', d['img']))
            rows.append(
                '                {\n'
                f'                    id: "daily-{d["slug"]}",\n'
                '                    category: "Daily Savannah",\n'
                f'                    title: {_json.dumps(title)},\n'
                f'                    excerpt: {_json.dumps(excerpt)},\n'
                f'                    author: {_json.dumps("The Daily Savannah")},\n'
                f'                    date: {_json.dumps(d["date"].strftime("%B %-d, %Y"))},\n'
                f'                    image: {_json.dumps(img)},\n'
                '                    likes: 0,\n'
                f'                    url: "/blog/daily/{d["slug"]}/"\n'
                '                },'
            )
        head_i = b.index(START) + len(START)
        tail_i = b.index(END)
        b = (b[:head_i]
             + ' — generated by scripts/build_daily.py, do not edit by hand\n'
             + '\n'.join(rows) + '\n                '
             + b[tail_i:])
        open(blog_index, 'w').write(b)
        print(f'Injected {len(rows)} edition(s) into blog/index.html')
    else:
        print('NOTE: DAILY:START/END markers missing in blog/index.html - skipped')


# ---- latest edition on the home page (/) ------------------------------------
home_index = os.path.join(ROOT, 'index.html')
if os.path.exists(home_index):
    h = open(home_index, encoding='utf-8').read()
    m = re.search(r'(<!-- HOME-DAILY:START[^>]*-->)(.*?)(<!-- HOME-DAILY:END -->)', h, re.S)
    if m:
        top = eds[0]
        earlier = ''.join(
            f'<li><time datetime="{e["slug"]}">{e["datetext"]}</time>'
            f'<a href="/blog/daily/{e["slug"]}/">{e["lead_title"]}</a></li>'
            for e in eds[1:4])
        block = (f'\n                <span class="label">The Daily Savannah &middot; {html.escape(top["no"])}</span>'
                 f'\n                <h2><a href="/blog/daily/{top["slug"]}/">{top["lead_title"]}</a></h2>'
                 f'\n                <p class="dek">{top["lede"]}</p>'
                 f'\n                <ul class="earlier">{earlier}</ul>\n                ')
        h = h[:m.start(2)] + block + h[m.end(2):]
        open(home_index, 'w', encoding='utf-8').write(h)
        print('Updated the latest edition on the home page')
    else:
        print('NOTE: HOME-DAILY markers missing in index.html - skipped')


# ---- regenerate sitemap.xml so every edition is discoverable -------------
# Static pages are listed explicitly; daily editions are derived from the
# fragments, so a new edition reaches the sitemap the moment it is built.
STATIC_PAGES = [
    ('/',                            '1.00', 'weekly'),
    ('/blog/',                       '0.90', 'daily'),
    ('/blog/daily/',                 '0.90', 'daily'),
    ('/blog/reading/',               '0.80', 'weekly'),
    ('/jobs/',                       '0.90', 'daily'),
    ('/shop/',                       '0.90', 'weekly'),
    ('/cv-pack/',                    '0.85', 'monthly'),
    ('/remote/',                     '0.85', 'daily'),
    ('/ats-pass/',                   '0.75', 'monthly'),
    ('/tools/',                      '0.70', 'monthly'),
    ('/games/',                      '0.60', 'monthly'),
    ('/jobs-for-your-community/',    '0.60', 'monthly'),
    # Paid product pages. Both are root-level .html files, which is why they
    # never appeared here before the check above was fixed.
    ('/seo.html',                    '0.75', 'monthly'),
    ('/cv.html',                     '0.75', 'monthly'),
    ('/early-access/',               '0.75', 'monthly'),
    ('/advertise/',                  '0.70', 'monthly'),
    ('/blog/dangote-ipo-fintech/',   '0.70', 'monthly'),
    ('/apprenticeship/',             '0.80', 'monthly'),
    ('/events/',                     '0.70', 'weekly'),
    ('/communities/',                '0.60', 'monthly'),
    ('/recruiters/',                 '0.60', 'monthly'),
    ('/afro-ip/',                    '0.50', 'monthly'),
    ('/entrepreneurial_challenge/',  '0.50', 'monthly'),
    ('/data_privacy_policy/',        '0.30', 'yearly'),
]
today = datetime.date.today().isoformat()
rows = []
for loc, pri, freq in STATIC_PAGES:
    # Never list a page that isn't on disk. A trailing-slash path is a directory
    # with an index.html; a path ending .html is the file itself -- the old check
    # only accepted directories, so root-level pages like /cv.html were silently
    # dropped from the sitemap however many times they were added here.
    if loc != '/':
        target = os.path.join(ROOT, loc.strip('/'))
        if not (os.path.isdir(target) or os.path.isfile(target)):
            continue
    rows.append((loc, today, freq, pri))
for d in eds:                                     # newest first, already sorted
    rows.append((f'/blog/daily/{d["slug"]}/', d['slug'], 'never', '0.70'))
_reading = os.path.join(ROOT, 'blog', 'reading', '_src', 'issues')
if os.path.isdir(_reading):                       # The Reading List (scripts/build_reading.py)
    for _f in sorted(os.listdir(_reading), reverse=True):
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}\.html', _f) and os.path.isdir(os.path.join(ROOT, 'blog', 'reading', _f[:-5])):
            rows.append((f'/blog/reading/{_f[:-5]}/', _f[:-5], 'never', '0.60'))

xml = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for loc, mod, freq, pri in rows:
    xml += ['  <url>', f'    <loc>{SITE}{loc}</loc>', f'    <lastmod>{mod}</lastmod>',
            f'    <changefreq>{freq}</changefreq>', f'    <priority>{pri}</priority>', '  </url>']
xml.append('</urlset>')
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(xml) + '\n')
print(f'sitemap.xml: {len(rows)} URLs ({len(eds)} daily editions)')
