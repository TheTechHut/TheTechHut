#!/usr/bin/env python3
"""Build The Reading List: a weekly, hand-picked set of developer articles.

How the picks are made (and why this is a hand-made page, not a feed)
--------------------------------------------------------------------
Candidates come from Emmanuel's own daily.dev feed, read for him (his
logged-in browser or his own access token). daily.dev's terms (section 19)
allow that personal use, but forbid serving data returned by its API to
anyone else, or keeping a copy of its feeds, rankings or summaries. So
nothing from daily.dev is published here: each pick links straight to the
original author's page, and the "why read it" note is our own writing, from
reading the original. Never paste daily.dev's summaries, scores or
comments, and never link through daily.dev.

One exception: an author's own post published directly on daily.dev (not a
daily.dev summary, "trend" write-up or a shared link to somewhere else) has
no other original, so it is linked at https://daily.dev/posts/<id>. Mark
such a pick <article class="pick native"> so the build accepts it.

Sources (the only files you edit):
  blog/reading/_src/issues/YYYY-MM-DD.html   one issue per file:
      <!-- date: Wednesday, 21 October 2026 -->
      <!-- number: Nº 1 -->
      <!-- image: https://images.unsplash.com/photo-...?q=80&amp;w=1200&amp;h=750&amp;auto=format&amp;fit=crop -->
      <!-- alt: what the picture shows -->
      <p class="lede">One or two sentences on this week's picks.</p>
      <article class="pick">
        <span class="kicker">Fintech</span>
        <h3><a href="https://original.example/post" target="_blank" rel="noopener">Title as the author wrote it</a></h3>
        <p class="src">Author &middot; Publication &middot; 14 October 2026</p>
        <p>Why it is worth your time, in our words.</p>
      </article>
      ... four to six picks ...

Outputs (generated, do not hand-edit):
  blog/reading/index.html                 all issues
  blog/reading/YYYY-MM-DD/index.html      one page per issue
  blog/index.html                         rows between // READING:START and // READING:END
Then run scripts/build_daily.py, which also lists these pages in sitemap.xml.

Run:  python3 scripts/build_reading.py
"""
import datetime, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READ = os.path.join(ROOT, 'blog', 'reading')
ISSUES = os.path.join(READ, '_src', 'issues')
LAYOUT = os.path.join(ROOT, 'blog', 'daily', '_src', 'layout.html')
SITE = 'https://thetechhut.co'
MAX_ON_BLOG = 3
FONTS = ('  <link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&amp;family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&amp;display=swap" rel="stylesheet">\n'
         '  <link rel="stylesheet" href="/assets/css/thh.css">\n'
         '  <link rel="stylesheet" href="/assets/css/blog.css">')
ICONS = ('  <link rel="icon" href="/favicon.ico" sizes="any">\n'
         '  <link rel="icon" href="/assets/img/favicon-192.png" type="image/png" sizes="192x192">\n'
         '  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">')

STYLE = '''<style>
  .reading .lede { font-size: 19px; line-height: 1.6; color: var(--text); margin: 0 0 18px; }
  article.pick { border-top: 2px solid var(--ink); padding: 14px 0 24px; }
  article.pick .kicker { display: block; font-family: var(--mono); font-size: 12px; text-transform: uppercase;
    letter-spacing: .08em; color: var(--green); margin-bottom: 8px; }
  article.pick h3 { font-size: 26px; line-height: 1.15; margin: 0 0 6px; }
  article.pick h3 a { color: var(--ink); text-decoration: none; }
  article.pick h3 a:hover { text-decoration: underline; text-decoration-thickness: 1px; }
  article.pick h3 a::after { content: " \\2197"; font-size: .7em; color: var(--green); }
  article.pick .src { font-family: var(--mono); font-size: 12.5px; color: var(--dim); margin: 0 0 10px; }
  article.pick p { font-size: 17px; line-height: 1.65; margin: 0 0 10px; }
  .how { border-top: 1px solid var(--rule); margin-top: 8px; padding-top: 14px; font-size: 15px; color: var(--muted); }
  .ed-nav { display: flex; gap: 16px; border-top: 2px solid var(--ink); margin-top: 26px; padding-top: 14px; }
  .ed-nav a { color: var(--ink); text-decoration: none; font-weight: 700; }
  .ed-nav small { display: block; font-family: var(--mono); font-weight: 400; font-size: 11.5px; text-transform: uppercase; color: var(--dim); }
  .ed-nav .next { text-align: right; margin-left: auto; }
  @media (max-width: 600px) { article.pick h3 { font-size: 22px; } }
</style>'''


