"""Run: python3 -m unittest scripts/tests/test_fetch_jobs_snapshot.py -v   (from the repo root)

The build sandbox cannot reach Himalayas or any employer feed, so everything
here runs against sample payloads shaped like the documented responses.
"""
import datetime, io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import fetch_jobs_snapshot as fj

def _load(path):
    with open(path) as fh:
        return json.load(fh)


NOW = datetime.datetime(2026, 10, 14, 12, 0, tzinfo=datetime.timezone.utc)
ALL_TZ = [-11, -5, 0, 1, 2, 3, 3.5, 5.5, 8, 12]


def ts(days_ago):
    return int((NOW - datetime.timedelta(days=days_ago)).timestamp())


def job(title='Backend Engineer', company='Acme', slug='acme-backend', loc=None, tz=None, days=2, **kw):
    j = {'title': title, 'companyName': company, 'guid': 'https://himalayas.app/companies/acme/jobs/' + slug,
         'applicationLink': 'https://himalayas.app/companies/acme/jobs/' + slug,
         'locationRestrictions': [] if loc is None else loc,
         'timezoneRestrictions': ALL_TZ if tz is None else tz,
         'pubDate': ts(days), 'categories': [], 'parentCategories': []}
    j.update(kw)
    return j


def rows(*jobs):
    return fj.himalayas_rows({'jobs': list(jobs)}, NOW)



class NewPlatformRowsTest(unittest.TestCase):
    def test_smartrecruiters(self):
        payload = {'content': [
            {'id': '744', 'name': 'Data Engineer', 'releasedDate': '2026-10-20T10:19:51Z',
             'company': {'identifier': 'StandardBankGroup'},
             'location': {'fullLocation': 'Nairobi, Kenya', 'remote': False}},
            {'id': '745', 'name': 'SRE', 'company': {'identifier': 'StandardBankGroup'},
             'location': {'city': 'Lagos', 'country': 'ng', 'remote': True}},
            {'id': '746', 'name': '', 'company': {'identifier': 'StandardBankGroup'}, 'location': {}},
        ]}
        rows = fj.rows_from('smartrecruiters', payload)
        self.assertEqual(rows[0], ('Data Engineer', 'Nairobi, Kenya',
                                   'https://jobs.smartrecruiters.com/StandardBankGroup/744', '2026-10-20T10:19:51Z'))
        self.assertEqual(rows[1][1], 'Remote, Lagos, ng')
        self.assertEqual(len(rows), 2)
        self.assertEqual(fj.classify(rows[0][1]), 'local')

    def test_workable(self):
        payload = {'jobs': [
            {'title': 'IT Officer', 'city': 'Kigali', 'country': 'Rwanda', 'telecommuting': False,
             'url': 'https://apply.workable.com/j/ABC', 'published_on': '2026-09-28'},
            {'title': 'Analyst', 'city': '', 'country': '', 'telecommuting': True,
             'shortlink': 'https://apply.workable.com/j/DEF', 'created_at': '2026-09-01'},
        ]}
        rows = fj.rows_from('workable', payload)
        self.assertEqual(rows[0], ('IT Officer', 'Kigali, Rwanda', 'https://apply.workable.com/j/ABC', '2026-09-28'))
        self.assertEqual(rows[1], ('Analyst', 'Remote', 'https://apply.workable.com/j/DEF', '2026-09-01'))

    def test_breezy(self):
        payload = [
            {'name': 'Actuarial Associate', 'url': 'https://turaco.breezy.hr/p/5a7-actuarial-associate',
             'published_date': '2026-10-09T07:04:03.547Z',
             'location': {'city': 'Nairobi', 'country': {'name': 'Kenya', 'id': 'KE'}, 'name': 'Nairobi, KE', 'is_remote': False}},
            {'name': 'Transport Specialist', 'url': 'https://gozem.breezy.hr/p/1-transport',
             'published_date': '2026-10-01T00:00:00Z',
             'location': {'name': 'Cotonou, BJ', 'is_remote': True}},
            {'name': '', 'url': 'https://x.breezy.hr/p/2', 'location': {}},
        ]
        rows = fj.rows_from('breezy', payload)
        self.assertEqual(rows[0], ('Actuarial Associate', 'Nairobi, Kenya',
                                   'https://turaco.breezy.hr/p/5a7-actuarial-associate', '2026-10-09T07:04:03.547Z'))
        self.assertEqual(rows[1][1], 'Remote, Cotonou, BJ')
        self.assertEqual(len(rows), 2)
        self.assertEqual(fj.rows_from('breezy', {'not': 'a list'}), [])
        self.assertEqual(fj.feed_url('breezy', 'turaco'), 'https://turaco.breezy.hr/json')

    def test_feed_urls(self):
        self.assertEqual(fj.feed_url('smartrecruiters', 'StandardBankGroup'),
                         'https://api.smartrecruiters.com/v1/companies/StandardBankGroup/postings?limit=100')
        self.assertEqual(fj.feed_url('workable', 'afreximbank'),
                         'https://apply.workable.com/api/v1/widget/accounts/afreximbank')

