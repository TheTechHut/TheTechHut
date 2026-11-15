"""Run: python3 -m unittest scripts/tests/test_publish_scheduled.py -v   (from the repo root)"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import publish_scheduled as ps

PAGE = ('<time datetime="{{DATE_ISO}}">{{DATE_LONG}}</time> "datePublished":"{{DATE_ISO}}" '
        'see <a data-sched="%s">the other one</a> <ul><li data-sched-li="%s" hidden><a data-sched="%s">x</a></li></ul>')


class Publish(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.sched = os.path.join(self.root, 'blog', '_src', 'scheduled')
        for s, other in (('first', 'second'), ('second', 'first')):
            os.makedirs(os.path.join(self.sched, s))
            open(os.path.join(self.sched, s, 'index.html'), 'w').write(PAGE % (other, other, other))
        json.dump([
            {'slug': 'second', 'date': '2026-11-17', 'card': {'title': 'Second "one"', 'excerpt': 'B', 'image': 'https://img/2'}},
            {'slug': 'first', 'date': '2026-11-16', 'card': {'title': 'First', 'excerpt': 'A', 'image': 'https://img/1'}},
        ], open(os.path.join(self.sched, 'schedule.json'), 'w'))
        open(os.path.join(self.root, 'blog', 'index.html'), 'w').write('x\n                // READING:END\n                { id: 7 },\n')
        open(os.path.join(self.root, 'sitemap.xml'), 'w').write('<urlset>\n</urlset>\n')

    def read(self, *p):
        return open(os.path.join(self.root, *p)).read()

    def test_nothing_before_the_date(self):
        self.assertEqual(ps.publish(self.root, '2026-11-15'), [])
        self.assertFalse(os.path.exists(os.path.join(self.root, 'blog', 'first')))

    def test_publishes_on_the_date_with_real_dates_and_no_dead_links(self):
        self.assertEqual(ps.publish(self.root, '2026-11-16'), ['first'])
        page = self.read('blog', 'first', 'index.html')
        self.assertIn('datetime="2026-11-16">Monday, 16 November 2026<', page)
        self.assertIn('"datePublished":"2026-11-16"', page)
        self.assertNotIn('href="/blog/second/"', page, 'no link to a page that is not live')
        self.assertIn('<li data-sched-li="second" hidden>', page)
        idx = self.read('blog', 'index.html')
        self.assertIn('url: "/blog/first/"', idx)
        self.assertIn('date: "November 16, 2026"', idx)
        self.assertLess(idx.index('/blog/first/'), idx.index('{ id: 7 }'), 'newest card goes first')
        self.assertIn('<loc>https://thetechhut.co/blog/first/</loc>', self.read('sitemap.xml'))

    def test_next_day_links_both_ways_and_reruns_change_nothing(self):
        ps.publish(self.root, '2026-11-16')
        self.assertEqual(ps.publish(self.root, '2026-11-17'), ['second'])
        first = self.read('blog', 'first', 'index.html')
        self.assertIn('<a href="/blog/second/">the other one</a>', first)
        self.assertIn('<li><a href="/blog/second/">x</a></li>', first)
        self.assertIn('<a href="/blog/first/">', self.read('blog', 'second', 'index.html'))
        self.assertIn('title: "Second \\"one\\""', self.read('blog', 'index.html'))
        before = (self.read('blog', 'index.html'), self.read('sitemap.xml'), first)
        self.assertEqual(ps.publish(self.root, '2026-11-30'), [])
        self.assertEqual(before, (self.read('blog', 'index.html'), self.read('sitemap.xml'), self.read('blog', 'first', 'index.html')))

    def test_a_missed_day_catches_up(self):
        self.assertEqual(ps.publish(self.root, '2026-11-20'), ['first', 'second'])
        self.assertIn('datetime="2026-11-20"', self.read('blog', 'first', 'index.html'))


if __name__ == '__main__':
    unittest.main()
