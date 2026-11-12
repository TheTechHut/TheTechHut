/* The Tech Hut jobs board: where the roles come from and how they are read.
 *
 * Shared by the page (/jobs/), which falls back to reading the feeds live, and
 * by scripts/build_jobs_board.js, which reads them every few hours on GitHub
 * Actions and writes /data/jobs-board.json, the one small file the page loads
 * first. Plain ES5 with no DOM, so it runs in the browser and in Node 18+.
 *
 * Browser: <script src="/assets/js/jobs-feeds.js"></script> -> window.TTHFeeds
 * Node:    var F = require('../assets/js/jobs-feeds.js')
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TTHFeeds = api;
})(this, function () {
  // --- helpers -------------------------------------------------------------
  // External text is untrusted: strip markup entirely, decode the common entities.
  // No DOM here, so the same code runs in the browser and in Node.
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  function decode(t) {
    return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
    });
  }
  function clean(s, max) {
    if (!s) return '';
    var t = String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    t = decode(decode(t)).replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    return max && t.length > max ? t.slice(0, max).replace(/\s\S*$/, '') + '…' : t;
  }
  function titleCase(s) {
    return String(s || '').replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); }).trim();
  }
  function ago(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 60) return m <= 1 ? 'just now' : m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    var mo = Math.floor(d / 30); return mo + (mo === 1 ? ' month ago' : ' months ago');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : ''; }

  // Remote OK's tags are unreliable (a retail role comes tagged "dev"), so roles are
  // classified on the job TITLE only, in three tiers: strong tech wins outright,
  // an explicit non-tech word rules a role out, otherwise a looser tech match decides.
  var STRONG = /(developer|engineer|engineering|software|programmer|devops|\bsre\b|full.?stack|front.?end|back.?end|data scien|data analyst|data engineer|machine learning|\bml\b|\bai\b|cyber ?security|infosec|\bqa\b|\bux\b|\bui\b|product design|product manager|web design|technical writer|solutions architect|cloud|database|sysadmin|system administrator|network admin|it support|help ?desk|scrum|technical support)/i;
  var NONTECH = /(maintenance|janitor|cleaner|housekeep|store manager|retail|cashier|barista|waiter|waitress|chef|cook|nurse|caregiver|therapist|driver|delivery|warehouse|forklift|teacher|tutor|babysit|nanny|landscap|plumb|electrician|carpent|welder|mechanic|security guard|receptionist|dog |groom|business development|relationship manager)/i;
  var TECH = /(develop|engineer|software|front.?end|back.?end|full.?stack|data|devops|cloud|security|mobile|\bios\b|android|python|javascript|typescript|react|node|\bjava\b|golang|\brust\b|\bruby\b|php|design|\bui\b|\bux\b|product|\bqa\b|machine.?learning|\bai\b|\bml\b|analyst|architect|sre|platform|\bapi\b|database|sql|\bit\b|cyber|scrum|webflow|wordpress)/i;
  function isTechRole(title) {
    if (STRONG.test(title)) return true;
    if (NONTECH.test(title)) return false;
    return TECH.test(title);
  }
  // Where is the role? Kenya first, then the rest of Africa, then anywhere-remote.
  var KE = /(kenya|nairobi|mombasa|kisumu|eldoret|nakuru|nyeri|kakamega|thika|machakos|kilifi|rukanga|sagana|naivasha|malindi)/i;
  var AF = /(africa|casablanca|rabat|marrakech|tunis|algiers|oran|lom[eé]|cotonou|douala|yaound|libreville|gabon|gaborone|harare|lusaka|lilongwe|bamako|ouagadougou|niamey|conakry|freetown|monrovia|banjul|giza|alexandria|kano|ibadan|port harcourt|durban|pretoria|stellenbosch|centurion|sandton|bloemfontein|ebene|port louis|angola|luanda|namibia|windhoek|mozambique|maputo|mauritius|lesotho|eswatini|madagascar|south sudan|somalia|burundi|congo|kinshasa|cameroon|tunisia|algeria|nigeria|lagos|abuja|oyo|ilorin|ghana|accra|uganda|kampala|tanzania|dar es|rwanda|kigali|ethiopia|addis|egypt|cairo|johannesburg|cape town|senegal|dakar|ivory coast|c[oô]te d.?ivoire|western cape|gauteng|abidjan|zambia|malawi|morocco|benin|togo|zimbabwe|botswana)/i;
  var RM = /(remote|anywhere|worldwide|distributed|global)/i;
  var REGION_RANK = { 'Kenya': 0, 'Rest of Africa': 1, 'Remote': 2, 'Elsewhere': 3 };
  // A role posted in several places: show the main one, but say so when Kenya is among the
  // others, and sort it by every place it is open in (j.where).
  function placeLabel(main, others) {
    main = clean(main); others = (others || []).map(clean).filter(function (o) { return o && o !== main; });
    if (!main && others.length) main = others.shift();
    if (!others.length) return main;
    if (!KE.test(main)) {
      var ke = others.filter(function (o) { return KE.test(o); })[0];
      if (ke) return main + ' · also ' + ke;
    }
    return main + ' + ' + others.length + ' more';
  }
  // Early careers, from the title: internships and attachments, apprenticeships,
  // graduate and trainee schemes, and entry-level roles.
  var STAGES = [
    ['intern',     /\bintern(s|ship|ships)?\b|\battach(ment|ee)\b|industrial training|work[- ]study|placement student/i, 'Internship'],
    ['apprentice', /apprentic/i, 'Apprenticeship'],
    ['graduate',   /graduate|trainee|early[- ]careers?|\bgrad\b|young professional/i, 'Graduate scheme'],
    ['entry',      /junior|entry[- ]level|\bjr\b/i, 'Entry level']
  ];
  function stageOf(title, level) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i][1].test(title || '')) return STAGES[i][0];
    return /^entry/i.test(level || '') ? 'entry' : '';
  }
  function stageLabel(key) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i][0] === key) return STAGES[i][2];
    return '';
  }
  // A whole programme ("Graduate Programme 2027") is let through even without a tech word in it.
  var PROGRAMME = /(graduate|trainee|internship|apprenticeship|attachment)\s+(programme|program|scheme)|management trainee|graduate trainee/i;
  function regionOf(loc) {
    var l = loc || '';
    if (KE.test(l)) return 'Kenya';
    if (AF.test(l)) return 'Rest of Africa';
    if (RM.test(l)) return 'Remote';
    return 'Elsewhere';
  }

  function catFromTitle(t) {
    if (/(devops|\bsre\b|infrastructure|platform|cloud|kubernetes)/i.test(t)) return 'DevOps & Infrastructure';
    if (/(security|cyber|infosec)/i.test(t)) return 'Cybersecurity';
    if (/(data|analyst|analytics|machine learning|\bml\b|\bai\b)/i.test(t)) return 'Data & AI';
    if (/(design|\bux\b|\bui\b)/i.test(t)) return 'Design';
    if (/(product manager|product owner)/i.test(t)) return 'Product & Operations';
    if (/(\bqa\b|test)/i.test(t)) return 'QA & Testing';
    if (/(support|help ?desk)/i.test(t)) return 'Technical Support';
    return 'Software Engineering';
  }

  // --- sources -------------------------------------------------------------
  function fromJobicy(d) {
    return (d && d.jobs || []).map(function (j) {
      return {
        id: 'jobicy-' + j.id,
        title: clean(j.jobTitle),
        company: clean(j.companyName),
        logo: safeUrl(j.companyLogo),
        location: clean(j.jobGeo) || 'Anywhere',
        types: [].concat(j.jobType || []).map(clean).filter(Boolean),
        cats: [].concat(j.jobIndustry || []).map(clean).filter(Boolean),
        level: clean(j.jobLevel),
        excerpt: clean(j.jobExcerpt, 190),
        url: safeUrl(j.url),
        date: j.pubDate,
        source: 'Jobicy'
      };
    });
  }
  function fromRemoteOK(arr) {
    return (Array.isArray(arr) ? arr : []).filter(function (j) { return j && j.position; })
      .map(function (j) {
        var title = clean(j.position);
        return {
          id: 'rok-' + j.id,
          title: title,
          company: clean(j.company),
          logo: safeUrl(j.company_logo || j.logo),
          location: clean(j.location).replace(/,\s*$/, '') || 'Anywhere',
          types: [],
          cats: [catFromTitle(title)],
          level: '',
          excerpt: clean(j.description, 190),
          url: safeUrl(j.url || j.apply_url),
          date: j.date,
          source: 'Remote OK',
          _tags: (j.tags || []).map(clean).filter(Boolean)
        };
      })
      .filter(function (j) { return isTechRole(j.title); });
  }

  // --- employer ATS boards --------------------------------------------------
  // Companies hiring into Kenya publish their openings through applicant tracking
  // systems whose job-board APIs are public, documented and CORS-enabled — so these
  // are read directly, not scraped. Add a company by putting its board slug here;
  // find the slug in the careers-page URL (jobs.ashbyhq.com/<slug>, etc).
  var COMPANIES = [
    { name: 'M-KOPA',            ats: 'ashby',      slug: 'm-kopa' },
    { name: 'Andela',            ats: 'ashby',      slug: 'andela' },
    { name: 'One Acre Fund',     ats: 'greenhouse', slug: 'oneacrefund' },
    { name: 'Jumia',             ats: 'greenhouse', slug: 'jumia' },
    { name: 'Zipline',           ats: 'greenhouse', slug: 'flyzipline' },
    { name: 'Tala',              ats: 'lever',      slug: 'tala' },
    { name: 'Apollo Agriculture', ats: 'lever',     slug: 'apolloagriculture' },
    { name: 'Sun King',          ats: 'pinpoint',   slug: 'sunking' },
    { name: 'GiveDirectly',      ats: 'greenhouse', slug: 'givedirectly' },
    { name: 'Canonical',         ats: 'greenhouse', slug: 'canonical' },
    // Moniepoint's board lives on Greenhouse's EU host (job-boards.eu.greenhouse.io),
    // but the public API at boards-api.greenhouse.io serves it like any other board.
    { name: 'Moniepoint',        ats: 'greenhouse', slug: 'moniepoint' },
    // SmartRecruiters' Posting API and Workable's job widget API are public, documented
    // and CORS-enabled, like the ATS feeds above. Standard Bank's list includes Stanbic.
    { name: 'Standard Bank Group', ats: 'smartrecruiters', slug: 'StandardBankGroup' },
    { name: 'Afreximbank',       ats: 'workable',   slug: 'afreximbank' },
    // Tech companies and insurers across Africa (checked 20 Oct 2026). Breezy publishes a
    // public JSON list of each company's open positions at <company>.breezy.hr/json.
    { name: 'Ajua',              ats: 'smartrecruiters', slug: 'Ajua' },
    { name: 'Watu',              ats: 'smartrecruiters', slug: 'WatuCreditLtd' },
    { name: 'Turaco',            ats: 'breezy',     slug: 'turaco' },
    { name: 'Cellulant',         ats: 'breezy',     slug: 'cellulant-group' },
    { name: 'Wasoko',            ats: 'breezy',     slug: 'wasoko' },
    { name: 'Ilara Health',      ats: 'workable',   slug: 'ilara-health' },
    { name: 'Gebeya',            ats: 'workable',   slug: 'gebeya-inc' },
    { name: 'Irembo',            ats: 'greenhouse', slug: 'iremboltd' },
    { name: 'Yassir',            ats: 'lever',      slug: 'Yassir' },
    { name: 'FairMoney',         ats: 'workable',   slug: 'fairmoney' },
    { name: 'Taptap Send',       ats: 'ashby',      slug: 'taptapsend' },
    { name: 'LemFi',             ats: 'ashby',      slug: 'lemfi' },
    { name: 'Optasia',           ats: 'workable',   slug: 'optasia' },
    { name: 'Kuda',              ats: 'workable',   slug: 'kuda' },
    { name: 'Helium Health',     ats: 'workable',   slug: 'helium-health' },
    { name: 'Gozem',             ats: 'breezy',     slug: 'gozem' },
    { name: 'Djamo',             ats: 'breezy',     slug: 'djamo' },
    { name: 'Takealot',          ats: 'greenhouse', slug: 'takealotcom' },
    { name: 'Ozow',              ats: 'greenhouse', slug: 'ozow' },
    { name: 'Luno',              ats: 'greenhouse', slug: 'luno' },
    { name: 'Entersekt',         ats: 'greenhouse', slug: 'entersekt' },
    { name: 'Mukuru',            ats: 'breezy',     slug: 'mukuru' },
    { name: 'Lula',              ats: 'breezy',     slug: 'lulalend' },
    { name: 'valU',              ats: 'smartrecruiters', slug: 'ValU1' },
    { name: 'Thndr',             ats: 'ashby',      slug: 'thndr' },
    { name: 'Notion',            ats: 'ashby',      slug: 'notion' },
    { name: 'OUTsurance',        ats: 'smartrecruiters', slug: 'OUTsurance' },
    // WordPress careers pages: posts in a named category, read through the site's
    // own public REST API. `site` is the host, `cat` the category id
    // (find it at /wp-json/wp/v2/categories?search=careers).
    { name: 'ACRE Africa',       ats: 'wordpress',  site: 'acreafrica.com', cat: 17 },
    // Big employers' enterprise systems. These answer a server but not a browser
    // (no CORS), so only the GitHub Actions build reads them (server: true);
    // the page's live fallback skips them.
    // Workday: `host` is <tenant>.wdN.myworkdayjobs.com, `site` the careers site in its URL.
    { name: 'Absa',              ats: 'workday',    host: 'absa.wd3.myworkdayjobs.com', site: 'ABSAcareersite', server: true },
    { name: 'Old Mutual',        ats: 'workday',    host: 'oldmutual.wd3.myworkdayjobs.com', site: 'Old_Mutual_Careers', server: true },
    { name: 'FirstRand / FNB',   ats: 'workday',    host: 'firstrand.wd3.myworkdayjobs.com', site: 'FRB', server: true },
    // Oracle Recruiting Cloud: `host` and `site` from .../hcmUI/CandidateExperience/en/sites/<site>/jobs
    { name: 'Safaricom',         ats: 'oracle',     host: 'egjd.fa.us6.oraclecloud.com', site: 'CX', server: true },
    { name: 'KCB Group',         ats: 'oracle',     host: 'eoin.fa.em3.oraclecloud.com', site: 'CX_3001', server: true },
    { name: 'Ecobank',           ats: 'oracle',     host: 'fa-emqf-saasfaprod1.fa.ocs.oraclecloud.com', site: 'CX_1004', server: true },
    // BambooHR: <slug>.bamboohr.com/careers
    { name: 'Pula',              ats: 'bamboohr',   slug: 'pula', server: true },
    { name: 'Peach Payments',    ats: 'bamboohr',   slug: 'peachpayments', server: true },
    { name: 'Aerobotics',        ats: 'bamboohr',   slug: 'aerobotics', server: true },
    // SAP SuccessFactors career sites that publish a job feed at /sitemap.xml
    { name: 'Nedbank',           ats: 'successfactors', host: 'jobs.nedbank.co.za', server: true },
    // ...and ones without the feed, read from their search results page (mode: 'search')
    { name: 'Capitec',           ats: 'successfactors', host: 'careers.capitecbank.co.za', mode: 'search', server: true },
    { name: 'Discovery',         ats: 'successfactors', host: 'careers.discovery.co.za', mode: 'search', server: true },
    // Taleo: `section` from .../careersection/<section>/jobsearch.ftl; `portal` is the
    // number in that page's source. `dates` says what the third column holds.
    { name: 'Equity Bank',       ats: 'taleo', host: 'equitybank.taleo.net', section: 'ext_new', portal: '12300100254', dates: 'closing', server: true },
    { name: 'Britam',            ats: 'taleo', host: 'britam.taleo.net', section: 'ke', portal: '101430233', dates: 'posted', server: true },
    // Zoho Recruit: the roles are a JSON list in the careers page itself
    { name: 'GTCO',              ats: 'zoho', host: 'gtcoplc.zohorecruit.com', page: 'Careers', server: true },
    // Adrenalin (myadrenalin.com) candidate microsite. `company` and `ou` are the
    // encoded ids its own page sends (seen in the browser's network panel).
    // Employers' own careers web pages, read from their HTML (ats: 'html') or from
    // the RSS feed WordPress publishes for them (ats: 'rss'). These break when a
    // site is redesigned: the employer then shows nothing until the pattern here
    // is updated (the build log lists it under "no tech roles today (or no answer)").
    //   url    the page that lists the openings
    //   link   pattern for the href of each opening's own link
    //   side   where its details sit relative to that link: 'before' (default) or 'after'
    //   title  pattern whose first group is the title, searched on that side;
    //          without one, the link's own text (unless it is "Read more" and the like)
    //   place  pattern for the location (else `location`, else Kenya)
    //   strip  pattern removed from titles; mdy: dates written month/day/year
    { name: 'Co-operative Bank', ats: 'html', url: 'https://www.co-opbank.co.ke/career_tax/co-op-bank/',
      link: '/careers/co-op-bank/[^/"]+/?$', title: 'text-2xl[^>]*>\\s*([^<]+)<', server: true },
    { name: 'Family Bank',       ats: 'html', url: 'https://familybank.co.ke/?page_id=2696',
      link: '/wp-content/uploads/[^"]*/JA-[^/"]+\\.pdf$', server: true },
    { name: 'Jubilee Insurance', ats: 'html', url: 'https://jubileeinsurance.com/ke/career-opportunities/',
      link: '/ke/career/[^/"]+/?$', title: '<h2[^>]*>([\\s\\S]*?)</h2>', server: true },
    { name: 'ICEA LION',         ats: 'html', url: 'https://icealion.co.ke/open-roles',
      link: 'open-role-description\\?jobId=\\d+', title: '<h6[^>]*>([\\s\\S]*?)</h6>', place: 'class="[^"]*country"[^>]*>([^<]+)<', server: true },
    { name: 'Madison Group',     ats: 'html', url: 'https://www.madison.co.ke/careers/',
      link: '/careers/[^/"]+/?$', title: 'careers-position[^>]*>([\\s\\S]*?)</h6>', place: 'Location:\\s*</span>\\s*<span[^>]*>([^<]+)<', server: true },
    { name: 'ZEP-RE',            ats: 'html', url: 'https://zep-re.com/about-us/careers-at-zep-re/',
      link: '/job/[^/"]+/?$', location: 'Nairobi, Kenya', server: true },
    { name: 'NCBA',              ats: 'html', url: 'https://ncbagroup.com/careers/join-our-team/', side: 'after',
      link: '/blog/job/[^/"]+/?$', title: '<h3[^>]*>([\\s\\S]*?)</h3>',
      place: '>\\s*(Kenya|Uganda|Rwanda|Tanzania)\\s*<', server: true },
    { name: 'Capital Markets Authority', ats: 'html', url: 'https://hrmis.cma.or.ke/Jobpostings/', mdy: true, all: true,
      link: '/Jobpostings/DetailsJobPosting/\\d+', title: '<tr[^>]*>\\s*<td[^>]*>([\\s\\S]*?)</td>',
      closes: '(\\d{1,2}/\\d{1,2}/\\d{4})', server: true },
    { name: 'Zetech University', ats: 'html', url: 'https://careers.zetech.ac.ke/index.php?mod=vacancies', side: 'after',
      link: 'mod=vacancies&(amp;)?do=details&(amp;)?vacid=', strip: '\\s*\\[\\s*Ref\\b[^\\]]*\\]\\s*$', server: true },
    { name: 'CIC Insurance Group', ats: 'rss', url: 'https://careers.cicinsurancegroup.com/?feed=job_feed', server: true },
    { name: 'Craft Silicon',     ats: 'rss', url: 'https://www.craftsilicon.com/careers/feed/', maxAge: 75, server: true },
    { name: "Africa's Talking",  ats: 'bamboohr', slug: 'africastalking', server: true },
    // Government internship schemes. Every advert counts (all: true), not only tech
    // titles: they are internships open to graduates of any field, ICT included.
    { name: 'Public Service Commission', ats: 'psc', host: 'pscims.publicservice.go.ke', all: true, server: true },
    { name: 'Presidential Digital Talent Programme', ats: 'digitalent', host: 'recruitment.digitalent.go.ke', all: true, server: true },
    { name: 'I&M Bank',          ats: 'adrenalin', host: 'imbank.myadrenalin.com', company: 'BQ6DBcTkVmYb2zG8XExn7A==', ou: 'vrr0nzxsgCyo6GkEF0XU1g==', server: true }
  ];
  var IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
  var PER_COMPANY = 25;          // one big global board must not swamp the page

  function fromGreenhouse(d, co) {
    return (d && d.jobs || []).map(function (j) {
      return {
        id: 'gh-' + co.slug + '-' + j.id,
        title: clean(j.title),
        company: co.name,
        logo: '',
        location: clean(j.location && j.location.name) || 'Not stated',
        types: [], cats: [catFromTitle(clean(j.title))], level: '', excerpt: clean(j.content, 190),
        body: IN_BROWSER ? '' : (j.content || ''),    // full text for the role pages, built on the runner only
        url: safeUrl(j.absolute_url),
        date: j.updated_at || j.first_published || '',
        source: co.name
      };
    });
  }
  // Lever sends the intro, then named lists (responsibilities, requirements), then a closing note.
  function leverBody(j) {
    return [j.description || ''].concat((j.lists || []).map(function (l) {
      return '<h3>' + (l.text || '') + '</h3><ul>' + (l.content || '') + '</ul>';
    })).concat([j.additional || '']).join('');
  }
  function fromLever(arr, co) {
    return (Array.isArray(arr) ? arr : []).map(function (j) {
      var c = j.categories || {};
      return {
        id: 'lv-' + co.slug + '-' + j.id,
        title: clean(j.text),
        company: co.name,
        logo: '',
        location: placeLabel(c.location, c.allLocations) || 'Not stated',
        where: [c.location].concat(c.allLocations || []).join('; '),
        types: c.commitment ? [clean(c.commitment)] : [],
        cats: [catFromTitle(clean(j.text))], level: '',
        excerpt: clean(j.descriptionPlain, 190),
        body: IN_BROWSER ? '' : leverBody(j),
        url: safeUrl(j.hostedUrl),
        date: j.createdAt ? new Date(j.createdAt).toISOString() : '',
        source: co.name
      };
    });
  }
  function fromAshby(d, co) {
    return (d && d.jobs || []).map(function (j) {
      return {
        id: 'ab-' + co.slug + '-' + (j.id || j.title),
        title: clean(j.title),
        company: co.name,
        logo: '',
        location: placeLabel(j.location, (j.secondaryLocations || []).map(function (x) { return x.location; })) +
                  (j.isRemote && !/remote/i.test(j.location || '') ? ' (remote)' : '') || 'Not stated',
        // not "Remote" itself: remote-from-North-America is not remote-from-Nairobi
        where: [j.location].concat((j.secondaryLocations || []).map(function (x) { return x.location; })).join('; '),
        types: j.employmentType ? [clean(j.employmentType)] : [],
        cats: [catFromTitle(clean(j.title))], level: '',
        excerpt: clean(j.descriptionPlain, 190),
        body: IN_BROWSER ? '' : (j.descriptionHtml || ''),
        url: safeUrl(j.jobUrl || j.applyUrl),
        date: j.publishedAt || j.updatedAt || '',
        source: co.name
      };
    });
  }
  function fromPinpoint(d, co) {
    return (d && d.data || []).map(function (j) {
      var loc = j.location || {};
      return {
        id: 'pp-' + co.slug + '-' + j.id,
        title: clean(j.title),
        company: co.name,
        logo: '',
        location: clean(loc.name || loc.city) || 'Not stated',
        types: j.employment_type_text ? [clean(j.employment_type_text)] : [],
        cats: [catFromTitle(clean(j.title))],
        level: '',
        excerpt: clean(String(j.description || '').replace(/<[^>]*>/g, ' '), 190),
        body: IN_BROWSER ? '' : String(j.description || ''),
        url: safeUrl(j.url),
        date: '',                       // Pinpoint's feed carries no posted date
        source: co.name
      };
    });
  }
  function fromSmartRecruiters(d, co) {
    return (d && d.content || []).map(function (j) {
      var loc = j.location || {};
      var place = clean(loc.fullLocation || [loc.city, loc.country].filter(Boolean).join(', ')).replace(/(,\s*)+,/g, ',');
      if (loc.remote) place = place ? 'Remote, ' + place : 'Remote';
      var slug = (j.company && j.company.identifier) || co.slug;
      return {
        id: 'sr-' + co.slug + '-' + j.id,
        title: clean(j.name),
        company: co.name,
        logo: '',
        location: place || 'Not stated',
        types: j.typeOfEmployment && j.typeOfEmployment.label ? [clean(j.typeOfEmployment.label)] : [],
        cats: [catFromTitle(clean(j.name))], level: '',
        excerpt: '',
        // the list has no text; build_jobs_board.js fetches this one posting for the role page
        detail: IN_BROWSER ? '' : 'https://api.smartrecruiters.com/v1/companies/' + encodeURIComponent(slug) + '/postings/' + encodeURIComponent(j.id),
        url: safeUrl('https://jobs.smartrecruiters.com/' + encodeURIComponent(slug) + '/' + encodeURIComponent(j.id)),
        date: j.releasedDate || '',
        source: co.name
      };
    });
  }
  function fromWorkable(d, co) {
    return (d && d.jobs || []).map(function (j) {
      var place = [j.city, j.country].filter(Boolean).join(', ');
      if (j.telecommuting) place = place ? 'Remote, ' + place : 'Remote';
      return {
        id: 'wk-' + co.slug + '-' + (j.shortcode || j.title),
        title: clean(j.title),
        company: co.name,
        logo: '',
        location: clean(place) || 'Not stated',
        types: j.employment_type ? [clean(j.employment_type)] : [],
        cats: [catFromTitle(clean(j.title))], level: '',
        excerpt: '',
        detail: IN_BROWSER || !j.shortcode ? '' : 'https://apply.workable.com/api/v2/accounts/' + encodeURIComponent(co.slug) + '/jobs/' + encodeURIComponent(j.shortcode),
        url: safeUrl(j.url || j.shortlink),
        date: j.published_on || j.created_at || '',
        source: co.name
      };
    });
  }
  function fromBreezy(arr, co) {
    return (Array.isArray(arr) ? arr : []).map(function (j) {
      var loc = j.location || {};
      var place = [loc.city, loc.country && loc.country.name].filter(Boolean).join(', ') || loc.name || '';
      if (loc.is_remote) place = place ? 'Remote, ' + place : 'Remote';
      return {
        id: 'bz-' + co.slug + '-' + (j.id || j.name),
        title: clean(j.name),
        company: co.name,
        logo: '',
        location: clean(place) || 'Not stated',
        types: j.type && j.type.name ? [clean(j.type.name)] : [],
        cats: [catFromTitle(clean(j.name))], level: '',
        excerpt: '',
        url: safeUrl(j.url),
        date: j.published_date || '',
        source: co.name
      };
    });
  }
  // WordPress posts never expire the way an ATS requisition does, so anything
  // older than MAX_POST_AGE days is treated as a closed role and dropped.
  var MAX_POST_AGE = 120;
  function fromWordPress(arr, co) {
    var cutoff = Date.now() - MAX_POST_AGE * 864e5;
    return (Array.isArray(arr) ? arr : []).filter(function (p) {
      var t = Date.parse(p.modified || p.date);
      return !isNaN(t) && t >= cutoff;
    }).map(function (p) {
      var title = clean(String((p.title && p.title.rendered) || '').replace(/&amp;/g, '&'));
      return {
        id: 'wp-' + co.slug + '-' + p.id,
        title: title,
        company: co.name,
        logo: '',
        location: co.location || 'Kenya',
        types: [],
        cats: [catFromTitle(title)],
        level: '',
        excerpt: clean(String((p.excerpt && p.excerpt.rendered) || '').replace(/<[^>]*>/g, ' '), 190),
        url: safeUrl(p.link),
        date: p.date || '',
        source: co.name
      };
    });
  }
  // Workday: the list gives title and path; the role's own page gives the country,
  // the posting date and a description, so those are read for tech roles only.
  var WD_PAGES = 30;           // 20 roles a page; Old Mutual alone lists 500+
  function loadWorkday(co) {
    var base = 'https://' + co.host + '/wday/cxs/' + co.host.split('.')[0] + '/' + co.site;
    var rows = [];
    function page(n) {
      return getJSON(base + '/jobs', { method: 'POST', body: JSON.stringify({ limit: 20, offset: n * 20, searchText: '', appliedFacets: {} }) })
        .then(function (d) {
          var got = (d && d.jobPostings) || [];
          rows = rows.concat(got);
          if (got.length === 20 && n + 1 < WD_PAGES && rows.length < (d.total || 0)) return page(n + 1);
        });
    }
    return page(0).then(function () {
      var keep = rows.filter(function (j) {
        var t = clean(j.title); return j.externalPath && (isTechRole(t) || PROGRAMME.test(t));
      }).slice(0, PER_COMPANY * 2);
      return Promise.all(keep.map(function (j) {
        return getJSON(base + j.externalPath).then(function (d) { return fromWorkday(j, d && d.jobPostingInfo, co); });
      }));
    });
  }
  function fromWorkday(j, info, co) {
    info = info || {};
    var title = clean(info.title || j.title);
    var country = info.country && info.country.descriptor;
    var place = clean(info.location || j.locationsText);
    if (country && place.indexOf(country) === -1) place = place ? place + ', ' + country : country;
    if (/remote/i.test(info.remoteType || '')) place = 'Remote, ' + place;
    return {
      id: 'wd-' + co.host.split('.')[0] + '-' + (info.jobReqId || (j.bulletFields || [])[0] || j.externalPath),
      title: title, company: co.name, logo: '',
      location: place || 'Not stated',
      types: info.timeType ? [clean(info.timeType)] : [],
      cats: [catFromTitle(title)], level: '',
      excerpt: clean(String(info.jobDescription || '').replace(/<[^>]*>/g, ' '), 190),
      body: IN_BROWSER ? '' : String(info.jobDescription || ''),
      url: safeUrl(info.externalUrl || ('https://' + co.host + '/' + co.site + j.externalPath)),
      date: info.startDate || '',
      source: co.name
    };
  }
  function fromOracle(d, co) {
    var list = (d && d.items && d.items[0] && d.items[0].requisitionList) || [];
    return list.map(function (j) {
      var title = clean(j.Title);
      var others = (j.secondaryLocations || []).map(function (x) { return x.Name || x.LocationName || ''; });
      var place = placeLabel(j.PrimaryLocation, others);
      if (/remote/i.test(j.WorkplaceType || '')) place = 'Remote, ' + place;
      return {
        id: 'or-' + co.host.split('.')[0] + '-' + j.Id,
        title: title, company: co.name, logo: '',
        location: place || 'Not stated',
        where: [j.PrimaryLocation].concat(others).join('; '),
        types: j.JobSchedule ? [clean(j.JobSchedule)] : [],
        cats: [catFromTitle(title)], level: '',
        excerpt: clean(j.ShortDescriptionStr, 190),
        url: safeUrl('https://' + co.host + '/hcmUI/CandidateExperience/en/sites/' + co.site + '/job/' + j.Id),
        date: j.PostedDate || '',
        source: co.name
      };
    });
  }
  function fromBamboo(d, co) {
    return (d && d.result || []).map(function (j) {
      var title = clean(j.jobOpeningName);
      var loc = j.location || {}, ats = j.atsLocation || {};
      var place = [loc.city, loc.state || ats.province || ats.state, ats.country]
        .filter(function (x) { return x && x !== 'NA'; }).join(', ');
      if (j.isRemote || String(j.locationType) === '1') place = place ? 'Remote, ' + place : 'Remote';
      return {
        id: 'bh-' + co.slug + '-' + j.id,
        title: title, company: co.name, logo: '',
        location: clean(place) || 'Not stated',
        types: j.employmentStatusLabel ? [clean(j.employmentStatusLabel)] : [],
        cats: [catFromTitle(title)], level: '',
        excerpt: '',
        url: safeUrl('https://' + co.slug + '.bamboohr.com/careers/' + j.id),
        date: '',                       // the list carries no posted date
        source: co.name
      };
    });
  }
  // SuccessFactors' Google-jobs feed is RSS; read with plain patterns, since the
  // build has no XML parser. Titles end "(City, CC)", which is dropped.
  var CC = { ZA: 'South Africa', NA: 'Namibia', BW: 'Botswana', LS: 'Lesotho', SZ: 'Eswatini', KE: 'Kenya',
             ZW: 'Zimbabwe', MZ: 'Mozambique', ZM: 'Zambia', MW: 'Malawi', UG: 'Uganda', TZ: 'Tanzania', GB: 'United Kingdom' };
  function fromSuccessFactors(xml, co) {
    var items = String(xml || '').split('<item>').slice(1);
    function tag(it, t) {
      var m = new RegExp('<' + t + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + t + '>').exec(it);
      return m ? decode(m[1]).trim() : '';
    }
    return items.map(function (it) {
      var title = clean(tag(it, 'title').replace(/\s*\([^()]*,\s*[A-Z]{2}\)\s*$/, ''));
      var place = tag(it, 'g:location').replace(/,\s*([A-Z]{2})$/, function (m, c) { return ', ' + (CC[c] || c); });
      return {
        id: 'sf-' + co.host.split('.')[1] + '-' + (tag(it, 'g:id') || title),
        title: title, company: co.name, logo: '',
        location: clean(place) || 'Not stated',
        types: [], cats: [catFromTitle(title)], level: '',
        excerpt: '',
        url: safeUrl(tag(it, 'link')),
        date: '',
        source: co.name
      };
    });
  }

  // --- the "more work" systems ---------------------------------------------
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // "Nov 9, 2026", "9 Nov 2026", "03-Nov-2026" or "27-10-2026" -> "2026-11-09" ('' if unreadable)
  function dayOf(t, mdy) {
    t = String(t || '').trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1'); var m, y, mo, d;
    if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(t))) { mo = MON[m[1].toLowerCase()]; d = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})/.exec(t))) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; }
    else if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(t))) { d = +m[mdy ? 2 : 1]; mo = +m[mdy ? 1 : 2] - 1; y = +m[3]; }
    if (mo === undefined || !y) return '';
    return y + '-' + ('0' + (mo + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function capsTitle(t) {           // "ASSISTANT MANAGER, DATA SCIENTIST" -> "Assistant Manager, Data Scientist"
    t = clean(t);
    if (t !== t.toUpperCase()) return t;
    return t.toLowerCase().replace(/(^|[\s,(\/-])([a-z])/g, function (m, a, c) { return a + c.toUpperCase(); })
      .replace(/\b(Ict|It|Hr|Ai|Ui|Ux|Qa|Erp|Crm|Sme|Ceo|Cto|Cfo)\b/g, function (w) { return w.toUpperCase(); });
  }
  function job(prefix, co, id, title, place, date, url, extra) {
    var j = { id: prefix + '-' + co.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + id, title: title, company: co.name, logo: '',
      location: clean(place) || 'Not stated', types: [], cats: [catFromTitle(title)], level: '', excerpt: '',
      url: safeUrl(url), date: date || '', source: co.name };
    if (extra) Object.keys(extra).forEach(function (k) { j[k] = extra[k]; });
    return j;
  }
  // Taleo's own search screen calls this; 25 a page.
  function loadTaleo(co) {
    var base = 'https://' + co.host + '/careersection/';
    var today = new Date().toISOString().slice(0, 10), rows = [];
    function page(n) {
      return getJSON(base + 'rest/jobboard/searchjobs?lang=en&portal=' + co.portal, { method: 'POST', body: JSON.stringify({
        multilineEnabled: false, sortingSelection: { sortBySelectionParam: '3', ascendingSortingOrder: 'false' },
        fieldData: { fields: { KEYWORD: '', LOCATION: '' }, valid: true },
        filterSelectionParam: { searchFilterSelections: [] }, advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
        pageNo: n }) }).then(function (d) {
          var got = (d && d.requisitionList) || [];
          rows = rows.concat(got);
          var total = (d && d.pagingData && d.pagingData.totalCount) || 0;
          if (got.length && rows.length < total && n < 6) return page(n + 1);
        });
    }
    return page(1).then(function () {
      return rows.map(function (r) {
        var c = r.column || [], places = [];
        try { places = JSON.parse(c[1] || '[]'); } catch (e) { places = [c[1]]; }
        places = places.map(function (p) { return String(p || '').replace(/, United Republic of/, '').replace(/-/g, ', '); });
        var when = dayOf(c[2]);
        if (co.dates === 'closing' && when && when < today) return null;          // closed
        return job('tl', co, r.jobId || r.contestNo, clean(c[0]), placeLabel(places[0], places.slice(1)),
          co.dates === 'posted' ? when : '',
          base + co.section + '/jobdetail.ftl?job=' + encodeURIComponent(r.contestNo || r.jobId) + '&lang=en',
          { where: places.join('; ') });
      }).filter(Boolean);
    });
  }
  function fromZoho(html, co) {
    var m = /<input[^>]*value="([^"]*)"[^>]*id="jobs"/.exec(String(html || '')) ||
            /<input[^>]*id="jobs"[^>]*value="([^"]*)"/.exec(String(html || ''));
    var list = [];
    try { list = JSON.parse(decode(m ? m[1] : '[]')); } catch (e) { list = []; }
    return list.filter(function (j) { return j && j.Posting_Title && j.Publish !== false; }).map(function (j) {
      var title = clean(j.Posting_Title);
      var place = [j.City, j.State, j.Country].filter(function (x) { return x && x !== 'null'; }).join(', ');
      if (j.Remote_Job) place = place ? 'Remote, ' + place : 'Remote';
      var o = job('zr', co, j.id, title, place, j.Date_Opened,
        'https://' + co.host + '/jobs/' + co.page + '/' + j.id + '/' + title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '?source=CareerSite');
      if (j.Job_Type) o.types = [clean(j.Job_Type)];
      return o;
    });
  }
  function loadAdrenalin(co) {
    return getJSON('https://' + co.host + '/CANDMICROSITE/CPVacancyDetails/GetVacancyInformationWithoutToken',
      { method: 'POST', body: JSON.stringify({ CompanyID: co.company, Flag: 'OP', OU_ID: co.ou, JOBID: '' }) })
      .then(function (d) {
        var list = (d && d.Data && d.Data[0] && d.Data[0].VacancyInformation) || [];
        return list.map(function (v) {
          var o = job('ad', co, v.FUNCTION_ID, capsTitle(String(v.FUNCTION_NAME || '').replace(/_\d+\s*$/, '')),
            [v.CITY, 'Kenya'].filter(Boolean).join(', '), String(v.POSTED_ON || '').slice(0, 10),
            'https://' + co.host + '/CANDMICROSITE/#/search-results');
          o.excerpt = clean(v.FUNCTION_DESC, 190);
          return o;
        });
      });
  }
  // Public Service Commission internship adverts: one ASP.NET table. Its links are
  // postbacks, so every advert points at the table, where Apply sits beside it.
  function loadPSC(co) {
    var url = 'https://' + co.host + '/jobs/ActiveAdvertsInternsInternshipExt.aspx';
    var today = new Date().toISOString().slice(0, 10);
    return getJSON(url, null, true).then(function (html) {
      return String(html || '').split(/<tr[\s>]/i).slice(1).map(function (r) {
        var td = r.split(/<td[^>]*>/i).slice(1).map(function (c) { return clean(c.split(/<\/td>/i)[0]); });
        // # | advert no. | position | ministry | vacancies | advert date | close date | action
        if (td.length < 7 || !/^\d+\/\d{4}$/.test(td[1])) return null;
        var closes = dayOf(td[6]);
        if (closes && closes < today) return null;
        var o = job('psc', co, td[1].replace('/', '-'), td[2], 'Kenya', dayOf(td[5]), url);
        o.excerpt = (+td[4] ? Number(td[4]).toLocaleString('en-KE') + ' places' : 'Places') + ' in the ' + td[3] +
          '. Advert ' + td[1] + (closes ? ', closes ' + td[6] : '') + '. Apply on the Public Service Commission site.';
        o.types = ['Internship'];
        return o;
      }).filter(Boolean);
    });
  }
  // The Digital Talent Programme recruits one cohort at a time. List it only
  // while its page shows an open deadline.
  function loadDigitalent(co) {
    var url = 'https://' + co.host + '/';
    return getJSON(url, null, true).then(function (html) {
      html = String(html || '');
      var dl = clean((/class="dl-date"[^>]*>([\s\S]*?)<\/div>/.exec(html) || [])[1]);
      var cohort = clean((/Call for Applications\s+(COHORT\s+[A-Z0-9]+)\s+is Open/i.exec(html) || [])[1]);
      if (!cohort || !dl || /closed/i.test(dl) || /Applications Closed/i.test(html)) return [];
      var o = job('pdtp', co, cohort.replace(/\s+/g, '-'), 'Presidential Digital Talent Programme: ' +
        'Cohort ' + cohort.split(/\s+/)[1] + ' (ICT internship)', 'Kenya', '', url);
      o.excerpt = 'Paid 12-month ICT internship in government for recent graduates. Applications close ' + dl + '.';
      o.types = ['Internship'];
      return [o];
    });
  }
  // A careers web page: every link matching co.link is one opening; its title, place
  // and dates come from the markup beside it (see the notes at COMPANIES).
  var CTA = /^(read more|learn more|tell me more|more details?|apply|view|details|explore|see more|click here|find out more)\b/i;
  var CLOSES = '(?:closing date|date closing|application deadline|deadline|closes|close date|apply by)\\s*:?\\s*(?:<[^>]*>\\s*)*([A-Za-z0-9 ,/.-]{5,24}?\\d{4})';
  var POSTED = '(?:date posted|posted on|posted)\\s*:?\\s*(?:<[^>]*>\\s*)*([A-Za-z0-9 ,/.-]{5,24}?\\d{4})';
  function loadHTML(co) {
    var today = new Date().toISOString().slice(0, 10);
    return getJSON(co.url, null, true).then(function (html) {
      html = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
      var re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/gi, m, groups = [], by = {}, occ = [];
      var link = new RegExp(co.link, 'i');
      while ((m = re.exec(html))) {
        var href = decode(m[1]);
        if (!link.test(href)) continue;
        var close = html.indexOf('</a>', re.lastIndex);
        var text = clean(html.slice(re.lastIndex, close < 0 ? re.lastIndex : close));
        var g = by[href];
        if (!g) { g = by[href] = { href: href, at: occ.length, texts: [] }; groups.push(g); }
        g.texts.push(text);
        occ.push({ start: m.index, end: re.lastIndex });
      }
      function find(src, pat, last) {
        if (!pat) return '';
        var r = new RegExp(pat, 'gi'), mm, out = '';
        while ((mm = r.exec(src))) { out = mm[1]; if (!last) break; if (!mm[0].length) r.lastIndex++; }
        return clean(out);
      }
      // A page can repeat its list (desktop and phone layouts), so the details of an
      // opening are looked for between its first link and the job links either side of it.
      return groups.slice(0, 80).map(function (g) {
        var me = occ[g.at], prev = occ[g.at - 1], next = occ[g.at + 1], after = co.side === 'after';
        var win = after ? html.slice(me.end, next ? next.start : me.end + 5000)
                        : html.slice(prev ? prev.end : Math.max(0, me.start - 5000), me.start);
        var title = find(win, co.title, !after) ||
          g.texts.filter(function (t) { return t && t.length < 260 && !CTA.test(t); })[0] || '';
        if (co.strip) title = title.replace(new RegExp(co.strip, 'i'), '');
        // \uFFFD: a dash the site saved in the wrong encoding
        title = capsTitle(title.replace(/\s*\uFFFD\s*/g, ' – ').replace(/\s+/g, ' ').trim());
        if (!title) return null;
        var closes = dayOf(find(win, co.closes || CLOSES, !after), co.mdy);
        if (closes && closes < today) return null;
        var posted = dayOf(find(win, co.posted || POSTED, !after), co.mdy);
        var url;
        try { url = new URL(g.href, co.url).href; } catch (e) { return null; }
        var qid = (/[?&](?:jobId|vacid|id)=([^&#]+)/i.exec(g.href) || [])[1];
        var o = job('pg', co, qid ? qid.slice(0, 32) : g.href.replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop().slice(-60),
          title, find(win, co.place, !after) || co.location || 'Kenya', posted && posted <= today ? posted : '', url);
        if (closes) o.excerpt = 'Applications close ' + new Date(closes + 'T12:00:00Z')
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + '.';
        return o;
      }).filter(Boolean);
    });
  }
  // A WordPress RSS feed of job posts (WP Job Manager's ?feed=job_feed, or a careers
  // post type's /feed/). Posts don't close themselves, so old ones are dropped.
  function fromRSS(xml, co) {
    var cutoff = new Date(Date.now() - (co.maxAge || 60) * 864e5).toISOString().slice(0, 10);
    var items = String(xml || '').split('<item>').slice(1);
    function tag(it, t) {
      var m = new RegExp('<' + t + '>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>\\s*)?</' + t + '>').exec(it);
      return m ? decode(m[1]).trim() : '';
    }
    return items.map(function (it) {
      var title = capsTitle(tag(it, 'title'));
      var d = new Date(tag(it, 'pubDate')), date = isNaN(d) ? '' : d.toISOString().slice(0, 10);
      if (date && date < cutoff) return null;
      var o = job('rss', co, (/[?&]p=(\d+)/.exec(tag(it, 'guid')) || /([^\/]+)\/?$/.exec(tag(it, 'link')) || ['', title])[1],
        title, tag(it, 'job_listing:location') || co.location || 'Kenya', date, tag(it, 'link'));
      var type = tag(it, 'job_listing:job_type');
      if (type) o.types = [clean(type)];
      o.excerpt = clean(tag(it, 'description'), 190);
      return o;
    }).filter(Boolean);
  }
  // SuccessFactors search results, newest first, 25 rows a page.
  function loadSFSearch(co) {
    var rows = [];
    function page(n) {
      return getJSON('https://' + co.host + '/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=' + n * 25, null, true)
        .then(function (html) {
          var got = String(html || '').split('class="data-row').slice(1);
          rows = rows.concat(got);
          if (got.length === 25 && n < 7) return page(n + 1);
        });
    }
    return page(0).then(function () {
      var seen = {};
      return rows.map(function (r) {
        var a = /<a[^>]*href="(\/job\/[^"]+)"[^>]*class="jobTitle-link"[^>]*>([^<]+)<|<a[^>]*class="jobTitle-link"[^>]*href="(\/job\/[^"]+)"[^>]*>([^<]+)</.exec(r);
        if (!a) return null;
        var href = a[1] || a[3], title = clean(a[2] || a[4]);
        var id = (/\/(\d+)\/?$/.exec(href) || [])[1] || href;
        if (seen[id]) return null; seen[id] = 1;
        var loc = (/class="jobLocation[^"]*">\s*([^<\s][^<]*)</.exec(r) || [])[1] || 'South Africa';
        loc = clean(loc).replace(/,\s*([A-Z]{2})$/, function (m, c) { return ', ' + (CC[c] || c); });
        var date = dayOf((/class="jobDate[^"]*">\s*([^<]+)</.exec(r) || [])[1]);
        return job('sf', co, id, title, loc, date, 'https://' + co.host + decode(href));
      }).filter(Boolean);
    });
  }

  function loadCompany(co) {
    if (co.server && IN_BROWSER) return Promise.resolve([]);
    var special = co.ats === 'taleo' ? loadTaleo : co.ats === 'adrenalin' ? loadAdrenalin
                : co.ats === 'psc' ? loadPSC : co.ats === 'digitalent' ? loadDigitalent
                : co.ats === 'html' ? loadHTML
                : co.ats === 'successfactors' && co.mode === 'search' ? loadSFSearch : null;
    if (special) return special(co).then(function (j) { return finish(j, co); }).catch(function () { return []; });
    if (!co.slug) co.slug = String(co.site || co.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (co.ats === 'workday') return loadWorkday(co).then(finish).catch(function () { return []; });
    var asText = co.ats === 'successfactors' || co.ats === 'zoho' || co.ats === 'rss';
    var url = co.ats === 'oracle' ? 'https://' + co.host + '/hcmRestApi/resources/latest/recruitingCEJobRequisitions' +
                                    '?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=' +
                                    co.site + ',limit=100,sortBy=POSTING_DATES_DESC'
            : co.ats === 'bamboohr'   ? 'https://' + co.slug + '.bamboohr.com/careers/list'
            : co.ats === 'successfactors' ? 'https://' + co.host + '/sitemap.xml'
            : co.ats === 'zoho'       ? 'https://' + co.host + '/jobs/' + co.page
            : co.ats === 'rss'        ? co.url
            : co.ats === 'greenhouse' ? 'https://boards-api.greenhouse.io/v1/boards/' + co.slug + '/jobs' + (IN_BROWSER ? '' : '?content=true')
            : co.ats === 'lever'      ? 'https://api.lever.co/v0/postings/' + co.slug + '?mode=json'
            : co.ats === 'pinpoint'   ? 'https://' + co.slug + '.pinpointhq.com/postings.json'
            : co.ats === 'smartrecruiters' ? 'https://api.smartrecruiters.com/v1/companies/' + co.slug + '/postings?limit=100'
            : co.ats === 'workable'   ? 'https://apply.workable.com/api/v1/widget/accounts/' + co.slug
            : co.ats === 'breezy'     ? 'https://' + co.slug + '.breezy.hr/json'
            : co.ats === 'wordpress'  ? 'https://' + co.site + '/wp-json/wp/v2/posts?categories=' + co.cat +
                                        '&per_page=20&_fields=id,date,modified,link,title,excerpt'
            :                           'https://api.ashbyhq.com/posting-api/job-board/' + co.slug;
    return getJSON(url, null, asText).then(function (d) {
      if (!d) return [];
      return co.ats === 'oracle'     ? fromOracle(d, co)
           : co.ats === 'bamboohr'   ? fromBamboo(d, co)
           : co.ats === 'successfactors' ? fromSuccessFactors(d, co)
           : co.ats === 'zoho'       ? fromZoho(d, co)
           : co.ats === 'rss'        ? fromRSS(d, co)
           : co.ats === 'greenhouse' ? fromGreenhouse(d, co)
               : co.ats === 'lever'      ? fromLever(d, co)
               : co.ats === 'pinpoint'   ? fromPinpoint(d, co)
               : co.ats === 'smartrecruiters' ? fromSmartRecruiters(d, co)
               : co.ats === 'workable'   ? fromWorkable(d, co)
               : co.ats === 'breezy'     ? fromBreezy(d, co)
               : co.ats === 'wordpress'  ? fromWordPress(d, co)
               :                           fromAshby(d, co);
    }).then(finish).catch(function () { return []; });
  }
  function finish(jobs, co) {
      var all = !!(co && co.all);
      jobs = (jobs || []).filter(function (j) { return j.title && j.url && (all || isTechRole(j.title) || PROGRAMME.test(j.title)); });
      jobs.forEach(function (j) { j.region = regionOf(j.where || j.location); });
      jobs.sort(function (a, b) { return REGION_RANK[a.region] - REGION_RANK[b.region]; });
      return jobs.slice(0, PER_COMPANY);
  }

  // One feed that hangs must not hold up the rest: each request gets TIMEOUT_MS.
  var TIMEOUT_MS = 12000, FETCH_HEADERS = null;
  // init: { method, body } for a POST (sent as JSON); asText: return the body as text.
  function getJSON(url, init, asText) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer;
    var opts = ctrl ? { signal: ctrl.signal } : {};
    var headers = {};
    if (FETCH_HEADERS) Object.keys(FETCH_HEADERS).forEach(function (k) { headers[k] = FETCH_HEADERS[k]; });
    if (init && init.body) { opts.method = init.method || 'POST'; opts.body = init.body; headers['Content-Type'] = 'application/json'; }
    if (init || asText !== undefined) headers.Accept = asText ? 'application/xml, text/xml, */*' : 'application/json';
    if (Object.keys(headers).length) opts.headers = headers;
    // Race the request against the clock rather than trusting abort alone.
    var late = new Promise(function (resolve) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve(null); }, TIMEOUT_MS);
    });
    var got = fetch(url, opts).then(function (r) { return r.ok ? (asText ? r.text() : r.json()) : null; })
      .catch(function () { return null; });
    return Promise.race([got, late]).then(function (d) { clearTimeout(timer); return d; });
  }

  function load(opts) {
    opts = opts || {};
    if (opts.timeoutMs) TIMEOUT_MS = opts.timeoutMs;
    if (opts.headers) FETCH_HEADERS = opts.headers;
    var jobicy = getJSON('https://jobicy.com/api/v2/remote-jobs?count=50&geo=anywhere')
      .then(function (d) { return d ? fromJobicy(d) : []; }).catch(function () { return []; });
    var rok = getJSON('https://remoteok.com/api')
      .then(function (a) { return Array.isArray(a) ? fromRemoteOK(a.slice(1)) : []; }).catch(function () { return []; });

    var boards = COMPANIES.map(loadCompany);
    var sources = [jobicy, rok].concat(boards);

    // Roles arrive source by source: report each batch as it lands
    // (opts.onProgress(rolesSoFar, sourcesDone, sourcesTotal)) so a page can
    // show the first roles while slower feeds are still loading.
    var parts = [], done = 0;
    if (typeof opts.onProgress === 'function') {
      sources.forEach(function (p) {
        p.then(function (rows) {
          parts.push(rows || []);
          done++;
          try { opts.onProgress(merge(parts), done, sources.length); } catch (e) {}
        });
      });
    }
    return Promise.all(sources).then(merge);
  }

  // All sources' roles as one list: dropped if broken, de-duplicated when the
  // same role is listed on two boards, newest first.
  function merge(res) {
    var merged = [].concat.apply([], res).filter(function (j) { return j && j.title && j.url; });
    merged.forEach(function (j) { if (!j.region) j.region = regionOf(j.location); });
    var seen = {};
    merged = merged.filter(function (j) {
      var k = (j.title + '|' + j.company).toLowerCase().replace(/[^a-z0-9|]/g, '');
      if (seen[k]) return false; seen[k] = 1; return true;
    });
    merged.sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
    return merged;
  }

  return {
    COMPANIES: COMPANIES, load: load, clean: clean, esc: esc, ago: ago, safeUrl: safeUrl,
    regionOf: regionOf, stageOf: stageOf, stageLabel: stageLabel, catFromTitle: catFromTitle,
    isTechRole: isTechRole,
    // for checking one employer's adapter by hand (also in a browser, on that site)
    _loadOne: function (co) { var c = {}; Object.keys(co).forEach(function (k) { c[k] = co[k]; }); c.server = false; return loadCompany(c); }
  };
});
