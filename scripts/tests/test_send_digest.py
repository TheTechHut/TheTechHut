"""Run: python3 -m unittest scripts/tests/test_send_digest.py -v   (from the repo root)"""
import datetime, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import send_digest as sd


def role(url, title='Backend Engineer', company='M-KOPA', reach='local', posted='2026-10-10T00:00:00+00:00', platform='ashby', location='Nairobi'):
    return {'company': company, 'platform': platform, 'title': title, 'location': location, 'url': url, 'posted': posted, 'reach': reach}


class Digest(unittest.TestCase):
    def snaps(self, days):
        d = tempfile.mkdtemp()
        for date, roles, failures in days:
            with open(os.path.join(d, date + '.json'), 'w') as fh:
                json.dump({'date': date, 'count': len(roles), 'failures': failures, 'roles': roles}, fh)
        return d

    def test_only_roles_absent_a_week_ago_are_new(self):
        d = self.snaps([('2026-10-06', [role('u1')], []), ('2026-10-13', [role('u1'), role('u2', 'Data Analyst')], [])])
        out = sd.build_digest(d)
        self.assertEqual(out['count'], 1)
        self.assertIn('u2', out['html'])
        self.assertNotIn('href="u1"', out['html'])

    def test_remote_roles_are_never_included(self):
        d = self.snaps([('2026-10-06', [], []), ('2026-10-13', [role('g1', reach='global'), role('x1', reach=''), role('l1')], [])])
        out = sd.build_digest(d)
        self.assertEqual(out['count'], 1)
        self.assertNotIn('g1', out['html'])

    def test_a_feed_failure_refuses_rather_than_guessing(self):
        d = self.snaps([('2026-10-06', [role('u1')], []), ('2026-10-13', [role('u2')], ['Safaricom'])])
        with self.assertRaises(ValueError):
            sd.build_digest(d)

    def test_needs_real_history(self):
        d = self.snaps([('2026-10-12', [role('u1')], []), ('2026-10-13', [role('u2')], [])])
        with self.assertRaises(ValueError):
            sd.build_digest(d)

    def test_stale_postings_that_reappear_are_not_news(self):
        d = self.snaps([('2026-10-06', [], []), ('2026-10-13', [role('old', posted='2026-06-01T00:00:00+00:00'), role('fresh')], [])])
        self.assertEqual(sd.build_digest(d)['count'], 1)

    def test_picks_the_baseline_closest_to_a_week(self):
        d = self.snaps([('2026-10-01', [], []), ('2026-10-06', [role('u1')], []), ('2026-10-11', [role('u1')], []), ('2026-10-13', [role('u1'), role('u9')], [])])
        out = sd.build_digest(d)
        self.assertEqual(out['baseline'], datetime.date(2026, 10, 6))

    def test_duplicates_collapse_and_markup_is_escaped(self):
        d = self.snaps([('2026-10-06', [], []), ('2026-10-13', [role('u1', title='<b>Eng</b> & Co'), role('u1', title='dup')], [])])
        out = sd.build_digest(d)
        self.assertEqual(out['count'], 1)
        self.assertNotIn('<b>Eng</b>', out['html'])
        self.assertIn('&lt;b&gt;Eng', out['html'])

    def test_unsubscribe_placeholder_is_present_for_brevo(self):
        d = self.snaps([('2026-10-06', [], []), ('2026-10-13', [role('u1')], [])])
        self.assertIn('{{ unsubscribe }}', sd.build_digest(d)['html'])

    def test_family_rules(self):
        self.assertEqual(sd.family_of('Data Engineer'), 'data')
        self.assertEqual(sd.family_of('Product Designer'), 'design')
        self.assertEqual(sd.family_of('Senior Backend Engineer - Asset Sales'), 'engineering')
        self.assertEqual(sd.family_of('Product Manager'), 'product')
        self.assertEqual(sd.family_of('Finance Manager - Kenya'), 'ops')

    def test_checklist_is_shared_with_the_worker(self):
        c = sd.load_checklist()
        self.assertEqual(len(c['rules']), 6)
        for f in sd.FAMILY_ORDER:
            self.assertIn(f, c['families'])


class RealData(unittest.TestCase):
    def test_builds_from_the_committed_snapshots(self):
        if len(sd.load_snapshots(sd.SNAPS)) < 4:
            self.skipTest('not enough committed snapshots')
        out = sd.build_digest(sd.SNAPS)
        self.assertGreaterEqual(out['count'], 0)


