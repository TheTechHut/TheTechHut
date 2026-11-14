#!/usr/bin/env node
/*
 * Build /data/hackathons.json: the hackathons /hackathons/ lists, read from
 * Devpost and Devfolio's public listings.
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
      themes: (h.themes || []).map(function (t) { return t && (t.name || (t.theme && t.theme.name)); }).filter(Boolean),
      joined: h.participants_count || 0, source: 'Devfolio'
    };
  });
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
  }).map(slim);
  all.sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });
  if (all.length < MIN) {
    console.error('only %d hackathons came back; not writing %s', all.length, OUT);
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), count: all.length, hackathons: all }, null, 1) + '\n');
  console.log('wrote data/hackathons.json: %d hackathons', all.length);
}

main().catch(function (e) { console.error(e); process.exit(1); });
