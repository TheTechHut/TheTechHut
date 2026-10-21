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
  var AF = /(africa|casablanca|rabat|marrakech|tunis|algiers|oran|lom[eé]|cotonou|douala|yaound|libreville|gabon|gaborone|harare|lusaka|lilongwe|bamako|ouagadougou|niamey|conakry|freetown|monrovia|banjul|giza|alexandria|kano|ibadan|port harcourt|durban|pretoria|stellenbosch|centurion|sandton|bloemfontein|ebene|port louis|angola|luanda|namibia|windhoek|mozambique|maputo|mauritius|lesotho|eswatini|madagascar|south sudan|somalia|burundi|congo|kinshasa|cameroon|tunisia|algeria|nigeria|lagos|abuja|oyo|ilorin|ghana|accra|uganda|kampala|tanzania|dar es|rwanda|kigali|ethiopia|addis|egypt|cairo|johannesburg|cape town|senegal|dakar|ivory coast|abidjan|zambia|malawi|morocco|benin|togo|zimbabwe|botswana)/i;
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
    { name: 'OUTsurance',        ats: 'smartrecruiters', slug: 'OUTsurance' },
    // WordPress careers pages: posts in a named category, read through the site's
    // own public REST API. `site` is the host, `cat` the category id
    // (find it at /wp-json/wp/v2/categories?search=careers).
    { name: 'ACRE Africa',       ats: 'wordpress',  site: 'acreafrica.com', cat: 17 }
  ];
  var PER_COMPANY = 25;          // one big global board must not swamp the page

  function fromGreenhouse(d, co) {
    return (d && d.jobs || []).map(function (j) {
      return {
        id: 'gh-' + co.slug + '-' + j.id,
        title: clean(j.title),
        company: co.name,
        logo: '',
        location: clean(j.location && j.location.name) || 'Not stated',
        types: [], cats: [catFromTitle(clean(j.title))], level: '', excerpt: '',
        url: safeUrl(j.absolute_url),
        date: j.updated_at || j.first_published || '',
        source: co.name
      };
    });
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
        excerpt: '',
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
  function loadCompany(co) {
    if (!co.slug) co.slug = String(co.site || co.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    var url = co.ats === 'greenhouse' ? 'https://boards-api.greenhouse.io/v1/boards/' + co.slug + '/jobs'
            : co.ats === 'lever'      ? 'https://api.lever.co/v0/postings/' + co.slug + '?mode=json'
            : co.ats === 'pinpoint'   ? 'https://' + co.slug + '.pinpointhq.com/postings.json'
            : co.ats === 'smartrecruiters' ? 'https://api.smartrecruiters.com/v1/companies/' + co.slug + '/postings?limit=100'
            : co.ats === 'workable'   ? 'https://apply.workable.com/api/v1/widget/accounts/' + co.slug
            : co.ats === 'breezy'     ? 'https://' + co.slug + '.breezy.hr/json'
            : co.ats === 'wordpress'  ? 'https://' + co.site + '/wp-json/wp/v2/posts?categories=' + co.cat +
                                        '&per_page=20&_fields=id,date,modified,link,title,excerpt'
            :                           'https://api.ashbyhq.com/posting-api/job-board/' + co.slug;
    return getJSON(url).then(function (d) {
      if (!d) return [];
      var jobs = co.ats === 'greenhouse' ? fromGreenhouse(d, co)
               : co.ats === 'lever'      ? fromLever(d, co)
               : co.ats === 'pinpoint'   ? fromPinpoint(d, co)
               : co.ats === 'smartrecruiters' ? fromSmartRecruiters(d, co)
               : co.ats === 'workable'   ? fromWorkable(d, co)
               : co.ats === 'breezy'     ? fromBreezy(d, co)
               : co.ats === 'wordpress'  ? fromWordPress(d, co)
               :                           fromAshby(d, co);
      jobs = jobs.filter(function (j) { return j.title && j.url && (isTechRole(j.title) || PROGRAMME.test(j.title)); });
      jobs.forEach(function (j) { j.region = regionOf(j.where || j.location); });
      jobs.sort(function (a, b) { return REGION_RANK[a.region] - REGION_RANK[b.region]; });
      return jobs.slice(0, PER_COMPANY);
    }).catch(function () { return []; });
  }

  // One feed that hangs must not hold up the rest: each request gets TIMEOUT_MS.
  var TIMEOUT_MS = 12000, FETCH_HEADERS = null;
  function getJSON(url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer;
    var opts = ctrl ? { signal: ctrl.signal } : {};
    if (FETCH_HEADERS) opts.headers = FETCH_HEADERS;
    // Race the request against the clock rather than trusting abort alone.
    var late = new Promise(function (resolve) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve(null); }, TIMEOUT_MS);
    });
    var got = fetch(url, opts).then(function (r) { return r.ok ? r.json() : null; })
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

    return Promise.all([jobicy, rok].concat(boards)).then(function (res) {
      var merged = [].concat.apply([], res).filter(function (j) { return j.title && j.url; });
      merged.forEach(function (j) { if (!j.region) j.region = regionOf(j.location); });
      var seen = {};
      merged = merged.filter(function (j) {                 // same role listed on both boards
        var k = (j.title + '|' + j.company).toLowerCase().replace(/[^a-z0-9|]/g, '');
        if (seen[k]) return false; seen[k] = 1; return true;
      });
      merged.sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
      return merged;
    });
  }


  return {
    COMPANIES: COMPANIES, load: load, clean: clean, esc: esc, ago: ago, safeUrl: safeUrl,
    regionOf: regionOf, stageOf: stageOf, stageLabel: stageLabel, catFromTitle: catFromTitle,
    isTechRole: isTechRole
  };
});
