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

// ---------- day math & streaks ----------
const T = (s) => new Date(s + 'T12:00:00').getTime(); // local noon of a date

test('dayKey formats local YYYY-MM-DD', () => {
  assertEq(L.dayKey(T('2026-07-02')), '2026-07-02');
});
test('daysBetween counts calendar days', () => {
  assertEq(L.daysBetween('2026-07-01', '2026-07-02'), 1);
  assertEq(L.daysBetween('2026-06-28', '2026-07-02'), 4);
  assertEq(L.daysBetween('2026-07-02', '2026-07-02'), 0);
});
test('first ever activity starts streak at 1', () => {
  const r = L.applyActivity({ count: 0, lastActiveDay: null, shields: 0 }, T('2026-07-02'));
  assertEq(r.streak.count, 1); assertEq(r.reset, false); assertEq(r.usedShield, false);
});
test('same-day activity is a no-op', () => {
  const r = L.applyActivity({ count: 3, lastActiveDay: '2026-07-02', shields: 1 }, T('2026-07-02'));
  assertEq(r.streak.count, 3); assertEq(r.streak.shields, 1);
});
test('next-day activity increments', () => {
  const r = L.applyActivity({ count: 3, lastActiveDay: '2026-07-01', shields: 0 }, T('2026-07-02'));
  assertEq(r.streak.count, 4); assertEq(r.streak.lastActiveDay, '2026-07-02');
});
test('7th consecutive day earns a dew shield, capped at 3', () => {
  const r = L.applyActivity({ count: 6, lastActiveDay: '2026-07-01', shields: 0 }, T('2026-07-02'));
  assertEq(r.streak.count, 7); assertEq(r.streak.shields, 1); assertEq(r.earnedShield, true);
  const r2 = L.applyActivity({ count: 13, lastActiveDay: '2026-07-01', shields: 3 }, T('2026-07-02'));
  assertEq(r2.streak.shields, 3, 'cap at 3');
});
test('1 missed day with a shield: shield consumed, streak continues', () => {
  const r = L.applyActivity({ count: 5, lastActiveDay: '2026-06-30', shields: 1 }, T('2026-07-02'));
  assertEq(r.streak.count, 6); assertEq(r.streak.shields, 0); assertEq(r.usedShield, true); assertEq(r.reset, false);
});
test('1 missed day without shield: quiet reset to 1', () => {
  const r = L.applyActivity({ count: 5, lastActiveDay: '2026-06-30', shields: 0 }, T('2026-07-02'));
  assertEq(r.streak.count, 1); assertEq(r.reset, true);
});
test('2 missed days with 2 shields: both consumed, streak continues', () => {
  const r = L.applyActivity({ count: 9, lastActiveDay: '2026-06-29', shields: 2 }, T('2026-07-02'));
  assertEq(r.streak.count, 10); assertEq(r.streak.shields, 0); assertEq(r.usedShield, true);
});
test('3 missed days with 1 shield: reset, shield kept', () => {
  const r = L.applyActivity({ count: 9, lastActiveDay: '2026-06-28', shields: 1 }, T('2026-07-02'));
  assertEq(r.streak.count, 1); assertEq(r.reset, true); assertEq(r.streak.shields, 1);
  assertEq(r.missedDays, 3);
});

// ---------- goal stages & step completion ----------
function makeGoal(total, done) {
  const steps = [];
  for (let i = 0; i < total; i++) steps.push({ id: 's' + i, text: 'step ' + i, done: i < done, doneAt: null });
  return { id: 'g1', name: 'Run a 5K', domain: 'fitness', emoji: '🏃‍♀️', steps, createdAt: 0, bloomedAt: null, reflection: null };
}
function makeState(goal) {
  return {
    xp: 0, petals: 0, sunshineSent: 0, challengesWon: 0,
    streak: { count: 0, lastActiveDay: null, shields: 0 },
    goals: goal ? [goal] : [], badges: {}, journal: [],
    circle: { members: [], feed: [], activeStruggle: null,
      challenge: { weekKey: L.weekKey(T('2026-07-02')), target: 55, progress: 0, playerSteps: 0, rewarded: false } },
  };
}

test('goal stages follow completion fractions', () => {
  assertEq(L.goalStage(makeGoal(10, 0)), 0, 'seed');
  assertEq(L.goalStage(makeGoal(10, 2)), 1, 'sprout');
  assertEq(L.goalStage(makeGoal(10, 4)), 2, 'bud');
  assertEq(L.goalStage(makeGoal(10, 8)), 3, 'bloom');
  assertEq(L.goalStage(makeGoal(10, 10)), 4, 'radiant');
});
test('completeStep marks done, awards xp and petals, advances streak', () => {
  const st = makeState(makeGoal(10, 0));
  const events = L.completeStep(st, 'g1', 's0', T('2026-07-02'));
  assert(st.goals[0].steps[0].done, 'step done');
  assert(st.goals[0].steps[0].doneAt !== null, 'doneAt set');
  assertEq(st.xp, L.XP.STEP); assertEq(st.petals, L.PETALS.STEP);
  assertEq(st.streak.count, 1);
  assert(events.some(e => e.type === 'step'), 'step event');
});
test('completeStep emits stage-up when a stage boundary is crossed', () => {
  const st = makeState(makeGoal(10, 1)); // 1/10 sprout; completing 4th of 10 → next completion is 2/10 stays sprout
  const st2 = makeState(makeGoal(10, 3)); // 3/10 sprout → 4/10 bud
  const ev = L.completeStep(st2, 'g1', 's3', T('2026-07-02'));
  assert(ev.some(e => e.type === 'stage-up' && e.stage === 2), 'stage-up to bud');
  const ev2 = L.completeStep(st, 'g1', 's1', T('2026-07-02'));
  assert(!ev2.some(e => e.type === 'stage-up'), 'no stage-up inside same stage');
});
test('completing the last step blooms the goal with bonus rewards', () => {
  const st = makeState(makeGoal(3, 2));
  const ev = L.completeStep(st, 'g1', 's2', T('2026-07-02'));
  assert(st.goals[0].bloomedAt !== null, 'bloomedAt set');
  assert(ev.some(e => e.type === 'bloom' && e.goalId === 'g1'), 'bloom event');
  assertEq(st.xp, L.XP.STEP + L.XP.BLOOM);
  assertEq(st.petals, L.PETALS.STEP + L.PETALS.BLOOM);
});
test('completing an already-done step awards nothing', () => {
  const st = makeState(makeGoal(10, 1));
  const ev = L.completeStep(st, 'g1', 's0', T('2026-07-02'));
  assertEq(ev.length, 0); assertEq(st.xp, 0);
});
test('completeStep feeds the weekly challenge', () => {
  const st = makeState(makeGoal(10, 0));
  L.completeStep(st, 'g1', 's0', T('2026-07-02'));
  assertEq(st.circle.challenge.progress, 1);
  assertEq(st.circle.challenge.playerSteps, 1);
});
test('cheer awards xp/petals and counts sunshine', () => {
  const st = makeState(null);
  const ev = L.cheer(st, T('2026-07-02'));
  assertEq(st.xp, L.XP.CHEER); assertEq(st.petals, L.PETALS.CHEER); assertEq(st.sunshineSent, 1);
  assert(ev.some(e => e.type === 'cheer'), 'cheer event');
});

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
for (const f of failures) console.log(`  FAIL ${f.name}: ${f.message}`);
process.exit(failed ? 1 : 0);
