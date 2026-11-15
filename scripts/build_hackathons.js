#!/usr/bin/env node
/*
 * Build /data/hackathons.json: the hackathons /hackathons/ lists, read from
 * Devpost and Devfolio's public listings, each with its prizes, plus the
 * hackathons people posted on Reddit (r/hackathon) in the last three weeks.
 * scripts/build_hackathon_pages.js then writes one page per hackathon from it.
 *
 * Kept: hackathons someone in Kenya can enter, which means online ones and
 * in-person ones in Africa. Invite-only ones are left out.
 *
 * Runs once a day in .github/workflows/jobs-snapshot.yml, before that workflow
 * commits data/, so the file is committed and deployed with the snapshot.
 *
 *   node scripts/build_hackathons.js            writes data/hackathons.json
 *
 * Exits non-zero, writing nothing, when too few came back (a network problem),
 * so a bad run never replaces a good file.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var F = require('../assets/js/jobs-feeds.js');

var OUT = path.join(__dirname, '..', 'data', 'hackathons.json');
var MIN = 10;
var UA = 'TheTechHutBot/1.0 (+https://thetechhut.co/hackathons/)';
var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

async function getJSON(url, init) {
  init = init || {};
  init.headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, init.headers);
  init.signal = AbortSignal.timeout(25000);
  var r = await fetch(url, init);
  if (!r.ok) throw new Error(url + ' answered ' + r.status);
  return r.json();
}

function inAfrica(place) { var r = F.regionOf(place); return r === 'Kenya' || r === 'Rest of Africa'; }
function iso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

// Devpost writes the period as "Oct 30 - Dec 04, 2026", "Nov 11 - 30, 2026" or
// "Nov 11, 2026 - Jan 11, 2027" (one date when it is a single day). -> [start, end]
// as YYYY-MM-DD, or null when it is written some other way.
function devpostDates(s) {
  var parts = String(s || '').split(' - ').map(function (p) {
    var m = /^(?:([A-Za-z]{3})[a-z]*\s+)?(\d{1,2})(?:,\s*(\d{4}))?$/.exec(p.trim());
    return m && { mon: m[1] && MON[m[1].toLowerCase()], day: +m[2], year: m[3] && +m[3] };
  });
  var a = parts[0], b = parts[parts.length - 1];
  if (parts.length > 2 || !a || !b || !a.mon || !b.year) return null;
  return [iso(a.year || b.year, a.mon, a.day), iso(b.year, b.mon || a.mon, b.day)];
}

async function devpost() {
  var out = [], total = Infinity;
  for (var page = 1; page <= 10 && out.length < total; page++) {
    var d = await getJSON('https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&per_page=40&page=' + page);
    total = (d.meta && d.meta.total_count) || 0;
    if (!d.hackathons || !d.hackathons.length) break;
    out = out.concat(d.hackathons);
  }
  return out.map(function (h) {
    var loc = h.displayed_location || {}, online = loc.icon === 'globe';
    var dates = devpostDates(h.submission_period_dates);
    if (h.invite_only || !dates || !(online || inAfrica(loc.location))) return null;
    var prize = F.clean(h.prize_amount || '', 40).replace(/^(\D+) (?=\d)/, '$1');
    return {
      id: 'devpost-' + h.id, title: h.title, host: h.organization_name || '', url: h.url,
      mode: online ? 'Online' : 'In person', place: online ? 'Online' : loc.location,
      starts: dates[0], ends: dates[1], deadline: dates[1],
      prize: /[1-9]/.test(prize) ? prize : '',
      themes: (h.themes || []).map(function (t) { return t.name; }),
      joined: h.registrations_count || 0, source: 'Devpost'
    };
  });
}

async function devfolio() {
  var d = await getJSON('https://api.devfolio.co/api/search/hackathons', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'application_open', from: 0, size: 100 })
  });
  return ((d.hits && d.hits.hits) || []).map(function (hit) {
    var h = hit._source || {}, set = h.hackathon_setting || {};
    var place = [h.city, h.country].filter(Boolean).join(', ');
    if (h.private || !h.slug || !h.starts_at || !h.ends_at || !(h.is_online || inAfrica(place))) return null;
    return {
      id: 'devfolio-' + h.uuid, title: h.name, host: '', url: 'https://' + h.slug + '.devfolio.co/',
      mode: h.is_online ? 'Online' : 'In person', place: h.is_online ? 'Online' : place,
      starts: h.starts_at.slice(0, 10), ends: h.ends_at.slice(0, 10),
      deadline: (set.reg_ends_at || h.starts_at).slice(0, 10),
      excerpt: F.clean(h.tagline || '', 190),
      prizes: (h.prizes || []).slice(0, MAX_PRIZES).map(function (p) { return slim({ title: F.clean(p.name, 90), desc: F.clean(p.desc, 220) }); }),
      themes: (h.themes || []).map(function (t) { return t && (t.name || (t.theme && t.theme.name)); }).filter(Boolean),
      joined: h.participants_count || 0, source: 'Devfolio'
    };
  });
}

// Devpost's list gives only the total. Each prize (name, value, how many winners,
// what it is) and the one-line pitch are on the hackathon's own page, so read
// that page for every hackathon kept, a few at a time. One that does not answer
// keeps its total and gets no prize list.
var MAX_PRIZES = 30;
function devpostPrizes(html) {
  return html.split(/<div class="[^"]*\bprize" id="prize_\d+">/).slice(1, MAX_PRIZES + 1).map(function (b) {
    b = b.split(/<\/article>|<\/section>|id="content-sidebar"/)[0];
    var get = function (re, max) { var m = re.exec(b); return m ? F.clean(m[1], max) : ''; };
    return slim({
      title: get(/class="prize-title">([\s\S]*?)<\/h6>/, 90),
      value: get(/class="prize-value">([\s\S]*?)<\/div>/, 60).replace(/^(\D+) (?=\d)/, '$1'),
      winners: get(/class="prize-winners">([\s\S]*?)<\/div>/, 30),
      desc: get(/class="prize-content">[\s\S]*?<p>([\s\S]*?)<\/p>/, 220)
    });
  }).filter(function (p) { return p.title; });
}
async function addDevpostDetails(all) {
  var todo = all.filter(function (h) { return h.source === 'Devpost'; }), next = 0, got = 0;
  async function worker() {
    while (next < todo.length) {
      var h = todo[next++];
      try {
        var r = await fetch(h.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        var html = await r.text();
        var pitch = /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/.exec(html);
        if (pitch) h.excerpt = F.clean(pitch[1], 190);
        h.prizes = devpostPrizes(html);
        if (h.prizes.length) got++;
      } catch (e) { /* keep the hackathon without its prize list */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log('Devpost prize lists read: %d of %d', got, todo.length);
}

