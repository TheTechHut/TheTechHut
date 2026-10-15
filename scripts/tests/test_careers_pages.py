"""Run: python3 -m unittest discover -s scripts/tests -v   (from the repo root)

Nothing here touches the network. A fake `fetch` stands in for the web and records
every URL asked for, so the tests can prove what the crawler did NOT request.
"""
import datetime, io, json, os, sys, tempfile, unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import careers_pages as cp
import fetch_jobs_snapshot as fj
import send_digest as sd

TODAY = datetime.date(2026, 10, 15)
CAREERS = 'https://acme.com/careers'


def ld(*objs):
    return '<script type="application/ld+json">%s</script>' % json.dumps(list(objs) if len(objs) > 1 else objs[0])


def posting(title='Backend Engineer', **kw):
    p = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title,
         'description': '<p>SECRET DESCRIPTION</p>', 'datePosted': '2026-10-10',
         'jobLocationType': 'TELECOMMUTE',
         'applicantLocationRequirements': [{'@type': 'Country', 'name': 'Kenya'}]}
    p.update(kw)
    return p


class FakeWeb:
    """pages: url -> (status, body[, final_url]). Anything unlisted is a 404."""
    def __init__(self, pages):
        self.pages, self.asked, self.sleeps = pages, [], []

    def fetch(self, url):
        self.asked.append(url)
        hit = self.pages.get(url)
        if hit is None:
            return 404, '', url
        return hit[0], hit[1], (hit[2] if len(hit) > 2 else url)

    def sleep(self, s):
        self.sleeps.append(s)


def src(**kw):
    s = {'name': 'Acme', 'careers_url': CAREERS, 'allowed_by': 'terms-and-robots-reviewed',
         'reviewed_on': '2026-10-01', 'review_note': 'terms silent on bots, robots.txt allows /careers'}
    s.update(kw)
    return s


def crawl(web, **kw):
    return cp.crawl_source(src(**kw), fetch=web.fetch, sleep=web.sleep, today=TODAY)


class RobotsGate(unittest.TestCase):
    def robots(self, status, body=''):
        web = FakeWeb({'https://acme.com/robots.txt': (status, body)})
        return cp.load_robots(CAREERS, web.fetch)

    def test_disallow_is_obeyed_for_our_agent_and_for_everyone(self):
        r = self.robots(200, 'User-agent: *\nDisallow: /careers\n')
        self.assertFalse(r.allowed(CAREERS))
        r = self.robots(200, 'User-agent: TheTechHutBot\nDisallow: /\n')
        self.assertFalse(r.allowed('https://acme.com/anything'))

    def test_other_bots_being_blocked_does_not_block_us(self):
        r = self.robots(200, 'User-agent: GPTBot\nDisallow: /\n')
        self.assertTrue(r.allowed(CAREERS))

    def test_no_robots_file_means_nothing_is_forbidden(self):
        self.assertTrue(self.robots(404).allowed(CAREERS))

    def test_a_web_app_answering_with_its_page_is_not_a_robots_file(self):
        self.assertTrue(self.robots(200, '<!doctype html><html><body>app</body></html>').allowed(CAREERS))

    def test_server_error_forbidden_throttled_and_network_failure_all_mean_no(self):
        for status in (500, 503, 401, 403, 429, None):
            r = self.robots(status)
            self.assertTrue(r.blocked_reason, status)
            self.assertFalse(r.allowed(CAREERS), status)

    def test_crawl_delay_and_sitemaps_are_read(self):
        r = self.robots(200, 'User-agent: *\nCrawl-delay: 7\nSitemap: https://acme.com/sm.xml\n')
        self.assertEqual(r.delay, 7)
        self.assertEqual(r.sitemaps, ['https://acme.com/sm.xml'])