class HimalayasRows(unittest.TestCase):
    def test_worldwide_tech_role_is_kept_and_credited(self):
        r = rows(job())
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]['reach'], 'global')
        self.assertEqual(r[0]['via'], 'Himalayas')
        self.assertEqual(r[0]['platform'], 'himalayas')
        self.assertTrue(r[0]['url'].startswith('https://himalayas.app/'))

    def test_location_mapping(self):
        self.assertEqual(fj.himalayas_location([]), 'Worldwide')
        self.assertEqual(fj.himalayas_location(['Worldwide']), 'Worldwide')
        self.assertEqual(fj.himalayas_location(['Kenya']), 'Kenya')
        self.assertEqual(fj.himalayas_location(['Kenya', 'Nigeria']), 'Kenya')
        self.assertEqual(fj.himalayas_location(['Africa']), 'Remote, Africa')
        self.assertEqual(fj.himalayas_location(['EMEA']), 'EMEA')
        self.assertIsNone(fj.himalayas_location(['United States']))
        self.assertIsNone(fj.himalayas_location(['France', 'Germany']))

    def test_classifier_agrees_with_the_mapped_strings(self):
        for restr, want in ([], 'global'), (['Africa'], 'global'), (['EMEA'], 'global'), (['Kenya'], 'local'):
            r = rows(job(loc=restr, slug='s-' + str(restr)))
            self.assertEqual(r[0]['reach'], want, restr)

    def test_role_pinned_to_other_countries_is_dropped(self):
        self.assertEqual(rows(job(loc=['United States'])), [])

    def test_time_zone_that_excludes_nairobi_is_dropped(self):
        self.assertEqual(rows(job(tz=[-8, -7, -6, -5])), [])
        self.assertEqual(len(rows(job(tz=[0, 1, 2, 3]))), 1)
        self.assertEqual(len(rows(job(tz=[]))), 1)          # no restriction listed

    def test_non_technical_roles_are_dropped_but_category_can_rescue(self):
        self.assertEqual(rows(job(title='Ministry Candidate Discernment: Phase II')), [])
        self.assertEqual(rows(job(title='Channel Sales Manager')), [])
        self.assertEqual(len(rows(job(title='Trust Lead', categories=['Software-Engineering']))), 1)

    def test_old_and_expired_roles_are_dropped(self):
        self.assertEqual(rows(job(days=45)), [])
        self.assertEqual(rows(job(expiryDate=ts(1))), [])
        self.assertEqual(len(rows(job(expiryDate=int((NOW + datetime.timedelta(days=5)).timestamp())))), 1)

    def test_only_himalayas_urls_are_ever_linked(self):
        bad = job(slug='x')
        bad['guid'] = bad['applicationLink'] = 'https://evil.example/apply'
        http = job(slug='y')
        http['guid'] = http['applicationLink'] = 'http://himalayas.app/companies/a/jobs/y'
        self.assertEqual(rows(bad, http), [])

    def test_malformed_rows_do_not_crash(self):
        self.assertEqual(fj.himalayas_rows({'jobs': [{}, {'title': 'x'}]}, NOW), [])
        self.assertEqual(fj.himalayas_rows({}, NOW), [])
        self.assertEqual(fj.himalayas_rows(None, NOW), [])
        r = rows(job(pubDate='garbage'))
        self.assertEqual(r[0]['posted'], '')