def section(layout, name, pattern):
    m = re.search(pattern, layout, re.S)
    if not m:
        sys.exit('build_reading.py: could not find %s in %s' % (name, LAYOUT))
    return m.group(0)


def strip_tags(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t)).strip()


def header(layout):
    h = section(layout, 'header', r'<a class="skip".*?(?=\n<!-- /HEADER -->)')
    h = h.replace('<a href="/blog/daily/" aria-current="page">Daily</a>', '<a href="/blog/daily/">Daily</a>')
    h = h.replace('<a href="/blog/">Blog</a>', '<a href="/blog/" aria-current="page">Blog</a>')
    h = h.replace('<a class="cat on" href="/blog/daily/" aria-current="page">', '<a class="cat" href="/blog/daily/">')
    h = h.replace('<a class="cat" href="/blog/reading/">', '<a class="cat on" href="/blog/reading/" aria-current="page">')
    return h


def footer(layout):
    f = section(layout, 'footer', r'<div class="pagefoot">.*?</footer>')
    return re.sub(r'<div class="pagefoot">.*?</div></div>',
                  '<div class="pagefoot"><div class="wrap">\n  <p>The Reading List is a weekly set of developer articles '
                  'picked by The Tech Hut. Every link goes to the original author; the notes are ours.</p>\n</div></div>',
                  f, count=1, flags=re.S)


def load(slug):
    raw = open(os.path.join(ISSUES, slug + '.html'), encoding='utf-8').read()
    d = {'slug': slug, 'date': datetime.date(*map(int, slug.split('-')))}
    def meta(key, default=''):
        m = re.search(r'<!--\s*%s:\s*(.*?)\s*-->' % key, raw)
        return m.group(1) if m else default
    d['datetext'] = meta('date', d['date'].strftime('%A, %-d %B %Y'))
    d['no'] = meta('number')
    d['img'] = meta('image')
    d['alt'] = meta('alt', 'The Reading List')
    m = re.search(r'<p class="lede">(.*?)</p>', raw, re.S)
    d['lede'] = m.group(1).strip() if m else ''
    i = raw.find('<article class="pick')
    d['body'] = raw[i:].strip() if i != -1 else ''
    found = re.findall(r'<article class="pick( native)?">.*?<h3><a href="([^"]+)"[^>]*>(.*?)</a></h3>', d['body'], re.S)
    if not found:
        sys.exit('build_reading.py: %s.html has no picks' % slug)
    for native, url, _ in found:
        if not url.startswith('https://'):
            sys.exit('build_reading.py: %s.html links to %s; use https' % (slug, url))
        if 'daily.dev' in url and not (native and re.fullmatch(r'https://daily\.dev/posts/[A-Za-z0-9_-]+', url)):
            sys.exit('build_reading.py: %s.html links to %s; link the original author, not daily.dev '
                     '(an author\'s own daily.dev post: <article class="pick native"> and https://daily.dev/posts/<id>)' % (slug, url))
    d['picks'] = [(url, title) for _, url, title in found]
    if '<!--' in d['body']:
        sys.exit('build_reading.py: stray comment inside the picks of %s.html' % slug)
    return d


