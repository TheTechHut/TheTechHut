// node scripts/tests/held_roles.test.js
'use strict';
var assert = require('assert');
var B = require('../build_jobs_board.js');

var now = new Date('2026-11-24T15:00:00Z');
var prev = {
  updated: '2026-11-24T12:00:00Z',
  jobs: [
    { id: 'ad-1', title: 'Data Engineer', source: 'I&M Bank', url: 'https://x.test/1', checked: '2026-11-24T12:00:00Z', page: 'data-engineer-i-m-bank-00000001' },
    { id: 'ad-2', title: 'Old role', source: 'I&M Bank', url: 'https://x.test/2', checked: '2026-11-20T12:00:00Z' },
    { id: 'ad-3', title: 'Closed role', source: 'I&M Bank', url: 'https://x.test/3', checked: '2026-11-24T12:00:00Z', deadline: '2026-11-23' },
    { id: 'gh-4', title: 'Engineer', source: 'Andela', url: 'https://x.test/4', checked: '2026-11-24T12:00:00Z' },
    { id: 'ad-5', title: 'No checked yet', source: 'I&M Bank', url: 'https://x.test/5' }
  ]
};
var tests = 0;
function t(name, fn) { fn(); tests++; console.log('ok - ' + name); }

t('holds a silent employer\'s recent roles', function () {
  var ids = B.heldRoles(prev, ['I&M Bank'], now).map(function (j) { return j.id; });
  assert.deepStrictEqual(ids, ['ad-1', 'ad-5']);
});
t('drops roles not confirmed within HOLD_DAYS', function () {
  assert.ok(!B.heldRoles(prev, ['I&M Bank'], now).some(function (j) { return j.id === 'ad-2'; }));
});
t('drops roles whose closing date has passed', function () {
  assert.ok(!B.heldRoles(prev, ['I&M Bank'], now).some(function (j) { return j.id === 'ad-3'; }));
});
t('does not hold roles of employers that answered', function () {
  assert.ok(!B.heldRoles(prev, ['I&M Bank'], now).some(function (j) { return j.source === 'Andela'; }));
});
t('a role with no checked time takes the board\'s update time', function () {
  var j = B.heldRoles(prev, ['I&M Bank'], now).filter(function (j) { return j.id === 'ad-5'; })[0];
  assert.strictEqual(j.checked, prev.updated);
});
t('keeps the page slug so the old link still works', function () {
  assert.strictEqual(B.heldRoles(prev, ['I&M Bank'], now)[0].page, 'data-engineer-i-m-bank-00000001');
});
t('no previous board, nothing held', function () {
  assert.deepStrictEqual(B.heldRoles(null, ['I&M Bank'], now), []);
});
console.log(tests + ' tests passed');