class HimalayasFetch(unittest.TestCase):
    def page(self, n, count=20):
        return {'jobs': [job(slug='p%d-%d' % (n, i), title='Engineer %d-%d' % (n, i), days=1 + (n * 20 + i) % 20) for i in range(count)]}

    def run_fetch(self, pages, env=None):
        calls = []
        self.headers = []

        def fetch(url, headers=None):
            calls.append(url)
            self.headers.append(dict(headers or {}))
            item = pages[len(calls) - 1] if len(calls) <= len(pages) else {'jobs': []}
            if isinstance(item, Exception):
                raise item
            return item
        slept = []
        out = fj.fetch_himalayas(fetch=fetch, sleep=slept.append, now=NOW, env=env or {})
        return out, calls, slept

    def test_pages_until_a_short_page_and_pauses_between_requests(self):
        (r, notes), calls, slept = self.run_fetch([self.page(1), self.page(2), self.page(3, 5)])
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(r), 45)
        self.assertEqual(notes, [])
        self.assertEqual(slept, [fj.HIMALAYAS_PAUSE, fj.HIMALAYAS_PAUSE])
        self.assertIn('country=KE', calls[0])
        self.assertIn('page=2', calls[1])

    def test_never_asks_for_more_than_the_page_cap(self):
        (r, notes), calls, _ = self.run_fetch([self.page(i) for i in range(1, 100)])
        self.assertEqual(len(calls), fj.HIMALAYAS_MAX_PAGES)

    def test_rate_limit_keeps_what_was_fetched_and_says_so(self):
        err = urllib.error.HTTPError('u', 429, 'Too Many', {}, None)
        (r, notes), calls, _ = self.run_fetch([self.page(1), err])
        self.assertEqual(len(r), 20)
        self.assertEqual(len(calls), 2)
        self.assertTrue(any('429' in n and 'rate limited' in n for n in notes))

    def test_network_failure_is_a_note_not_an_exception(self):
        (r, notes), _, _ = self.run_fetch([urllib.error.URLError('down')])
        self.assertEqual(r, [])
        self.assertEqual(len(notes), 1)

    def test_result_is_newest_first_capped_and_deduplicated(self):
        pages = [self.page(i) for i in range(1, 21)]            # 400 roles
        (r, _), _, _ = self.run_fetch(pages + [{'jobs': pages[0]['jobs']}])
        self.assertEqual(len(r), fj.HIMALAYAS_KEEP)
        self.assertEqual(r, sorted(r, key=lambda x: x['posted'], reverse=True))
        self.assertEqual(len({x['url'] for x in r}), len(r))

    def test_no_key_means_no_authorization_header(self):
        self.run_fetch([self.page(1, 5)])
        self.assertEqual(self.headers, [{}])

    def test_a_key_is_sent_as_a_bearer_token_on_every_page(self):
        (r, notes), calls, _ = self.run_fetch([self.page(1), self.page(2, 3)], env={'HIMALAYAS_API_KEY': 'hk_live_abc123XYZ'})
        self.assertEqual(self.headers, [{'Authorization': 'Bearer hk_live_abc123XYZ'}] * 2)
        self.assertEqual(notes, [])

    def test_a_rejected_key_is_reported_and_the_run_carries_on_without_it(self):
        err = urllib.error.HTTPError('u', 401, 'Unauthorized', {}, None)
        (r, notes), calls, _ = self.run_fetch([err, self.page(1, 5)], env={'HIMALAYAS_API_KEY': 'hk_revoked_000000'})
        self.assertEqual(len(r), 5)
        self.assertEqual(self.headers[0], {'Authorization': 'Bearer hk_revoked_000000'})
        self.assertEqual(self.headers[1], {})
        self.assertIn('page=1', calls[1])                       # the same page, retried
        self.assertTrue(any('401' in n for n in notes))
        self.assertFalse(any('hk_revoked' in n for n in notes)) # the key is never written out

    def test_a_malformed_key_is_never_put_in_a_header(self):
        (r, notes), _, _ = self.run_fetch([self.page(1, 2)], env={'HIMALAYAS_API_KEY': 'abc\r\nX-Evil: 1'})
        self.assertEqual(self.headers, [{}])
        self.assertTrue(any('does not look like a key' in n for n in notes))

    def test_401_without_a_key_is_just_a_note(self):
        err = urllib.error.HTTPError('u', 401, 'Unauthorized', {}, None)
        (r, notes), calls, _ = self.run_fetch([err])
        self.assertEqual(len(calls), 1)
        self.assertTrue(any('401' in n for n in notes))

    def test_the_apply_link_wins_when_it_points_at_himalayas(self):
        j = job(slug='a1')
        j['applicationLink'] = 'https://himalayas.app/companies/acme/jobs/a1/apply'
        self.assertEqual(rows(j)[0]['url'], 'https://himalayas.app/companies/acme/jobs/a1/apply')
        k = job(slug='a2')
        k['applicationLink'] = 'https://boards.greenhouse.io/acme/jobs/1'   # never send a buyer off Himalayas
        self.assertEqual(rows(k)[0]['url'], 'https://himalayas.app/companies/acme/jobs/a2')