def head(title, desc, url, img, alt, og_type='article'):
    t = html.escape(strip_tags(title), quote=True)
    dsc = html.escape(strip_tags(desc)[:300], quote=True)
    big = html.escape(html.unescape(img), quote=True)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{t}</title>
  <meta name="description" content="{dsc}">
  <meta name="author" content="The Tech Hut">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#073B4C">
{ICONS}
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="{og_type}">
  <meta property="og:site_name" content="The Tech Hut">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{dsc}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{big}">
  <meta property="og:image:alt" content="{html.escape(alt, quote=True)}">
  <meta property="og:locale" content="en_KE">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{t}">
  <meta name="twitter:description" content="{dsc}">
  <meta name="twitter:image" content="{big}">
{FONTS}
</head>
<body>'''


def main():
    layout = open(LAYOUT, encoding='utf-8').read()
    HEADER, FOOTER = header(layout), footer(layout)
    os.makedirs(ISSUES, exist_ok=True)
    slugs = sorted(f[:-5] for f in os.listdir(ISSUES) if re.fullmatch(r'\d{4}-\d{2}-\d{2}\.html', f))
    if not slugs:
        print('build_reading.py: no issues yet')
        return
    issues = sorted((load(s) for s in slugs), key=lambda d: d['date'], reverse=True)

    for i, d in enumerate(issues):
        newer = issues[i - 1] if i > 0 else None
        older = issues[i + 1] if i + 1 < len(issues) else None
        nav = ''
        if older:
            nav += f'<a class="prev" href="/blog/reading/{older["slug"]}/"><small>Previous list</small>&larr; {older["datetext"]}</a>'
        if newer:
            nav += f'<a class="next" href="/blog/reading/{newer["slug"]}/"><small>Next list</small>{newer["datetext"]} &rarr;</a>'
        nav = f'<div class="ed-nav">{nav}</div>' if nav else ''
        titles = '; '.join(html.unescape(strip_tags(t)) for _, t in d['picks'])
        title = f'The Reading List, {d["datetext"]}'
        page = head(f'{title} | The Tech Hut Blog', f'This week\'s picks: {titles}.', f'{SITE}/blog/reading/{d["slug"]}/', d['img'], d['alt'])
        earlier = ''.join(f'<li><a href="/blog/reading/{e["slug"]}/">The Reading List</a><time>{e["datetext"]}</time></li>'
                          for e in issues[i + 1:i + 6]) or '<li><a href="/blog/daily/">The Daily Savannah</a><time>Kenyan tech, every weekday</time></li>'
        page += f'''
{STYLE}

{HEADER}

<main id="main">
  <header class="art-hero">
    <figure class="pic"><img src="{d['img']}" alt="{html.escape(d['alt'], quote=True)}" fetchpriority="high" decoding="async" onerror="this.remove()"></figure>
    <div class="panel">
      <a class="cat" href="/blog/reading/">The Reading List &middot; {html.escape(d['no'])}</a>
      <h1>{len(d['picks'])} things worth reading this week</h1>
      <p class="by"><b>The Tech Hut</b> &middot; <time datetime="{d['slug']}">{d['datetext']}</time></p>
    </div>
  </header>

  <div class="wrap art-body">
    <section class="reading">
      <p class="lede">{d['lede']}</p>

      {d['body']}

      <p class="how">How we pick: each week we go through the developer feeds we follow, read the originals, and keep the few a developer in Kenya would want to know about. Every link goes to the author&rsquo;s own page.</p>

      {nav}
    </section>

    <aside class="side">
      <div class="picks"><h2>Earlier lists</h2><ul>{earlier}</ul></div>
      <div class="promo">
        <span class="label">Also from us</span>
        <h3>The Daily Savannah</h3>
        <p>Kenyan tech news every weekday evening, with every story linked to its source.</p>
        <a class="link-arrow" href="/blog/daily/">Read the latest edition &rarr;</a>
      </div>
    </aside>
  </div>
</main>