// Posts in r/hackathon (its public Atom feed) that announce a hackathon: they
// name a hackathon in the title, link to a page outside Reddit and are not a
// question, a team search, a results thread or someone's own entry. Reddit gives no dates or prizes, so these are shown as a
// separate "posted on Reddit" list, not mixed into the dated one.
var NOT_A_PAGE = /reddit\.com|redd\.it|reddit(static|media)\.com|youtu\.?be|forms\.|docs\.google|discord|t\.me\/|whatsapp|imgur|linkedin\.com|instagram\.com|github\.com|\.(png|jpe?g|gif|webp)(\?|$)/i;
var NOT_NEWS = /\?|looking for|need(ed|s)?\b|team ?mates?|\bhelp\b|results?\b|\bideas?\b|\badvice\b|\bwon\b|winners?\b|\bwe built\b|status update|submission|\bvote\b|participated|\b(I|my)\b/i;
var SHARED_DAYS = 21;
async function reddit() {
  var r = await fetch('https://www.reddit.com/r/hackathon/new/.rss?limit=100', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('Reddit answered ' + r.status);
  var xml = await r.text();
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(function (e) {
    var get = function (re) { var m = re.exec(e); return m ? m[1] : ''; };
    var raw = get(/<content[^>]*>([\s\S]*?)<\/content>/);
    var title = F.clean(get(/<title>([\s\S]*?)<\/title>/), 140);
    var links = (raw.match(/href=(?:&quot;|")(https:\/\/[^"&<> ]+)/g) || [])
      .map(function (l) { return l.replace(/^href=(?:&quot;|")/, ''); })
      .filter(function (l) { return !NOT_A_PAGE.test(l); });
    if (!links.length || NOT_NEWS.test(title) || !/hack|buildathon/i.test(title)) return null;
    return { title: title, url: get(/<link href="(https:\/\/www\.reddit\.com\/[^"]+)"/), link: links[0],
             date: get(/<(?:published|updated)>([^<]+)</).slice(0, 10), source: 'r/hackathon' };
  }).filter(function (p) { return p && p.url && p.date; });
}

// "Kiroween 2026" + devpost-31667 -> "kiroween-2026-31667": the page's folder under hackathons/event/
function slugOf(h) {
  var s = String(h.title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return (s || 'hackathon') + '-' + h.id.replace(/^[a-z]+-/, '').slice(0, 8);
}

function slim(h) {
  var o = {};
  Object.keys(h).forEach(function (k) {
    var v = h[k];
    if (v === undefined || v === '' || v === 0 || (Array.isArray(v) && !v.length)) return;
    o[k] = v;
  });
  return o;
}

async function main() {
  var sources = { Devpost: devpost, Devfolio: devfolio }, all = [];
  for (var name of Object.keys(sources)) {
    try {
      var got = (await sources[name]()).filter(Boolean);
      console.log('%s: %d', name, got.length);
      all = all.concat(got);
    } catch (e) { console.error('%s did not answer: %s', name, e.message); }
  }
  var today = new Date().toISOString().slice(0, 10), seen = {};
  all = all.filter(function (h) {
    var k = String(h.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k || !/^https:\/\//.test(h.url || '') || h.deadline < today || seen[k]) return false;
    seen[k] = 1; return true;
  });
  await addDevpostDetails(all);
  all.forEach(function (h) { h.page = slugOf(h); });
  all = all.map(slim);
  all.sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });
  if (all.length < MIN) {
    console.error('only %d hackathons came back; not writing %s', all.length, OUT);
    process.exit(1);
  }
  // Reddit often turns away requests from data centres. When it does, keep the
  // posts already in the file; either way drop the ones older than three weeks
  // and the ones that point at a hackathon already listed above.
  var shared = [];
  try { shared = await reddit(); console.log('Reddit: %d posts announce a hackathon', shared.length); }
  catch (e) {
    console.error('Reddit did not answer: %s', e.message);
    try { shared = JSON.parse(fs.readFileSync(OUT, 'utf8')).shared || []; } catch (e2) { /* no earlier file */ }
  }
  var cutoff = new Date(Date.now() - SHARED_DAYS * 864e5).toISOString().slice(0, 10), listed = {}, links = {};
  var key = function (u) { return String(u).toLowerCase().replace(/^https:\/\/(www\.)?/, '').replace(/[/?#].*$/, ''); };
  all.forEach(function (h) { listed[key(h.url)] = 1; });
  shared = shared.filter(function (p) {
    if (p.date < cutoff || listed[key(p.link)] || links[p.link]) return false;
    links[p.link] = 1; return true;
  });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), count: all.length, hackathons: all, shared: shared }, null, 1) + '\n');
  console.log('wrote data/hackathons.json: %d hackathons, %d from Reddit', all.length, shared.length);
}

main().catch(function (e) { console.error(e); process.exit(1); });