class JobMarkup(unittest.TestCase):
    def test_finds_postings_in_plain_graph_list_and_type_array_forms(self):
        page = (ld(posting('One')) +
                ld({'@graph': [{'@type': 'WebSite'}, posting('Two')]}) +
                ld(posting('Three', **{'@type': ['JobPosting', 'Thing']}), {'@type': 'Organization'}))
        self.assertEqual([p['title'] for p in cp.job_postings(page)], ['One', 'Two', 'Three'])

    def test_broken_json_is_ignored_and_escaped_json_is_recovered(self):
        escaped = '<script type="application/ld+json">%s</script>' % json.dumps(posting('Esc')).replace('"', '&quot;')
        page = '<script type="application/ld+json">{not json</script>' + escaped
        self.assertEqual([p['title'] for p in cp.job_postings(page)], ['Esc'])

    def test_row_keeps_title_place_date_and_link_but_never_the_description(self):
        row = cp.posting_row(posting(), CAREERS + '/backend', 'Acme', CAREERS, TODAY)
        self.assertEqual(row['title'], 'Backend Engineer')
        self.assertEqual(row['posted'], '2026-10-10')
        self.assertEqual(row['url'], CAREERS + '/backend')
        self.assertEqual(row['platform'], 'careers-page')
        self.assertNotIn('SECRET', json.dumps(row))

    def test_expired_and_untitled_postings_are_dropped(self):
        self.assertIsNone(cp.posting_row(posting(validThrough='2026-10-01'), CAREERS, 'Acme', CAREERS, TODAY))
        self.assertIsNone(cp.posting_row(posting(title='  '), CAREERS, 'Acme', CAREERS, TODAY))
        self.assertIsNotNone(cp.posting_row(posting(validThrough='2026-10-30T00:00'), CAREERS, 'Acme', CAREERS, TODAY))

    def test_a_link_pointing_off_the_employers_site_is_replaced_by_the_page_itself(self):
        row = cp.posting_row(posting(url='https://evil.example/apply'), CAREERS + '/x', 'Acme', CAREERS, TODAY)
        self.assertEqual(row['url'], CAREERS + '/x')
        self.assertIsNone(cp.posting_row(posting(), 'https://evil.example/x', 'Acme', CAREERS, TODAY))

    def test_a_subdomain_of_the_employer_counts_as_their_site(self):
        row = cp.posting_row(posting(url='https://jobs.acme.com/123'), CAREERS, 'Acme', CAREERS, TODAY)
        self.assertEqual(row['url'], 'https://jobs.acme.com/123')

    def location(self, **kw):
        base = {'@type': 'JobPosting', 'title': 'T'}
        base.update(kw)
        return cp.location_text(base)

    def test_remote_locations_use_the_boards_own_wording(self):
        tele = {'jobLocationType': 'TELECOMMUTE'}
        self.assertEqual(self.location(**tele), 'Remote')           # open to whom? not stated
        self.assertEqual(self.location(applicantLocationRequirements={'@type': 'Country', 'name': 'Worldwide'}, **tele), 'Worldwide')
        self.assertEqual(self.location(applicantLocationRequirements=[{'name': 'Africa'}], **tele), 'Remote, Africa')
        self.assertEqual(self.location(applicantLocationRequirements=['Kenya', 'Uganda'], **tele), 'Remote, Kenya, Uganda')

    def test_office_locations_become_city_region_country(self):
        loc = {'@type': 'Place', 'address': {'addressLocality': 'Nairobi', 'addressCountry': {'name': 'Kenya'}}}
        self.assertEqual(self.location(jobLocation=loc), 'Nairobi, Kenya')
        self.assertEqual(self.location(jobLocation=[loc, {'address': {'addressCountry': 'DE'}}]), 'Nairobi, Kenya; DE')
        self.assertEqual(self.location(), '')

    def test_the_boards_eligibility_rules_agree(self):
        self.assertEqual(fj.classify('Remote'), '')
        self.assertEqual(fj.classify('Worldwide'), 'global')
        self.assertEqual(fj.classify('Remote, Africa'), 'global')
        self.assertEqual(fj.classify('Remote, United States'), '')
        self.assertEqual(fj.classify('Nairobi, Kenya'), 'local')