{FOOTER}
</body>
</html>
'''
        os.makedirs(os.path.join(READ, d['slug']), exist_ok=True)
        open(os.path.join(READ, d['slug'], 'index.html'), 'w', encoding='utf-8').write(page)

    # ---- hub ----
    def row(d):
        items = ''.join(f'<li>{t}</li>' for _, t in d['picks'])
        return f'''      <li>
        <a href="/blog/reading/{d['slug']}/" tabindex="-1" aria-hidden="true"><img class="thumb" src="{d['img']}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{{className:'thumb blank'}}))"></a>
        <div>
          <span class="cat">The Reading List &middot; {html.escape(d['no'])}</span>
          <h3><a href="/blog/reading/{d['slug']}/">{len(d['picks'])} things worth reading this week</a></h3>
          <ul class="heads">{items}</ul>
          <div class="by"><b>The Tech Hut</b> &middot; {d['datetext']}</div>
        </div>
      </li>'''
    hub = head('The Reading List | The Tech Hut Blog',
               'A weekly, hand-picked list of developer articles worth your time, chosen for developers in Kenya. Every link goes to the original author.',
               f'{SITE}/blog/reading/', issues[0]['img'], issues[0]['alt'], 'website')
    hub += f'''
{STYLE}

{HEADER}

<main id="main">
  <div class="wrap feedwrap">
    <section id="latest" aria-labelledby="all-h">
      <div class="feedhead"><h2 id="all-h">The Reading List</h2><span class="filter">{len(issues)} list{'s' if len(issues) != 1 else ''}</span></div>
      <p class="lede">Every week, a handful of developer articles worth your time, picked for developers in Kenya. Every link goes to the original author.</p>
      <ul class="river">
{chr(10).join(row(d) for d in issues)}
      </ul>
    </section>
    <div class="side">
      <div class="picks">
        <h2>From the blog</h2>
        <ul>
          <li><a href="/blog/daily/">The Daily Savannah</a></li>
          <li><a href="/blog/jobs/">Landing tech jobs in Kenya: the real talk</a></li>
          <li><a href="/jobs/">The jobs board</a></li>
        </ul>
      </div>
    </div>
  </div>
</main>

{FOOTER}
</body>
</html>
'''
    open(os.path.join(READ, 'index.html'), 'w', encoding='utf-8').write(hub)
    print(f'Built {len(issues)} reading list(s) + hub (latest: {issues[0]["slug"]})')

    # ---- rows on /blog/ ----
    blog_index = os.path.join(ROOT, 'blog', 'index.html')
    b = open(blog_index, encoding='utf-8').read()
    START, END = '// READING:START', '// READING:END'
    if START in b and END in b:
        rows = []
        for d in issues[:MAX_ON_BLOG]:
            titles = '; '.join(html.unescape(strip_tags(t)) for _, t in d['picks'])
            rows.append(
                '                {\n'
                f'                    id: "reading-{d["slug"]}",\n'
                '                    category: "Reading List",\n'
                f'                    title: {json.dumps(str(len(d["picks"])) + " things worth reading this week")},\n'
                f'                    excerpt: {json.dumps(titles)},\n'
                '                    author: "The Tech Hut",\n'
                f'                    date: {json.dumps(d["date"].strftime("%B %-d, %Y"))},\n'
                '                    image: %s,\n' % json.dumps(html.unescape(re.sub(r'w=\d+', 'w=800', d['img']))) +
                '                    likes: 0,\n'
                f'                    url: "/blog/reading/{d["slug"]}/"\n'
                '                },')
        hi, ti = b.index(START) + len(START), b.index(END)
        b = b[:hi] + ' — generated by scripts/build_reading.py, do not edit by hand\n' + '\n'.join(rows) + '\n                ' + b[ti:]
        open(blog_index, 'w', encoding='utf-8').write(b)
        print(f'Injected {len(rows)} reading list(s) into blog/index.html')
    else:
        print('NOTE: READING:START/END markers missing in blog/index.html - skipped')


if __name__ == '__main__':
    main()
