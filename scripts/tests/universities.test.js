#!/usr/bin/env node
/*
 * Checks the university employers in assets/js/jobs-feeds.js against saved
 * copies of their pages' markup (no network): the right roles are kept (tech,
 * plus teaching and research posts in tech subjects), titles, closing dates,
 * places and ids come out right, and closed adverts are dropped.
 *
 *   node scripts/tests/universities.test.js
 */
'use strict';
var assert = require('assert');
var F = require('../../assets/js/jobs-feeds.js');

var PAGES = {
  'https://uct.ac.za/staff/general-vacancies':
    '<tr><td><div class="vacancies--vacancy--title">Lecturer: French Language</div><a href="/sites/default/files/2026-11/hum-id1467-lec-sll.pdf">View advert</a> | <a href="/sites/default/files/2026-11/hum-id1467-lec-sll-jd.pdf">View description</a></td><td><time datetime="2099-11-28T23:45:00+02:00" class="datetime">28 Nov 2099</time></td></tr>' +
    '<tr><td><div class="vacancies--vacancy--title">Visualisation Software Developer: IDIA </div><a href="/sites/default/files/2026-11/sci-id1501-visdev-idia.pdf">View advert</a> | <a href="/sites/default/files/2026-11/sci-id1501-visdev-idia-jd.pdf">View description</a></td><td><time class="datetime">03 Dec 2099</time></td></tr>' +
    '<tr><td><div class="vacancies--vacancy--title">Lecturer: Computer Science</div><a href="/sites/default/files/2026-11/sci-id1700-lec-cs.pdf">View advert</a></td><td><time class="datetime">10 Jan 2100</time></td></tr>' +
    '<tr><td><div class="vacancies--vacancy--title">Senior Lecturer: Data Science</div><a href="/sites/default/files/2026-11/sci-id1701-sl-ds.pdf">View advert</a></td><td><time class="datetime">01 Jan 2001</time></td></tr>',
  'https://www.wits.ac.za/vacancies/':
    '<tr><td><a href="https://irec.wits.ac.za/OA_HTML/OA.jsp?page=/oracle/apps/irc/candidateSelfService/webui/VisVacDispPG&amp;IRC_EXT_SITE_VISITOR_APP=IRC_VIS_VAC_DISPLAY&amp;p_svid=108297&amp;p_spid=1">BI Support Engineer (IT08) (IT.08.4)</a></td><td>ICT</td><td>27 Nov 2099</td></tr>' +
    '<tr><td><a href="https://irec.wits.ac.za/OA_HTML/OA.jsp?page=/oracle/apps/irc/candidateSelfService/webui/VisVacDispPG&amp;IRC_EXT_SITE_VISITOR_APP=IRC_VIS_VAC_DISPLAY&amp;p_svid=108257&amp;p_spid=2">Human Resources Manager (AD.06.3)</a></td><td>HR</td><td>27 Nov 2099</td></tr>' +
    '<tr><td><a href="https://irec.wits.ac.za/OA_HTML/OA.jsp?page=/oracle/apps/irc/candidateSelfService/webui/VisVacDispPG&amp;IRC_EXT_SITE_VISITOR_APP=IRC_VIS_VAC_DISPLAY&amp;p_svid=108500&amp;p_spid=3">Lecturer: Electrical and Information Engineering (AC.08.4)</a></td><td>EIE</td><td>30 Nov 2099</td></tr>',
  'https://www.aku.edu/vacancies/pages/search-jobs.aspx?loc=Kenya':
    "<tr><td class=\"tdgrid jobtitle\"><a title=\"View Job Detail\" href='https://www.aku.edu/vacancies/pages/job-detail.aspx?JobID=9001&Title=Systems Administrator, ICT & Infrastructure '>Systems Administrator, ICT & Infrastructure </br>Aga Khan University </a></td><td class=\"tdgrid witdhtr2 joblocation\"><br /> Nairobi, Kenya <br /></td></tr>" +
    "<tr><td class=\"tdgrid jobtitle\"><a title=\"View Job Detail\" href='https://www.aku.edu/vacancies/pages/job-detail.aspx?JobID=8136&Title=Clinical Nurse, Wajir '>Clinical Nurse, Wajir </br>Aga Khan University Hospital </a></td><td class=\"tdgrid joblocation\"><br /> Kenya <br /></td></tr>",
  'https://www.usiu.ac.ke/job-vacancies/':
    '<h2><a href="https://www.usiu.ac.ke/vacancies/lecturer-information-systems/">Lecturer, Information Systems</a></h2><h2>NEW</h2><span>04/12/2099</span><a href="https://www.usiu.ac.ke/vacancies/lecturer-information-systems/">Read More</a>' +
    '<h2><a href="https://www.usiu.ac.ke/vacancies/marketing-officer/">Marketing Officer</a></h2><span>04/12/2099</span>' +
    '<h2><a href="https://www.usiu.ac.ke/vacancies/ict-officer/">ICT Officer</a></h2><span>01/01/2001</span>',
  'https://ashesi.bamboohr.com/careers/list': JSON.stringify({ result: [
    { id: '1', jobOpeningName: 'Faculty - Artificial Intelligence/Intelligent Systems', location: { city: 'Berekuso', state: 'Eastern Region' } },
    { id: '2', jobOpeningName: 'Medical Officer', location: { city: 'Berekuso', state: 'Eastern Region' } },
    { id: '3', jobOpeningName: 'IT Support Technician', location: { city: 'Berekuso', state: 'Eastern Region' } }] }),
  'https://boards-api.greenhouse.io/v1/boards/alu/jobs?content=true': JSON.stringify({ jobs: [
    { id: 11, title: 'Software Engineer', location: { name: 'Kigali, Rwanda' }, absolute_url: 'https://job-boards.greenhouse.io/alu/jobs/11', updated_at: '2026-11-20' },
    { id: 12, title: 'Faculty, Computer Science', location: { name: 'Kigali, Rwanda' }, absolute_url: 'https://job-boards.greenhouse.io/alu/jobs/12', updated_at: '2026-11-20' },
    { id: 13, title: 'Admissions Associate', location: { name: 'Kigali, Rwanda' }, absolute_url: 'https://job-boards.greenhouse.io/alu/jobs/13', updated_at: '2026-11-20' }] }),
};
global.fetch = function (url) {
  var body = PAGES[url];
  if (body === undefined) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve(null); }, text: function () { return Promise.resolve(''); } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(body)); }, text: function () { return Promise.resolve(body); } });
};
function co(name) { var c = F.COMPANIES.find(function (x) { return x.name === name; }); assert.ok(c, name + ' is listed'); return c; }
var pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 3).join('\n       ')); fail++; }
}
(async function () {
  await t('UCT: tech and tech-subject teaching roles kept; closing date read after the link; closed ones dropped', async function () {
    var j = await F._loadOne(co('University of Cape Town'));
    assert.deepStrictEqual(j.map(function (x) { return x.title; }).sort(), ['Lecturer: Computer Science', 'Visualisation Software Developer: IDIA']);
    var dev = j.find(function (x) { return /Visualisation/.test(x.title); });
    assert.strictEqual(dev.deadline, '2099-12-03');
    assert.strictEqual(dev.region, 'Rest of Africa');
    assert.ok(/sci-id1501-visdev-idia\.pdf$/.test(dev.url), 'the advert, not the description');
  });
  await t('Wits: grade codes stripped, closing date from the row, one id per vacancy', async function () {
    var j = await F._loadOne(co('University of the Witwatersrand'));
    assert.deepStrictEqual(j.map(function (x) { return x.title; }).sort(), ['BI Support Engineer (IT08)', 'Lecturer: Electrical and Information Engineering']);
    assert.strictEqual(j[0].deadline, j[0].title.indexOf('BI') === 0 ? '2099-11-27' : '2099-11-30');
    assert.strictEqual(new Set(j.map(function (x) { return x.id; })).size, 2);
  });
  await t('Aga Khan University: title from the link address, place from its column', async function () {
    var j = await F._loadOne(co('Aga Khan University'));
    assert.strictEqual(j.length, 1);
    assert.strictEqual(j[0].title, 'Systems Administrator, ICT & Infrastructure');
    assert.strictEqual(j[0].location, 'Nairobi, Kenya'); assert.strictEqual(j[0].region, 'Kenya');
  });
  await t('USIU-Africa: day/month closing dates; a closed advert is dropped', async function () {
    var j = await F._loadOne(co('USIU-Africa'));
    assert.deepStrictEqual(j.map(function (x) { return x.title; }), ['Lecturer, Information Systems']);
    assert.strictEqual(j[0].deadline, '2099-12-04');
  });
  await t('Ashesi: Ghana added to the town, so it counts as Africa', async function () {
    var j = await F._loadOne(co('Ashesi University'));
    assert.deepStrictEqual(j.map(function (x) { return x.title; }).sort(), ['Faculty - Artificial Intelligence/Intelligent Systems', 'IT Support Technician']);
    assert.strictEqual(j[0].location, 'Berekuso, Eastern Region, Ghana');
    assert.strictEqual(j[0].region, 'Rest of Africa');
  });
  await t('ALU: tech and computing faculty roles, not admissions', async function () {
    var j = await F._loadOne(co('African Leadership University'));
    assert.deepStrictEqual(j.map(function (x) { return x.title; }).sort(), ['Faculty, Computer Science', 'Software Engineer']);
  });
  await t('other employers are not loosened: a non-academic company still drops a lecturer post', async function () {
    var c = { name: 'Acme', ats: 'greenhouse', slug: 'alu' };   // same feed, no academic flag
    var j = await F._loadOne(c);
    assert.deepStrictEqual(j.map(function (x) { return x.title; }), ['Software Engineer']);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})();
