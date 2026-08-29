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
FONTS = ('  <link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600;700;800&display=swap">')

def section(layout, name, pattern):
    m = re.search(pattern, layout, re.S)
    if not m:
        sys.exit('build_daily.py: could not find %s in _src/layout.html' % name)
    return m.group(0)

layout = open(os.path.join(SRC, 'layout.html')).read()
STYLE  = section(layout, '<style>',  r'<style>.*?</style>')
HEADER = section(layout, 'header',   r'<header class="site">.*?</header>')
FOOTER = section(layout, 'footer',   r'<footer class="site">.*?</footer>')
SCRIPT = section(layout, 'script',   r'<script>.*?</script>')

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
    d['heads'] = re.findall(r'<article class="story">.*?<h3>(.*?)</h3>', d['body'], re.S)[:3]
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
  <meta name="theme-color" content="#06D6A0">
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
    page = head(f'{d["datetext"]} — The Daily Savannah', d['lede'], url, d['img'], d['alt'])
    page += f'''
{STYLE}

{HEADER}

<div class="shell">
  <a class="backlink" href="/blog/daily/">&larr; All editions</a>
  <div class="pagehead">
    <h1>The Daily <em>Savannah</em></h1>
    <div class="sub">
      <span>{d['datetext']}</span>
      <span class="auto">{html.escape(d['no'])}</span>
    </div>
  </div>

  <section class="edition">
    <p class="edition-lede">{d['lede']}</p>

    {d['body']}
  </section>

  {nav}
  <a class="backlink" href="/blog/daily/">&larr; All editions</a>
</div>

{FOOTER}

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
    return f'''      <a class="ed-card" href="/blog/daily/{d['slug']}/">
        <div class="pic"><img src="{d['img']}" alt="{html.escape(d['alt'], quote=True)}" loading="lazy" onerror="this.remove()"></div>
        <div class="txt">
          <span class="no">{html.escape(d['no'])} &middot; {d['count']} stories</span>
          <h3>{d['datetext']}</h3>
          <p>{d['lede']}</p>
          <ul>{teasers}</ul>
          <span class="more">Read edition &rarr;</span>
        </div>
      </a>'''

index = head('The Daily Savannah | The Tech Hut Blog',
             "The Tech Hut's automated daily digest of Kenya's tech ecosystem — startups, "
             "fintech, policy, and infrastructure. A fresh edition every evening at 9:00 PM EAT.",
             f'{SITE}/blog/daily/', latest['img'], 'Nairobi city skyline', 'website')
index += f'''
{STYLE}

{HEADER}

<div class="shell">
  <div class="pagehead">
    <h1>The Daily <em>Savannah</em></h1>
    <div class="sub">
      <span>Kenya's tech ecosystem, every day — startups, fintech, policy &amp; infrastructure.</span>
      <span class="auto">NEW EDITION EVERY 9:00 PM EAT</span>
    </div>
  </div>

  <h2 class="section-title" style="margin-top:2.25rem">Latest edition</h2>
  <a class="ed-latest" href="/blog/daily/{latest['slug']}/">
    <div class="txt">
      <span class="kicker">{html.escape(latest['no'])} &middot; {latest['datetext']}</span>
      <h3>{latest['lead_title']}</h3>
      <p>{latest['lede']}</p>
      <span class="more" style="font-size:0.8rem;font-weight:700;color:var(--green-dark)">Read the full edition &rarr;</span>
    </div>
    <div class="pic"><img src="{latest['img']}" alt="{html.escape(latest['alt'], quote=True)}" loading="lazy" onerror="this.remove()"></div>
  </a>

  <h2 class="section-title">All editions</h2>
  <div class="ed-grid">
{chr(10).join(card(d) for d in eds)}
  </div>
</div>

{FOOTER}
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