class WholeRun(unittest.TestCase):
    """main() end to end with the network replaced and the data folder in a temp dir."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.saved = (fj.DATA, fj.SNAPS, fj.FEEDS, fj.PROBATION, fj.get, fj.fetch_himalayas)
        fj.DATA = self.tmp
        fj.SNAPS = os.path.join(self.tmp, 'snapshots')
        fj.FEEDS = [('Good Co', 'greenhouse', 'goodco')]
        fj.PROBATION = [('Maybe Co', 'ashby', 'maybeco')]
        os.environ.pop('REMOTE_LIST_TOKEN', None)

    def tearDown(self):
        fj.DATA, fj.SNAPS, fj.FEEDS, fj.PROBATION, fj.get, fj.fetch_himalayas = self.saved

    def run_main(self, hm_rows, hm_notes=(), probation_ok=False):
        def get(url):
            if 'goodco' in url:
                return {'jobs': [{'title': 'Platform Engineer', 'location': {'name': 'Remote - Worldwide'},
                                  'absolute_url': 'https://boards.example/goodco/1', 'updated_at': '2026-10-13T00:00:00Z'}]}
            if probation_ok:
                return {'data': [], 'jobs': []}
            raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
        fj.get = get
        fj.fetch_himalayas = lambda: (list(hm_rows), list(hm_notes))
        with redirect_stdout(io.StringIO()) as out:
            code = fj.main()
        snap = _load(os.path.join(fj.SNAPS, datetime.date.today().isoformat() + '.json'))
        summary = _load(os.path.join(self.tmp, 'remote-summary.json'))
        return code, snap, summary, out.getvalue()

    def hm(self, company, title, url_slug):
        return {'company': company, 'platform': 'himalayas', 'title': title, 'location': 'Worldwide',
                'url': 'https://himalayas.app/companies/x/jobs/' + url_slug, 'posted': '2026-10-13T00:00:00+00:00',
                'reach': 'global', 'via': 'Himalayas'}

    def test_a_broken_probation_feed_is_a_note_and_never_a_failure(self):
        code, snap, _, out = self.run_main([])
        self.assertEqual(code, 0)
        self.assertEqual(snap['failures'], [])
        self.assertTrue(any('Maybe Co' in n and 'probation' in n for n in snap['notes']))
        self.assertIn('never block the digest', out)

    def test_a_broken_proven_feed_is_still_a_failure(self):
        fj.FEEDS = [('Good Co', 'greenhouse', 'goodco'), ('Gone Co', 'greenhouse', 'gone')]
        orig = None

        def get(url):
            if 'gone' in url:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            if 'maybeco' in url:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return {'jobs': [{'title': 'SRE', 'location': {'name': 'Worldwide'}, 'absolute_url': 'https://b/1', 'updated_at': ''}]}
        fj.get = get
        fj.fetch_himalayas = lambda: ([], [])
        with redirect_stdout(io.StringIO()):
            fj.main()
        snap = _load(os.path.join(fj.SNAPS, datetime.date.today().isoformat() + '.json'))
        self.assertEqual(len(snap['failures']), 1)
        self.assertIn('Gone Co', snap['failures'][0])

    def test_himalayas_trouble_never_becomes_a_failure(self):
        code, snap, _, _ = self.run_main([], ['Himalayas page 1: HTTP 429 (rate limited, stopped)'])
        self.assertEqual(snap['failures'], [])
        self.assertTrue(any('Himalayas' in n for n in snap['notes']))

    def test_himalayas_roles_are_credited_and_the_source_is_declared(self):
        code, snap, summary, _ = self.run_main([self.hm('Newco', 'Data Engineer', 'de-1')])
        self.assertEqual(summary['sources'], ['Himalayas'])
        paid = os.path.join(self.tmp, 'l')
        self.assertFalse(os.path.exists(paid))                       # no token, no paid file (as before)
        self.assertTrue(any(r['platform'] == 'himalayas' for r in snap['roles']))

    def test_himalayas_roles_in_the_paid_file_carry_via_and_link_to_himalayas(self):
        os.environ['REMOTE_LIST_TOKEN'] = 'a' * 24
        try:
            self.run_main([self.hm('Newco', 'Data Engineer', 'de-1')])
        finally:
            os.environ.pop('REMOTE_LIST_TOKEN', None)
        full = _load(os.path.join(self.tmp, 'l', 'a' * 24 + '.json'))
        newco = [c for c in full['companies'] if c['company'] == 'Newco'][0]
        self.assertEqual(newco['roles'][0]['via'], 'Himalayas')
        self.assertTrue(newco['roles'][0]['url'].startswith('https://himalayas.app/'))
        goodco = [c for c in full['companies'] if c['company'] == 'Good Co'][0]
        self.assertNotIn('via', goodco['roles'][0])                  # employer links are untouched

    def test_an_employer_feed_wins_over_the_aggregators_copy(self):
        code, snap, summary, _ = self.run_main([self.hm('Good Co', 'Platform Engineer', 'dup'), self.hm('Newco', 'SRE', 'n1')])
        titles = [(r['company'], r['platform']) for r in snap['roles']]
        self.assertIn(('Good Co', 'greenhouse'), titles)
        self.assertNotIn(('Good Co', 'himalayas'), titles)
        self.assertIn(('Newco', 'himalayas'), titles)

    def test_no_himalayas_rows_means_no_source_credit(self):
        _, _, summary, _ = self.run_main([])
        self.assertNotIn('sources', summary)


class DigestIgnoresHimalayas(unittest.TestCase):
    def test_himalayas_kenya_roles_never_reach_the_digest(self):
        import send_digest as sd
        d = tempfile.mkdtemp()

        def snap(date, roles):
            with open(os.path.join(d, date + '.json'), 'w') as fh:
                json.dump({'date': date, 'count': len(roles), 'failures': [], 'roles': roles}, fh)
        ats = {'company': 'A', 'platform': 'ashby', 'title': 'Backend Engineer', 'location': 'Nairobi', 'url': 'https://a/1',
               'posted': '2026-10-12T00:00:00+00:00', 'reach': 'local'}
        hm = {'company': 'H', 'platform': 'himalayas', 'title': 'Backend Engineer', 'location': 'Kenya',
              'url': 'https://himalayas.app/companies/h/jobs/1', 'posted': '2026-10-12T00:00:00+00:00', 'reach': 'local', 'via': 'Himalayas'}
        snap('2026-10-06', [])
        snap('2026-10-13', [ats, hm])
        out = sd.build_digest(d)
        self.assertEqual(out['count'], 1)
        self.assertNotIn('himalayas.app', out['html'])


if __name__ == '__main__':
    unittest.main()
