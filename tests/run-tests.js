'use strict';
// Grove test suite — zero dependencies. Run: node tests/run-tests.js
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push({ name, message: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'assertEq'} — expected ${b}, got ${a}`);
}
function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(`${msg || 'assertThrows'} — did not throw`);
}

const L = require('../js/logic.js');

// ---------- levels ----------
test('xp 0 is level 1 Seedling', () => {
  const r = L.levelForXp(0);
  assertEq(r.level, 1); assertEq(r.title, 'Seedling'); assertEq(r.nextAt, 60); assertEq(r.progress, 0);
});
test('xp 59 still level 1', () => {
  const r = L.levelForXp(59);
  assertEq(r.level, 1); assert(r.progress > 0.9 && r.progress < 1, 'progress near 1');
});
test('xp 60 is level 2 Sprout', () => {
  const r = L.levelForXp(60);
  assertEq(r.level, 2); assertEq(r.title, 'Sprout');
});
test('xp 200 is level 3 Gardener with mid progress', () => {
  const r = L.levelForXp(200);
  assertEq(r.level, 3); assertEq(r.title, 'Gardener');
  assert(Math.abs(r.progress - (200 - 150) / 150) < 1e-9, 'progress fraction');
});
test('xp 1800 is max level Forest Heart, no next', () => {
  const r = L.levelForXp(1800);
  assertEq(r.level, 8); assertEq(r.title, 'Forest Heart'); assertEq(r.nextAt, null); assertEq(r.progress, 1);
});

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
for (const f of failures) console.log(`  FAIL ${f.name}: ${f.message}`);
process.exit(failed ? 1 : 0);