class Registry(unittest.TestCase):
    def load(self, sources):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'r.json')
            with open(p, 'w') as fh:
                json.dump({'sources': sources}, fh)
            return cp.load_sources(p, TODAY)

    def test_a_reviewed_current_entry_loads(self):
        got, notes = self.load([src()])
        self.assertEqual(len(got), 1)
        self.assertEqual(notes, [])

    def test_unreviewed_stale_or_malformed_entries_are_skipped_with_a_reason(self):
        bad = [
            src(allowed_by='trust-me'), src(allowed_by=None),
            src(reviewed_on=None), src(reviewed_on='yesterday'),
            src(reviewed_on='2026-01-01'),                 # older than 180 days
            src(reviewed_on='2027-01-01'),                 # in the future
            src(careers_url='http://acme.com/careers'),    # not https
            src(job_url_pattern='('),                      # broken regex
        ]
        got, notes = self.load(bad)
        self.assertEqual(got, [])
        self.assertEqual(len(notes), len(bad))
        self.assertTrue(all('skipped' in n for n in notes))

    def test_disabled_entries_are_silently_off(self):
        got, notes = self.load([src(enabled=False)])
        self.assertEqual((got, notes), ([], []))

    def test_missing_or_broken_file(self):
        self.assertEqual(cp.load_sources('/nonexistent/x.json', TODAY), ([], []))
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'r.json')
            with open(p, 'w') as fh:
                fh.write('{oops')
            self.assertEqual(len(cp.load_sources(p, TODAY)[1]), 1)

    def test_the_shipped_registry_is_valid_and_every_entry_is_reviewed(self):
        got, notes = cp.load_sources(cp.REGISTRY, datetime.date.today())
        with open(cp.REGISTRY) as fh:
            declared = [s for s in json.load(fh)['sources'] if s.get('enabled') is not False]
        # fails (and tells you why) when a review has expired or an entry is half filled in
        self.assertEqual(len(got), len(declared), notes)
        for s in declared:
            self.assertTrue(s.get('review_note'), '%s needs a review_note' % s.get('name'))
            self.assertNotIn('playrix', s.get('careers_url', '').lower(), 'Playrix\'s terms forbid this')


