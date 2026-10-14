"""Run: python3 -m unittest scripts/tests/test_send_roundup.py -v   (from the repo root)"""
import datetime, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import send_roundup as sr

D = datetime.date


def fragment(lead='A lead story', stories=('One', 'Two'), number='Edition Nº 7', lede='Framing sentence.'):
    s = ''.join('<article class="story"><div class="txt"><h3>%s</h3><p>x</p></div></article>' % t for t in stories)
    return (
        '<!-- date: Monday, 5 October 2026 -->\n<!-- number: %s -->\n<p class="edition-lede">%s</p>\n'
        '<article class="lead"><div class="txt"><h3>%s</h3><p>dek</p></div></article>\n'
        '<div class="story-list">%s</div>\n' % (number, lede, lead, s))


class Roundup(unittest.TestCase):
    def dir(self, editions):
        d = tempfile.mkdtemp()
        for slug, text in editions.items():
            with open(os.path.join(d, slug + '.html'), 'w', encoding='utf-8') as fh:
                fh.write(text)
        return d

    def week(self, start='2026-10-11', n=7, **kw):
        s = D.fromisoformat(start)
        return {(s + datetime.timedelta(days=i)).isoformat(): fragment(lead='Lead %d' % i, **kw) for i in range(n)}

    def test_window_is_the_seven_days_that_ended_yesterday(self):
        self.assertEqual(sr.window_for(D(2026, 10, 18)), (D(2026, 10, 11), D(2026, 10, 17)))

    def test_consecutive_weeks_tile_with_no_gap_or_overlap(self):
        a = sr.window_for(D(2026, 10, 18))
        b = sr.window_for(D(2026, 10, 25))
        self.assertEqual(a[1] + datetime.timedelta(days=1), b[0])

    def test_only_editions_in_the_window_are_included(self):
        eds = self.week('2026-10-04', 14)         # 4 Oct .. 17 Oct
        r = sr.build_roundup(self.dir(eds), D(2026, 10, 18))
        self.assertEqual(r['editions'], 7)
        self.assertIn('/blog/daily/2026-10-17/', r['html'])
        self.assertIn('/blog/daily/2026-10-11/', r['html'])
        self.assertNotIn('/blog/daily/2026-10-10/', r['html'])
        self.assertNotIn('/blog/daily/2026-10-18/', r['html'])

    def test_newest_edition_comes_first_and_names_the_subject(self):
        r = sr.build_roundup(self.dir(self.week()), D(2026, 10, 18))
        self.assertTrue(r['html'].index('2026-10-17') < r['html'].index('2026-10-11'))
        self.assertIn('Lead 6', r['subject'])

    def test_counts_and_campaign_name(self):
        r = sr.build_roundup(self.dir(self.week(stories=('a', 'b'))), D(2026, 10, 18))
        self.assertEqual(r['editions'], 7)
        self.assertEqual(r['stories'], 21)         # lead + 2 stories, 7 days
        self.assertEqual(r['name'], 'Daily Savannah weekly 2026-W42')

    def test_unsubscribe_placeholder_is_present_for_brevo(self):
        r = sr.build_roundup(self.dir(self.week()), D(2026, 10, 18))
        self.assertIn('{{ unsubscribe }}', r['html'])

    def test_markup_and_entities_in_headlines_are_handled(self):
        eds = {'2026-10-12': fragment(lead='Safaricom &amp; <em>M-Pesa</em> <script>alert(1)</script> grow', stories=('Fees &lt; costs',))}
        r = sr.build_roundup(self.dir(eds), D(2026, 10, 18))
        self.assertNotIn('<script>', r['html'])
        self.assertNotIn('<em>', r['html'])
        self.assertIn('Safaricom &amp; M-Pesa alert(1) grow', r['html'])
        self.assertIn('Fees &lt; costs', r['html'])

    def test_long_headline_is_cut_at_a_word_in_the_subject(self):
        eds = {'2026-10-12': fragment(lead='word ' * 60)}
        r = sr.build_roundup(self.dir(eds), D(2026, 10, 18))
        self.assertLessEqual(len(r['subject']), sr.SUBJECT_MAX)
        self.assertTrue(r['subject'].endswith('…'))

    def test_extra_headlines_are_summarised_not_dumped(self):
        eds = {'2026-10-12': fragment(stories=tuple('S%d' % i for i in range(10)))}
        r = sr.build_roundup(self.dir(eds), D(2026, 10, 18))
        self.assertIn('S5', r['html'])
        self.assertNotIn('S6', r['html'])
        self.assertIn('+ 4 more in the edition', r['html'])

    def test_an_empty_week_raises_a_plain_reason(self):
        with self.assertRaises(ValueError):
            sr.build_roundup(self.dir({'2026-09-01': fragment()}), D(2026, 10, 18))

    def test_fragments_without_a_lead_are_ignored(self):
        eds = {'2026-10-12': '<p class="edition-lede">nothing here</p>', '2026-10-13': fragment()}
        r = sr.build_roundup(self.dir(eds), D(2026, 10, 18))
        self.assertEqual(r['editions'], 1)

    def test_thin_week_is_not_sent_without_force(self):
        d = self.dir(self.week(n=2))
        env_keys = ('BREVO_API_KEY', 'BREVO_LIST_ID_DAILY', 'BREVO_SENDER_EMAIL')
        old = {k: os.environ.pop(k, None) for k in env_keys}
        try:
            old_dir, sr.EDITIONS = sr.EDITIONS, d
            self.assertEqual(sr.main(['--today', '2026-10-18']), 0)          # returns before it needs any secret
        finally:
            sr.EDITIONS = old_dir
            for k, v in old.items():
                if v is not None:
                    os.environ[k] = v

    def test_real_editions_in_the_repo_parse(self):
        eds = sr.load_editions(sr.EDITIONS)
        self.assertGreater(len(eds), 30)
        self.assertTrue(all(e['lead'] for e in eds))


if __name__ == '__main__':
    unittest.main()