class ParsePosted(unittest.TestCase):
    """Older snapshots carry Lever's createdAt as an integer in milliseconds."""
    def test_iso_and_epochs(self):
        import send_digest as sd
        self.assertEqual(str(sd.parse_posted('2026-10-12T00:00:00Z')), '2026-10-12')
        self.assertEqual(str(sd.parse_posted(1792500000000)), str(sd.parse_posted(1792500000)))
        self.assertTrue(str(sd.parse_posted(1792500000000)).startswith('2026-10-'))
        for bad in (None, '', 'soon', True, 10 ** 30):
            self.assertIsNone(sd.parse_posted(bad))


class DailyAlert(unittest.TestCase):
    snaps = Digest.snaps

    def test_compares_with_the_previous_day(self):
        d = self.snaps([('2026-10-12', [role('u1', title='Role u1')], []), ('2026-10-13', [role('u1', title='Role u1'), role('u2', title='Role u2')], [])])
        out = sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)
        self.assertEqual(out['count'], 1)
        self.assertEqual(out['baseline'], datetime.date(2026, 10, 12))
        self.assertEqual(out['name'], 'Daily openings 2026-10-13')
        self.assertIn('since yesterday', out['html'])
        self.assertIn('thetechhut.co/jobs/daily', out['html'])
        self.assertIn('today', out['subject'])

    def test_skips_a_baseline_day_whose_feeds_failed(self):
        d = self.snaps([('2026-10-11', [role('u1', title='Role u1'), role('u2', title='Role u2')], []), ('2026-10-12', [role('u1', title='Role u1')], ['M-KOPA']),
                        ('2026-10-13', [role('u1', title='Role u1'), role('u2', title='Role u2'), role('u3', title='Role u3')], [])])
        out = sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)
        self.assertEqual(out['baseline'], datetime.date(2026, 10, 11))
        self.assertEqual(out['count'], 1)

    def test_refuses_without_todays_snapshot_or_recent_history(self):
        d = self.snaps([('2026-10-12', [role('u1', title='Role u1')], []), ('2026-10-13', [role('u2', title='Role u2')], [])])
        with self.assertRaises(ValueError):
            sd.build_digest(d, today=datetime.date(2026, 10, 14), daily=True)
        d = self.snaps([('2026-10-01', [role('u1', title='Role u1')], []), ('2026-10-13', [role('u2', title='Role u2')], [])])
        with self.assertRaises(ValueError):
            sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)

    def test_remote_and_failed_today_rules_still_apply(self):
        d = self.snaps([('2026-10-12', [], []), ('2026-10-13', [role('g1', title='Role g1', reach='global'), role('l1', title='Role l1')], [])])
        self.assertEqual(sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)['count'], 1)
        d = self.snaps([('2026-10-12', [], []), ('2026-10-13', [role('l1', title='Role l1')], ['Safaricom'])])
        with self.assertRaises(ValueError):
            sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)

    def test_a_role_that_flickers_out_and_back_is_not_new_again(self):
        d = self.snaps([('2026-10-10', [role('u1', title='Role u1')], []), ('2026-10-11', [role('u1', title='Role u1')], []), ('2026-10-12', [], []),
                        ('2026-10-13', [role('u1', title='Role u1'), role('u2', title='Role u2')], [])])
        out = sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)
        self.assertEqual(out['count'], 1)
        self.assertNotIn('href="u1"', out['html'])

    def test_a_repost_under_a_new_link_is_not_new(self):
        d = self.snaps([('2026-10-12', [role('u1', title='Head of Finance')], []),
                        ('2026-10-13', [role('u1b', title='Head of  finance'), role('u2', title='Analyst')], [])])
        self.assertEqual(sd.build_digest(d, today=datetime.date(2026, 10, 13), daily=True)['count'], 1)

    def test_weekly_wording_is_unchanged(self):
        d = self.snaps([('2026-10-06', [], []), ('2026-10-13', [role('u1', title='Role u1')], [])])
        out = sd.build_digest(d)
        self.assertIn('since last week', out['html'])
        self.assertIn('thetechhut.co/cv-pack', out['html'])
        self.assertTrue(out['name'].startswith('Monday openings'))


if __name__ == '__main__':
    unittest.main()