class Crawl(unittest.TestCase):
    ROBOTS = 'https://acme.com/robots.txt'

    def site(self, robots=(404, ''), **extra):
        pages = {self.ROBOTS: robots,
                 CAREERS: (200, '<a href="/careers/backend">b</a><a href="/careers/about">x</a>' + ld(posting('Listed'))),
                 'https://acme.com/careers/backend': (200, ld(posting('Backend'))),
                 'https://acme.com/careers/about': (200, '<p>about</p>')}
        pages.update(extra)
        return FakeWeb(pages)

    PATTERN = r'^https://acme\.com/careers/[a-z]+$'

    def test_reads_the_careers_page_and_follows_matching_links(self):
        web = self.site()
        rows, notes = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual(sorted(r['title'] for r in rows), ['Backend', 'Listed'])
        self.assertIn('https://acme.com/careers/about', web.asked)    # matched the pattern, had no markup
        self.assertEqual(notes, [])

    def test_without_a_pattern_no_links_are_followed(self):
        web = self.site()
        rows, _ = crawl(web)
        self.assertEqual([r['title'] for r in rows], ['Listed'])
        self.assertNotIn('https://acme.com/careers/backend', web.asked)

    def test_robots_disallowing_the_careers_page_means_nothing_is_fetched_but_robots_txt(self):
        web = self.site(robots=(200, 'User-agent: *\nDisallow: /careers\n'))
        rows, notes = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual(rows, [])
        self.assertEqual(web.asked, [self.ROBOTS])
        self.assertIn('disallows', notes[0])

    def test_a_disallowed_job_page_is_skipped_but_the_rest_are_read(self):
        web = self.site(robots=(200, 'User-agent: *\nDisallow: /careers/backend\n'))
        rows, notes = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual([r['title'] for r in rows], ['Listed'])
        self.assertNotIn('https://acme.com/careers/backend', web.asked)
        self.assertTrue(any('careers/backend' in n for n in notes))

    def test_unreadable_robots_txt_means_the_site_is_not_touched(self):
        web = self.site(robots=(503, ''))
        rows, notes = crawl(web)
        self.assertEqual(rows, [])
        self.assertEqual(web.asked, [self.ROBOTS])
        self.assertIn('503', notes[0])

    def test_waits_before_every_request_after_robots_and_honours_crawl_delay(self):
        web = self.site()
        crawl(web, job_url_pattern=self.PATTERN)
        self.assertTrue(web.sleeps and min(web.sleeps) >= cp.MIN_PAUSE)
        self.assertEqual(len(web.sleeps), len(web.asked) - 1)          # every request but robots.txt
        slow = self.site(robots=(200, 'User-agent: *\nCrawl-delay: 6\n'))
        crawl(slow, job_url_pattern=self.PATTERN)
        self.assertEqual(set(slow.sleeps), {6.0})
        huge = self.site(robots=(200, 'User-agent: *\nCrawl-delay: 900\n'))
        crawl(huge, job_url_pattern=self.PATTERN)
        self.assertEqual(set(huge.sleeps), {cp.MAX_PAUSE})

    def test_page_cap_stops_the_crawl_and_says_so(self):
        links = ''.join('<a href="/careers/j%s">j</a>' % 'abcdefghij'[i] for i in range(10))
        pages = {self.ROBOTS: (404, ''), CAREERS: (200, links)}
        for i in range(10):
            pages['https://acme.com/careers/j' + 'abcdefghij'[i]] = (200, ld(posting('J%d' % i)))
        web = FakeWeb(pages)
        rows, notes = crawl(web, job_url_pattern=r'/careers/j[a-j]$', max_jobs=3)
        self.assertEqual(len(rows), 3)
        self.assertEqual(len(web.asked), 1 + 1 + 3)                    # robots, careers page, 3 jobs
        self.assertTrue(any('cap' in n for n in notes))

    def test_sitemap_urls_are_filtered_by_pattern_and_robots(self):
        sm = ('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
              '<url><loc>https://acme.com/careers/backend</loc></url>'
              '<url><loc>https://acme.com/blog/post</loc></url>'
              '<url><loc>https://other.com/careers/x</loc></url></urlset>')
        web = self.site(**{'https://acme.com/sm.xml': (200, sm)})
        web.pages[CAREERS] = (200, '<p>no markup here</p>')
        rows, _ = crawl(web, sitemap='https://acme.com/sm.xml', job_url_pattern=self.PATTERN)
        self.assertEqual([r['title'] for r in rows], ['Backend'])
        self.assertNotIn('https://acme.com/blog/post', web.asked)
        self.assertNotIn('https://other.com/careers/x', web.asked)

    def test_sitemaps_named_in_robots_txt_are_used(self):
        sm = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.com/careers/backend</loc></url></urlset>'
        web = self.site(robots=(200, 'User-agent: *\nSitemap: https://acme.com/s.xml\n'), **{'https://acme.com/s.xml': (200, sm)})
        web.pages[CAREERS] = (200, '<p>none</p>')
        rows, _ = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual([r['title'] for r in rows], ['Backend'])

    def test_a_redirect_off_the_employers_site_is_dropped(self):
        web = self.site(**{'https://acme.com/careers/backend': (200, ld(posting('Hijacked')), 'https://elsewhere.example/p')})
        rows, _ = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual([r['title'] for r in rows], ['Listed'])

    def test_a_site_with_no_markup_leaves_a_note_not_an_error(self):
        web = FakeWeb({self.ROBOTS: (404, ''), CAREERS: (200, '<p>plain page</p>')})
        rows, notes = crawl(web)
        self.assertEqual(rows, [])
        self.assertIn('no JobPosting data', notes[0])

    def test_careers_page_errors_and_surprises_never_raise(self):
        self.assertIn('404', crawl(FakeWeb({self.ROBOTS: (404, '')}))[1][0])

        def boom(url):
            raise RuntimeError('socket exploded')
        rows, notes = cp.crawl_source(src(), fetch=boom, sleep=lambda s: None, today=TODAY)
        self.assertEqual(rows, [])
        self.assertIn('socket exploded', notes[0])

    def test_duplicate_postings_are_collapsed(self):
        web = self.site()
        web.pages['https://acme.com/careers/backend'] = (200, ld(posting('Listed')) )
        rows, _ = crawl(web, job_url_pattern=self.PATTERN)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r['url'] for r in rows}), 2)


class Check(unittest.TestCase):
    def test_check_reports_a_blocked_site_without_crawling_it(self):
        web = FakeWeb({'https://acme.com/robots.txt': (200, 'User-agent: *\nDisallow: /\n')})
        out = '\n'.join(cp.check(CAREERS, fetch=web.fetch, sleep=web.sleep))
        self.assertIn('DISALLOWS', out)
        self.assertIn('do not add', out)
        self.assertEqual(web.asked, ['https://acme.com/robots.txt'])

    def test_check_samples_a_good_site_and_reminds_you_about_the_terms(self):
        web = FakeWeb({'https://acme.com/robots.txt': (404, ''), CAREERS: (200, ld(posting('Sample')))})
        out = '\n'.join(cp.check(CAREERS, fetch=web.fetch, sleep=web.sleep))
        self.assertIn('Sample', out)
        self.assertIn('does NOT check the site', out)
        self.assertEqual('\n'.join(cp.check('http://acme.com/careers')), 'careers URL must start with https://')


class InTheSnapshot(unittest.TestCase):
    def test_rows_get_a_reach_and_notes_flow_through(self):
        web = FakeWeb({'https://acme.com/robots.txt': (404, ''),
                       CAREERS: (200, ld(posting('Africa remote', applicantLocationRequirements=[{'name': 'Africa'}]),
                                         posting('Kenya office', jobLocationType=None,
                                                 jobLocation={'address': {'addressLocality': 'Nairobi', 'addressCountry': 'Kenya'}}),
                                         posting('Unstated', applicantLocationRequirements=None)))})
        with tempfile.TemporaryDirectory() as d:
            reg = os.path.join(d, 'r.json')
            with open(reg, 'w') as fh:
                json.dump({'sources': [src(), src(name='Stale', reviewed_on='2025-01-01')]}, fh)
            with redirect_stdout(io.StringIO()):
                rows, notes = fj.fetch_careers_sources(reg, fetch=web.fetch, sleep=web.sleep, today=TODAY)
        self.assertEqual({r['title']: r['reach'] for r in rows},
                         {'Africa remote': 'global', 'Kenya office': 'local', 'Unstated': ''})
        self.assertTrue(any('Stale' in n for n in notes))

    def test_an_empty_registry_changes_nothing(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(fj.fetch_careers_sources('/nonexistent.json', today=TODAY), ([], []))

    def test_digest_ignores_careers_page_rows(self):
        with tempfile.TemporaryDirectory() as d:
            def snap(day, roles):
                with open(os.path.join(d, day + '.json'), 'w') as fh:
                    json.dump({'date': day, 'failures': [], 'roles': roles}, fh)
            old = {'company': 'A', 'platform': 'greenhouse', 'title': 'Old', 'location': 'Nairobi', 'url': 'https://a/1', 'posted': '', 'reach': 'local'}
            new = dict(old, title='Fresh', url='https://a/2')
            cpr = dict(old, platform='careers-page', title='Careers role', url='https://acme.com/careers/x')
            snap('2026-10-01', [old])
            snap('2026-10-08', [old, new, cpr])
            _, _, found = sd.find_new_roles(d, today=datetime.date(2026, 10, 8))
        self.assertEqual([r['title'] for r in found], ['Fresh'])


if __name__ == '__main__':
    unittest.main()
