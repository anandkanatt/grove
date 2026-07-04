'use strict';
// Grove test suite — zero dependencies. Run: node tests/run-tests.js
// Tests are queued and run strictly in order (async fns are awaited), so
// shared fixtures like GroveState._setStorage never interleave.
let passed = 0, failed = 0;
const failures = [];
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
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
const S = require('../js/state.js');
const D = require('../js/data.js');
const Sim = require('../js/sim.js');
const Social = require('../js/social.js');

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

// ---------- weekly challenge ----------
test('weekKey returns the Monday of the week', () => {
  assertEq(L.weekKey(T('2026-07-02')), '2026-06-29'); // Thu → Mon
  assertEq(L.weekKey(T('2026-06-29')), '2026-06-29'); // Mon → itself
  assertEq(L.weekKey(T('2026-07-05')), '2026-06-29'); // Sun → prior Mon
});
test('challengeTarget scales with active goals, capped', () => {
  const one = makeState(makeGoal(5, 0));
  assertEq(L.challengeTarget(one), 55);
  const many = makeState(null);
  for (let i = 0; i < 6; i++) many.goals.push(makeGoal(5, 0));
  assertEq(L.challengeTarget(many), 70);
  const bloomed = makeState(makeGoal(3, 3)); bloomed.goals[0].bloomedAt = 1;
  assertEq(L.challengeTarget(bloomed), 50, 'bloomed goals are not active');
});
test('challengeTarget is a flat 70 for real circles', () => {
  const st = S.defaultState(T('2026-07-02'));
  st.goals.push(makeGoal(5, 0));
  assertEq(L.challengeTarget(st), 55, 'solo keeps the v1 formula');
  st.net.circle = { id: 'c1', name: 'Us', inviteCode: 'ABC234', memberId: 'me' };
  assertEq(L.challengeTarget(st), 70, 'real circle target is shared and flat');
  L.rolloverChallengeIfNeeded(st, T('2026-07-06'));
  assertEq(st.circle.challenge.target, 70, 'rollover arms the flat target');
});
test('rollover resets challenge on a new week only', () => {
  const st = makeState(makeGoal(5, 0));
  st.circle.challenge.progress = 12; st.circle.challenge.rewarded = true;
  assertEq(L.rolloverChallengeIfNeeded(st, T('2026-07-03')), false, 'same week: no reset');
  assertEq(st.circle.challenge.progress, 12);
  assertEq(L.rolloverChallengeIfNeeded(st, T('2026-07-06')), true, 'next Monday: reset');
  assertEq(st.circle.challenge.progress, 0);
  assertEq(st.circle.challenge.rewarded, false);
  assertEq(st.circle.challenge.weekKey, '2026-07-06');
  assertEq(st.circle.challenge.playerSteps, 0);
});
test('reaching the target rewards exactly once', () => {
  const st = makeState(makeGoal(5, 0));
  st.circle.challenge.target = 3;
  L.addChallengeProgress(st, 2, T('2026-07-02'), false);
  assertEq(st.challengesWon, 0);
  const ev = L.addChallengeProgress(st, 1, T('2026-07-02'), false);
  assert(ev.some(e => e.type === 'challenge-complete'), 'completion event');
  assertEq(st.challengesWon, 1);
  const xpAfter = st.xp;
  L.addChallengeProgress(st, 5, T('2026-07-02'), false);
  assertEq(st.xp, xpAfter, 'no double reward');
  assertEq(st.challengesWon, 1);
});

test('an uninitialized challenge (target 0) never rewards', () => {
  const st = makeState(makeGoal(5, 0));
  st.circle.challenge.target = 0; // pre-rollover state, e.g. right after onboarding
  const ev = L.addChallengeProgress(st, 1, T('2026-07-02'), true);
  assertEq(ev.length, 0, 'no completion event');
  assertEq(st.challengesWon, 0);
  assertEq(st.xp, 0);
});

// ---------- badges ----------
test('first-step and first-bloom badges trigger once', () => {
  const st = makeState(makeGoal(3, 0));
  L.completeStep(st, 'g1', 's0', T('2026-07-02'));
  let earned = L.evaluateBadges(st, T('2026-07-02'));
  assert(earned.includes('first-step'), 'first-step earned');
  earned = L.evaluateBadges(st, T('2026-07-02'));
  assertEq(earned.length, 0, 'no re-trigger');
  L.completeStep(st, 'g1', 's1', T('2026-07-02'));
  L.completeStep(st, 'g1', 's2', T('2026-07-02'));
  earned = L.evaluateBadges(st, T('2026-07-02'));
  assert(earned.includes('first-bloom'), 'first-bloom earned');
});
test('streak-7 and sunshine-10 badges', () => {
  const st = makeState(null);
  st.streak.count = 7;
  st.sunshineSent = 10;
  const earned = L.evaluateBadges(st, T('2026-07-02'));
  assert(earned.includes('streak-7'), 'streak-7');
  assert(earned.includes('sunshine-10'), 'sunshine-10');
});
test('comeback badge fires after a 3+ day gap reset', () => {
  const st = makeState(makeGoal(5, 0));
  st.streak = { count: 9, lastActiveDay: '2026-06-28', shields: 0 };
  L.completeStep(st, 'g1', 's0', T('2026-07-02')); // 3 missed days → reset
  const earned = L.evaluateBadges(st, T('2026-07-02'));
  assert(earned.includes('comeback'), 'comeback earned');
});
test('challenge and variety badges', () => {
  const st = makeState(null);
  st.challengesWon = 1;
  const g1 = makeGoal(2, 2); g1.id = 'a'; g1.domain = 'fitness'; g1.bloomedAt = 1;
  const g2 = makeGoal(2, 2); g2.id = 'b'; g2.domain = 'career'; g2.bloomedAt = 1;
  const g3 = makeGoal(2, 2); g3.id = 'c'; g3.domain = 'creative'; g3.bloomedAt = 1;
  st.goals.push(g1, g2, g3);
  const earned = L.evaluateBadges(st, T('2026-07-02'));
  assert(earned.includes('challenge-1'), 'challenge-1');
  assert(earned.includes('variety-bloom'), 'variety-bloom (3 domains)');
  assert(earned.includes('three-blooms'), 'three-blooms');
});

// ---------- state persistence ----------
function fakeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump: () => store,
  };
}

test('defaultState has the full schema', () => {
  const st = S.defaultState(T('2026-07-02'));
  assertEq(st.version, 5);
  for (const key of ['player', 'xp', 'petals', 'streak', 'goals', 'journal', 'badges',
    'decor', 'shopOwned', 'sunshineSent', 'challengesWon', 'circle', 'lastVisit', 'onboarded', 'net']) {
    assert(key in st, `missing key ${key}`);
  }
  assertEq(st.streak.shields, 1, 'starts with one gift shield');
  assert(Array.isArray(st.circle.feed), 'feed array');
  assert('challenge' in st.circle, 'challenge present');
});
test('save/load round-trip preserves state', () => {
  const storage = fakeStorage();
  S._setStorage(storage);
  const st = S.defaultState(T('2026-07-02'));
  st.player.name = 'Ana';
  st.xp = 123;
  S.save(st);
  const back = S.load();
  assertEq(back.player.name, 'Ana');
  assertEq(back.xp, 123);
});
test('corrupt storage loads as null, never throws', () => {
  const storage = fakeStorage();
  storage.setItem('grove-save-v1', '{nope');
  S._setStorage(storage);
  assertEq(S.load(), null);
  storage.setItem('grove-save-v1', '{"version":99}');
  assertEq(S.load(), null, 'unknown version rejected');
});
test('export/import round-trips; garbage import throws', () => {
  S._setStorage(fakeStorage());
  const st = S.defaultState(T('2026-07-02'));
  st.player.name = 'Priya';
  const json = S.exportJson(st);
  const back = S.importJson(json);
  assertEq(back.player.name, 'Priya');
  assertThrows(() => S.importJson('{}'), 'empty object rejected');
  assertThrows(() => S.importJson('not json'), 'non-json rejected');
});

// ---------- state v2 (real circles) ----------
test('defaultState carries the full net block', () => {
  const st = S.defaultState(T('2026-07-02'));
  assertEq(st.net, { session: null, circle: null, members: [], cursor: 0,
    outbox: [], lastSyncAt: null, playerStruggle: null,
    platform: null, memberKey: null });
});
test('a v1 save loads and migrates to v2', () => {
  const storage = fakeStorage();
  S._setStorage(storage);
  const v1 = S.defaultState(T('2026-07-01'));
  v1.version = 1;
  delete v1.net;
  v1.goals.push({ id: 'g1', name: 'x', domain: 'career', emoji: 'x', steps: [],
    createdAt: 0, bloomedAt: null, reflection: null });
  storage.setItem('grove-save-v1', JSON.stringify(v1));
  const back = S.load();
  assertEq(back.version, 5);
  assertEq(back.net.outbox, [], 'net block added');
  assertEq(back.net.cursor, 0);
  assertEq(back.goals[0].private, false, 'goals gain the private flag');
});
test('v2 save/load round-trip preserves the net block', () => {
  const storage = fakeStorage();
  S._setStorage(storage);
  const st = S.defaultState(T('2026-07-02'));
  st.net.cursor = 42;
  st.net.circle = { id: 'c1', name: 'Us', inviteCode: 'ABC234', memberId: 'me' };
  S.save(st);
  assertEq(S.load(), st);
});
test('importJson migrates v1 exports and still rejects garbage', () => {
  const v1 = S.defaultState(T('2026-07-01'));
  v1.version = 1;
  delete v1.net;
  const back = S.importJson(JSON.stringify(v1));
  assertEq(back.version, 5);
  assert('net' in back, 'net added');
  assertEq(back.net.session, null);
  assertThrows(() => S.importJson('{}'), 'empty object rejected');
});

// ---------- state v3 (whisperer) ----------
test('defaultState carries the v3 whisperer fields', () => {
  const st = S.defaultState(T('2026-07-02'));
  assertEq(st.net.platform, null);
  assertEq(st.net.memberKey, null);
  assertEq(st.aiConsent, { enabled: false, notedAt: null });
  assertEq(st.dailyWhisper, { day: null, text: null });
});
test('a v2 save migrates to v3 preserving phase-2 data', () => {
  const storage = fakeStorage();
  S._setStorage(storage);
  const v2 = S.defaultState(T('2026-07-01'));
  v2.version = 2;
  delete v2.aiConsent;
  delete v2.dailyWhisper;
  delete v2.net.platform;
  delete v2.net.memberKey;
  v2.goals.push({ id: 'g1', name: 'x', domain: 'career', emoji: 'x', steps: [],
    createdAt: 0, bloomedAt: null, reflection: null, private: true });
  v2.net.circle = { id: 'c1', name: 'Us', inviteCode: 'ABC234', memberId: 'me' };
  storage.setItem('grove-save-v1', JSON.stringify(v2));
  const back = S.load();
  assertEq(back.version, 5);
  assertEq(back.aiConsent, { enabled: false, notedAt: null });
  assertEq(back.dailyWhisper, { day: null, text: null });
  assertEq(back.net.platform, null);
  assertEq(back.net.memberKey, null);
  assertEq(back.goals[0].private, true, 'private flag survives');
  assertEq(back.net.circle.inviteCode, 'ABC234', 'circle survives');
});

// ---------- content shape ----------
test('six domains, each with template coverage', () => {
  assertEq(D.DOMAINS.length, 6);
  for (const dom of D.DOMAINS) {
    assert(dom.id && dom.name && dom.emoji && dom.color, 'domain fields');
    const templates = D.GOAL_TEMPLATES.filter(t => t.domain === dom.id);
    assert(templates.length >= 3, `domain ${dom.id} needs >=3 templates, has ${templates.length}`);
  }
});
test('every template has 6-10 concrete tiny steps', () => {
  for (const t of D.GOAL_TEMPLATES) {
    assert(t.name && t.emoji && t.domain, 'template fields');
    assert(t.steps.length >= 6 && t.steps.length <= 10, `${t.name}: ${t.steps.length} steps`);
    for (const s of t.steps) assert(typeof s === 'string' && s.length > 8, 'step is a real sentence');
  }
});
test('five circle members with full voices', () => {
  assertEq(D.MEMBERS.length, 5);
  const ids = new Set();
  for (const m of D.MEMBERS) {
    ids.add(m.id);
    assert(m.name && m.bio && m.palette && m.palette.petal && m.palette.center, `${m.id} identity`);
    assert(m.pace > 0 && m.pace <= 1, 'pace in (0,1]');
    assert(m.struggleProne >= 0 && m.struggleProne <= 1, 'struggleProne in [0,1]');
    assertEq(m.goals.length, 2, `${m.id} has two goals`);
    for (const g of m.goals) assert(g.name && g.domain, 'member goal fields');
    assert(m.cheers.length >= 6, `${m.id} needs >=6 cheers`);
    assert(m.struggles.length >= 3, `${m.id} needs >=3 struggles`);
    assert(m.recoveries.length >= 3, `${m.id} needs >=3 recoveries`);
    assert(m.feedVerbs.length >= 4, `${m.id} needs >=4 feed verbs`);
    for (const r of m.recoveries) assert(r.includes('{name}'), `${m.id} recovery credits the player`);
  }
  assertEq(ids.size, 5, 'unique ids');
});
test('affirmations, comeback lines, badges, shop, avatars', () => {
  assert(D.AFFIRMATIONS.length >= 15, 'affirmations >=15');
  assert(D.COMEBACK_LINES.length >= 4, 'comeback lines >=4');
  for (const id of Object.keys(L.BADGE_CHECKS)) {
    assert(D.BADGES[id] && D.BADGES[id].name && D.BADGES[id].icon && D.BADGES[id].desc,
      `badge display missing for ${id}`);
  }
  assert(D.SHOP_ITEMS.length >= 8, 'shop >=8');
  const kinds = new Set();
  for (const it of D.SHOP_ITEMS) {
    assert(it.id && it.name && it.price > 0 && it.kind, 'shop item fields');
    kinds.add(it.kind);
  }
  assertEq(kinds.size, D.SHOP_ITEMS.length, 'unique decor kinds');
  assert(D.PLAYER_AVATARS.length >= 6, 'avatars >=6');
  assert(D.ACCENTS.length >= 4, 'accents >=4');
});

// ---------- whisper: consent, payloads, privacy ----------
const Whisper = require('../js/whisper.js');

function whisperState() {
  const st = S.defaultState(T('2026-07-02'));
  st.goals.push(
    { id: 'g1', name: 'Run 5K', domain: 'fitness', emoji: '🏃‍♀️',
      steps: [{ id: 's1', text: 'run', done: true, doneAt: T('2026-07-01') },
              { id: 's2', text: 'run more', done: false, doneAt: null }],
      createdAt: 0, bloomedAt: null, reflection: null, private: false },
    { id: 'g2', name: 'Secret', domain: 'career', emoji: '🌙',
      steps: [{ id: 's3', text: 'shh', done: true, doneAt: T('2026-06-30') }],
      createdAt: 0, bloomedAt: null, reflection: null, private: true }
  );
  st.journal.push(
    { day: '2026-07-01', text: 'ran and felt great', goalId: 'g1' },
    { day: '2026-06-30', text: 'quiet progress note', goalId: 'g2' }
  );
  st.streak.count = 3;
  return st;
}

test('whisper consent lifecycle', () => {
  const st = whisperState();
  assertEq(Whisper.consentGranted(st), false);
  Whisper.grantConsent(st, T('2026-07-02'));
  assertEq(Whisper.consentGranted(st), true);
  assertEq(st.aiConsent.notedAt, T('2026-07-02'));
  Whisper.revokeConsent(st);
  assertEq(Whisper.consentGranted(st), false);
});
test('whisper context and insights exclude private goals', () => {
  const st = whisperState();
  const ctx = Whisper.whisperContext(st);
  assertEq(ctx.goals, ['Run 5K'], 'private goal titles never leave the device');
  assertEq(ctx.streak, 3);
  assertEq(ctx.blooms, 0);
  const p = Whisper.insightsPayload(st);
  assertEq(p.reflections.length, 1);
  assert(p.reflections[0].text.includes('ran and felt great'), 'public reflection kept');
  assert(!JSON.stringify(p).includes('Secret'), 'no private goal name anywhere in payload');
  assert(!JSON.stringify(p).includes('quiet progress note'), 'no private journal text');
  assertEq(p.stats.stepsByWeekday.length, 7);
  assertEq(p.stats.stepsByWeekday.reduce((a, b) => a + b, 0), 2, 'aggregate counts stay');
  assertEq(p.stats.streak, 3);
});
test('daily whisper is remembered per local day', () => {
  const st = whisperState();
  assertEq(Whisper.dailyWhisperDue(st, T('2026-07-02')), true);
  Whisper.rememberWhisper(st, 'grow gently', T('2026-07-02'));
  assertEq(Whisper.dailyWhisperDue(st, T('2026-07-02')), false);
  assertEq(st.dailyWhisper, { day: '2026-07-02', text: 'grow gently' });
  assertEq(Whisper.dailyWhisperDue(st, T('2026-07-03')), true);
});
test('voice helpers are safe no-ops outside the browser', () => {
  assertEq(Whisper.speechAvailable(), false);
  assertEq(Whisper.speakAvailable(), false);
  assertEq(Whisper.makeDictation(() => {}), null);
  assertEq(Whisper.speak('hello'), false, 'speak never throws');
});

// ---------- social: roster, spirit slots, builders ----------
function socialState() {
  const st = S.defaultState(T('2026-07-02'));
  Sim.initMembers(st);
  st.net.circle = { id: 'c1', name: 'Us', inviteCode: 'ABC234', memberId: 'me' };
  st.net.members = [
    { id: 'me', name: 'Anu', avatarId: '0', accentId: '0', joinedAt: '2026-07-01T00:00:00Z' },
    { id: 'm2', name: 'Rhea', avatarId: '1', accentId: '1', joinedAt: '2026-07-02T00:00:00Z' },
  ];
  return st;
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('roster puts real members first, spirits fill to five', () => {
  const r = Social.roster(socialState(), D);
  assertEq(r.length, 5);
  assertEq(r[0].kind, 'real');
  assertEq(r[0].member.id, 'm2', 'self excluded');
  assertEq(r[1].kind, 'sim');
  assertEq(r[1].member.id, 'maya', 'spirits in data order');
  assertEq(r.filter(x => x.kind === 'sim').length, 4);
});
test('roster with no real circle is all spirits', () => {
  const r = Social.roster(S.defaultState(T('2026-07-02')), D);
  assertEq(r.map(x => x.member.id), D.MEMBERS.map(m => m.id));
  assert(r.every(x => x.kind === 'sim'), 'all sim');
});
test('syncSpiritSlots trims the sim roster to the spirit seats', () => {
  const st = socialState();
  st.circle.members.find(m => m.id === 'maya').lastCheerIdx = 3;
  st.circle.activeStruggle = { memberId: 'jen', since: 0, supported: false };
  Social.syncSpiritSlots(st, D);
  assertEq(st.circle.members.map(m => m.id), ['maya', 'priya', 'sofia', 'amara']);
  assertEq(st.circle.members[0].lastCheerIdx, 3, 'existing spirit state kept');
  assertEq(st.circle.activeStruggle, null, 'removed spirit’s struggle cleared');
  const solo = S.defaultState(T('2026-07-02'));
  Sim.initMembers(solo);
  Social.syncSpiritSlots(solo, D);
  assertEq(solo.circle.members.length, 5, 'solo keeps all five spirits');
});
test('event builders respect privacy and shape', () => {
  const pub = Social.buildStepEvent({ name: 'Run 5K', domain: 'fitness', private: false }, 2);
  assertEq(pub.type, 'step');
  assertEq(pub.payload, { goalTitle: 'Run 5K', domain: 'fitness', stage: 2 });
  assert(UUID_V4.test(pub.client_key), 'client_key is a v4 uuid');
  const priv = Social.buildStepEvent({ name: 'Secret', domain: 'money', private: true }, 1);
  assertEq(priv.payload.goalTitle, null);
  assertEq(priv.payload.domain, 'money', 'domain is a category id — safe for quiet goals');
  const bloom = Social.buildBloomEvent({ name: 'Run 5K', domain: 'fitness', private: false });
  assertEq(bloom.type, 'bloom');
  assertEq(bloom.payload, { goalTitle: 'Run 5K', domain: 'fitness' });
  const strug = Social.buildStruggleEvent('  ' + 'x'.repeat(300));
  assertEq(strug.payload.text.length, 280, 'struggle text capped');
  assertEq(strug.payload.text[0], 'x', 'struggle text trimmed');
  assertEq(Social.buildRecoverEvent(['m2']).payload, { supporterMemberIds: ['m2'] });
  assertEq(Social.buildCheerEvent('m2', 'cp3').payload, { toMemberId: 'm2', phraseId: 'cp3' });
  assertEq(Social.buildCheerEvent('m2', 'ai', 'You got this, friend').payload,
    { toMemberId: 'm2', phraseId: 'ai', text: 'You got this, friend' }, 'AI cheers carry text');
  assertEq(Social.buildLeaveEvent('Anu').payload, { name: 'Anu' });
  assert(Social.uuid() !== Social.uuid(), 'uuids differ');
});

// ---------- social: applyRemote ----------
function row(id, memberId, type, payload) {
  return { id, circle_id: 'c1', member_id: memberId, client_key: 'k' + id,
    type, payload, created_at: '2026-07-03T10:00:00Z' };
}

test('applyRemote classifies foreign steps and stays pure', () => {
  const st = socialState();
  const snapshot = JSON.stringify(st);
  const res = Social.applyRemote(st, D, [
    row(40, 'm2', 'step', { goalTitle: 'Run 5K', stage: 2 }),
    row(41, 'm2', 'step', { goalTitle: null, stage: 1 }),
  ], 'me');
  assertEq(res.feedItems.length, 2);
  const pub = res.feedItems[0], priv = res.feedItems[1];
  assertEq(pub.type, 'step');
  assertEq(pub.real, true);
  assertEq(pub.name, 'Rhea');
  assertEq(pub.cheered, false);
  assert(pub.text.includes('Run 5K'), 'title in text');
  assert(priv.text.includes('quiet goal'), 'private goals stay quiet');
  assertEq(res.challengeSteps, 2);
  assertEq(res.maxId, 41);
  assertEq(JSON.stringify(st), snapshot, 'applyRemote never mutates state');
});
test('applyRemote skips own events but advances maxId', () => {
  const res = Social.applyRemote(socialState(), D,
    [row(9, 'me', 'step', { goalTitle: 'x', stage: 1 })], 'me');
  assertEq(res.feedItems.length, 0);
  assertEq(res.challengeSteps, 0);
  assertEq(res.maxId, 9);
});
test('applyRemote surfaces cheers addressed to me', () => {
  const res = Social.applyRemote(socialState(), D, [
    row(50, 'm2', 'cheer', { toMemberId: 'me', phraseId: 'cp1' }),
  ], 'me');
  assertEq(res.cheersForMe.length, 1);
  assertEq(res.cheersForMe[0].fromMemberId, 'm2');
  assertEq(res.cheersForMe[0].name, 'Rhea');
  assertEq(res.cheersForMe[0].phrase, D.CHEER_PHRASES[0].text);
  assertEq(res.feedItems[0].type, 'cheer_player');
  assert(res.feedItems[0].text.includes('you'), 'addressed to you');
  const ai = Social.applyRemote(socialState(), D, [
    row(51, 'm2', 'cheer', { toMemberId: 'me', phraseId: 'ai', text: 'A custom warm line' }),
  ], 'me');
  assertEq(ai.cheersForMe[0].phrase, 'A custom warm line', 'payload text wins over phrase ids');
});
test('applyRemote accepts numeric createdAt timestamps (appdeploy wire)', () => {
  const numericRow = row(90, 'm2', 'step', { goalTitle: 'Run 5K', stage: 1 });
  numericRow.created_at = 1783089816823;   // ms number, not an ISO string
  const res = Social.applyRemote(socialState(), D, [numericRow], 'me');
  assertEq(res.feedItems[0].ts, 1783089816823, 'numeric timestamps pass through');
});
test('applyRemote keeps goal titles on step items for personal cheers', () => {
  const res = Social.applyRemote(socialState(), D, [
    row(80, 'm2', 'step', { goalTitle: 'Run 5K', stage: 1 }),
    row(81, 'm2', 'step', { goalTitle: null, stage: 1 }),
  ], 'me');
  assertEq(res.feedItems[0].goalTitle, 'Run 5K');
  assertEq(res.feedItems[1].goalTitle, null, 'quiet goals stay quiet');
});
test('applyRemote credits recoveries I helped with', () => {
  const res = Social.applyRemote(socialState(), D, [
    row(60, 'm2', 'recover', { supporterMemberIds: ['me'] }),
  ], 'me');
  assertEq(res.recoveredWithMyHelp, ['Rhea']);
  assertEq(res.feedItems[0].type, 'recovery');
  assert(res.feedItems[0].text.includes('your sunshine helped'), 'credit in text');
});
test('applyRemote flags membership changes and ignores unknown types', () => {
  const res = Social.applyRemote(socialState(), D, [
    row(70, 'm2', 'join', { name: 'Rhea' }),
    row(71, 'm2', 'confetti', {}),
  ], 'me');
  assertEq(res.memberChanged, true);
  assertEq(res.feedItems.length, 1);
  assertEq(res.feedItems[0].type, 'welcome');
  assertEq(res.maxId, 71, 'unknown types still advance the cursor');
  const strug = Social.applyRemote(socialState(), D,
    [row(72, 'm2', 'struggle', { text: 'stuck this week' })], 'me');
  assertEq(strug.feedItems[0].type, 'struggle');
  assert(strug.feedItems[0].text.includes('stuck this week'), 'struggle text shown');
});

// ---------- phase 2 content ----------
test('curated cheer phrases are plentiful and unique', () => {
  assert(D.CHEER_PHRASES.length >= 8, 'cheer phrases >=8');
  const ids = new Set();
  for (const p of D.CHEER_PHRASES) {
    assert(p.id && typeof p.text === 'string' && p.text.length > 0, 'phrase fields');
    ids.add(p.id);
  }
  assertEq(ids.size, D.CHEER_PHRASES.length, 'unique phrase ids');
});
test('real-circle copy block is complete', () => {
  const rc = D.REAL_CIRCLE;
  assert(rc && typeof rc === 'object', 'REAL_CIRCLE exists');
  for (const key of ['spiritTag', 'spiritHint', 'makeRealTitle', 'makeRealBody',
    'setupBody', 'boostPlaceholder', 'boostHint', 'quietGoalLabel', 'aiRest', 'aiQuiet']) {
    assert(typeof rc[key] === 'string' && rc[key].length > 0, `missing copy: ${key}`);
  }
  for (const key of ['not-found', 'full', 'offline']) {
    assert(typeof rc.joinErrors[key] === 'string' && rc.joinErrors[key].length > 0,
      `missing join error copy: ${key}`);
  }
  assertEq(rc.quietGoalLabel, 'a quiet goal 🌙');
});

// ---------- net: supabase client (unit) ----------
const Net = require('../js/net.js');

function makeFakeFetch(script) {
  const calls = [];
  const fn = (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET',
      headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const next = script.shift();
    if (!next) throw new Error('fake fetch script exhausted');
    if (next.reject) return Promise.reject(new TypeError('network down'));
    if (next.hang) return new Promise((resolve, reject) => {
      if (opts.signal) opts.signal.addEventListener('abort',
        () => reject(new DOMException('aborted', 'AbortError')));
    });
    return Promise.resolve(new Response(JSON.stringify(next.body === undefined ? {} : next.body), {
      status: next.status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
  fn.calls = calls;
  return fn;
}
const NET_SESSION = { access: 'tok-a', refresh: 'ref-a', userId: 'u1' };

test('signInAnon posts to /auth/v1/signup and stores the session', async () => {
  const sessions = [];
  const ff = makeFakeFetch([
    { body: { access_token: 'tok-1', refresh_token: 'ref-1', user: { id: 'u9' } } },
  ]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchFn: ff,
    onSession: (s) => sessions.push(s) });
  const r = await c.signInAnon();
  assertEq(r.ok, true);
  assertEq(r.session, { access: 'tok-1', refresh: 'ref-1', userId: 'u9' });
  assertEq(c.getSession(), r.session);
  assertEq(sessions.length, 1);
  assertEq(ff.calls[0].url, 'https://x.supabase.co/auth/v1/signup');
  assertEq(ff.calls[0].method, 'POST');
  assertEq(ff.calls[0].headers.apikey, 'anon');
});
test('createCircle sends snake_case rpc params, returns camelCase', async () => {
  const ff = makeFakeFetch([
    { body: { circle: { id: 'c1', name: 'Us', invite_code: 'ABC234' }, member_id: 'me' } },
  ]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff, session: { ...NET_SESSION } });
  const r = await c.createCircle({ circleName: 'Us', memberName: 'Anu', avatarId: '0', accentId: '1' });
  assertEq(r.ok, true);
  assertEq(r.circle, { id: 'c1', name: 'Us', inviteCode: 'ABC234' });
  assertEq(r.memberId, 'me');
  assertEq(ff.calls[0].url, 'https://x.supabase.co/rest/v1/rpc/create_circle');
  assertEq(ff.calls[0].headers.Authorization, 'Bearer tok-a');
  assertEq(ff.calls[0].body, { circle_name: 'Us', member_name: 'Anu', avatar: '0', accent: '1' });
});
test('pushEvents stamps rows and asks for duplicate tolerance', async () => {
  const ff = makeFakeFetch([{ status: 201, body: [] }]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff, session: { ...NET_SESSION } });
  const r = await c.pushEvents('c1', 'me', [{ client_key: 'k1', type: 'step', payload: {} }]);
  assertEq(r.ok, true);
  assertEq(r.pushed, 1);
  assert(ff.calls[0].url.endsWith('/rest/v1/events?on_conflict=circle_id,client_key'),
    'on_conflict param present');
  assertEq(ff.calls[0].headers.Prefer, 'resolution=ignore-duplicates,return=minimal');
  assertEq(ff.calls[0].body[0].circle_id, 'c1');
  assertEq(ff.calls[0].body[0].member_id, 'me');
});
test('pullEvents advances the cursor only when rows arrive', async () => {
  const ff = makeFakeFetch([
    { body: [{ id: 41 }, { id: 42 }] },
    { body: [] },
  ]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff, session: { ...NET_SESSION } });
  const r1 = await c.pullEvents('c1', 40);
  assertEq(r1.cursor, 42);
  assertEq(r1.events.length, 2);
  const r2 = await c.pullEvents('c1', 42);
  assertEq(r2.cursor, 42, 'cursor unchanged on empty pull');
  assert(ff.calls[0].url.includes('circle_id=eq.c1') && ff.calls[0].url.includes('id=gt.40')
    && ff.calls[0].url.includes('order=id.asc'), 'pull query shape');
});
test('a 401 triggers one refresh and one retry', async () => {
  const sessions = [];
  const ff = makeFakeFetch([
    { status: 401, body: { message: 'jwt expired' } },
    { body: { access_token: 'tok-2', refresh_token: 'ref-2', user: { id: 'u1' } } },
    { body: [] },
  ]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchFn: ff,
    session: { ...NET_SESSION }, onSession: (s) => sessions.push(s) });
  const r = await c.pullEvents('c1', 0);
  assertEq(r.ok, true);
  assertEq(ff.calls.length, 3);
  assert(ff.calls[1].url.includes('grant_type=refresh_token'), 'refresh call made');
  assertEq(ff.calls[1].body, { refresh_token: 'ref-a' });
  assertEq(ff.calls[2].headers.Authorization, 'Bearer tok-2', 'retry uses new token');
  assertEq(sessions[0].refresh, 'ref-2', 'rotated refresh token stored');
});
test('rpc errors map to friendly codes', async () => {
  const ff = makeFakeFetch([{ status: 400, body: { message: 'full' } }]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff, session: { ...NET_SESSION } });
  const r = await c.joinCircle({ code: 'ABC234', memberName: 'Anu', avatarId: '0', accentId: '0' });
  assertEq(r.ok, false);
  assertEq(r.error, 'full');
});
test('network failures and timeouts resolve offline, never throw', async () => {
  const ff = makeFakeFetch([{ reject: true }]);
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff, session: { ...NET_SESSION } });
  const r = await c.fetchMembers('c1');
  assertEq(r.ok, false);
  assertEq(r.offline, true);
  const ff2 = makeFakeFetch([{ hang: true }]);
  const c2 = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon',
    fetchFn: ff2, session: { ...NET_SESSION }, timeoutMs: 50 });
  const r2 = await c2.pullEvents('c1', 0);
  assertEq(r2.ok, false);
  assertEq(r2.offline, true);
});

// ---------- sync orchestration ----------
const Sync = require('../js/sync.js');

function makeFakeClient(overrides) {
  const calls = [];
  const base = {
    calls,
    pushEvents: async (cid, mid, evs) => {
      calls.push(['push', cid, mid, evs.map(e => e.client_key)]);
      return { ok: true, pushed: evs.length };
    },
    pullEvents: async (cid, cursor) => {
      calls.push(['pull', cid, cursor]);
      return { ok: true, events: [], cursor };
    },
    fetchMembers: async (cid) => {
      calls.push(['members', cid]);
      return { ok: true, members: [] };
    },
  };
  return Object.assign(base, overrides || {});
}
function syncCtx(st) {
  let saves = 0;
  return { get state() { return st; }, save() { saves++; }, saveCount: () => saves };
}

test('sync queues to the outbox and flushes on demand', async () => {
  const st = socialState();
  const ctx = syncCtx(st);
  const client = makeFakeClient();
  const sync = Sync.makeSync({ ctx, client, logic: L, social: Social, data: D });
  sync.queue(Social.buildStepEvent({ name: 'Run', private: false }, 1));
  sync.queue(Social.buildCheerEvent('m2', 'cp1'));
  assertEq(st.net.outbox.length, 2);
  assert(ctx.saveCount() >= 2, 'saved on queue');
  await sync.syncNow();
  assertEq(st.net.outbox.length, 0, 'outbox flushed');
  const push = client.calls.find(c => c[0] === 'push');
  assertEq(push[3].length, 2, 'both events pushed');
  assertEq(push[1], 'c1');
  assertEq(push[2], 'me');
  sync.stop();
});
test('events queued mid-flush survive to the next flush', async () => {
  const st = socialState();
  let midFlight = null;
  const client = makeFakeClient({
    pushEvents: async () => {
      st.net.outbox.push(midFlight); // lands while the request is in the air
      return { ok: true, pushed: 2 };
    },
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D });
  sync.queue(Social.buildStepEvent({ name: 'A', private: false }, 1));
  sync.queue(Social.buildStepEvent({ name: 'B', private: false }, 1));
  midFlight = Social.buildStepEvent({ name: 'C', private: false }, 1);
  await sync.syncNow();
  assertEq(st.net.outbox.length, 1, 'only the mid-flight event remains');
  assertEq(st.net.outbox[0].client_key, midFlight.client_key);
  sync.stop();
});
test('sync applies pulled events to feed, challenge, and struggle supporters', async () => {
  const st = socialState();
  L.rolloverChallengeIfNeeded(st, T('2026-07-02'));
  st.net.playerStruggle = { eventKey: 'k', postedAt: 1, supporters: [] };
  const updates = [];
  const client = makeFakeClient({
    pullEvents: async () => ({ ok: true, cursor: 42, events: [
      row(41, 'm2', 'step', { goalTitle: 'Run 5K', stage: 1 }),
      row(42, 'm2', 'cheer', { toMemberId: 'me', phraseId: 'cp2' }),
    ] }),
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D,
    now: () => T('2026-07-02'), onUpdate: (r) => updates.push(r) });
  const before = st.circle.feed.length;
  await sync.syncNow();
  assertEq(st.circle.feed.length, before + 2);
  assertEq(st.circle.challenge.progress, 1, 'foreign step waters the challenge');
  assertEq(st.net.playerStruggle.supporters, ['m2']);
  assertEq(st.net.cursor, 42);
  assertEq(updates.length, 1);
  assertEq(updates[0].challengeSteps, 1);
  assertEq(sync.status(), 'synced');
  sync.stop();
});
test('history replayed on first pull does not inflate this week’s challenge', async () => {
  const st = socialState();
  L.rolloverChallengeIfNeeded(st, T('2026-07-02'));
  const oldRow = row(5, 'm2', 'step', { goalTitle: 'Old', stage: 1 });
  oldRow.created_at = '2026-06-10T10:00:00Z'; // weeks in the past
  const client = makeFakeClient({
    pullEvents: async () => ({ ok: true, cursor: 5, events: [oldRow] }),
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D,
    now: () => T('2026-07-02') });
  await sync.syncNow();
  assertEq(st.circle.challenge.progress, 0, 'old steps stay in the past');
  assert(st.circle.feed.length > 0, 'but they do appear in the feed');
  sync.stop();
});
test('membership events refresh the cache and spirit slots', async () => {
  const st = socialState();
  const grown = [
    { id: 'me', name: 'Anu', avatarId: '0', accentId: '0', joinedAt: '2026-07-01T00:00:00Z' },
    { id: 'm2', name: 'Rhea', avatarId: '1', accentId: '1', joinedAt: '2026-07-02T00:00:00Z' },
    { id: 'm3', name: 'Tara', avatarId: '2', accentId: '2', joinedAt: '2026-07-03T00:00:00Z' },
  ];
  const client = makeFakeClient({
    pullEvents: async () => ({ ok: true, cursor: 51, events: [
      row(50, 'm3', 'join', { name: 'Tara' }),
      row(51, 'm3', 'step', { goalTitle: 'First step', stage: 1 }),
    ] }),
    fetchMembers: async () => ({ ok: true, members: grown }),
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D });
  await sync.syncNow();
  assertEq(st.net.members.length, 3);
  assertEq(st.circle.members.map(m => m.id), ['maya', 'priya', 'sofia'],
    'spirits trimmed to the free seats');
  const stepItem = st.circle.feed.find(e => e.real && e.type === 'step');
  assert(stepItem.text.includes('Tara'),
    'a step in the same batch as the join is credited by name, not “A friend”');
  sync.stop();
});
test('an offline client keeps the outbox and reports status', async () => {
  const st = socialState();
  const client = makeFakeClient({
    pushEvents: async () => ({ ok: false, error: 'offline', offline: true }),
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D });
  sync.queue(Social.buildStepEvent({ name: 'A', private: false }, 1));
  const r = await sync.syncNow();
  assertEq(r.ok, false);
  assertEq(st.net.outbox.length, 1, 'outbox intact for the next cycle');
  assertEq(sync.status(), 'offline');
  sync.stop();
});
test('the shared feed stays capped at 80', async () => {
  const st = socialState();
  for (let i = 0; i < 79; i++) {
    st.circle.feed.push({ id: 'e' + i, ts: i, type: 'step', text: 'x', cheered: false, memberId: 'maya' });
  }
  const client = makeFakeClient({
    pullEvents: async () => ({ ok: true, cursor: 3, events: [
      row(1, 'm2', 'step', { goalTitle: 'a', stage: 1 }),
      row(2, 'm2', 'step', { goalTitle: 'b', stage: 1 }),
      row(3, 'm2', 'step', { goalTitle: 'c', stage: 1 }),
    ] }),
  });
  const sync = Sync.makeSync({ ctx: syncCtx(st), client, logic: L, social: Social, data: D });
  await sync.syncNow();
  assertEq(st.circle.feed.length, 80);
  sync.stop();
});

// ---------- netad: appdeploy adapter ----------
const NetAd = require('../js/netad.js');

function makeFakePlatform(script) {
  const calls = [];
  const run = (method, url, body) => {
    calls.push({ method, url, body });
    const next = script.shift();
    if (!next) throw new Error('fake platform script exhausted');
    if (next.reject) return Promise.reject(new Error('network down'));
    if (next.status && next.status >= 400) {
      const err = new Error('http ' + next.status);
      err.statusCode = next.status;
      return Promise.reject(err);
    }
    return Promise.resolve({ data: next.data === undefined ? {} : next.data });
  };
  return {
    calls,
    api: {
      get: (u, b) => run('GET', u, b),
      post: (u, b) => run('POST', u, b),
      put: (u, b) => run('PUT', u, b),
      delete: (u, b) => run('DELETE', u, b),
    },
    invitesClient: {
      buildJoinUrl: (code) => 'https://app.example/?appdeploy_invite=' + code,
      getPendingCode: () => null,
      clearPendingCode: () => {},
    },
  };
}
function adClient(platform, opts) {
  return NetAd.makeClient(Object.assign({
    platform,
    session: { platform: 'appdeploy', memberKey: 'mk-1' },
    circleRef: () => ({ id: 'c1', memberId: 'm1' }),
  }, opts || {}));
}

test('adapter creates a circle and stores the memberKey session', async () => {
  const sessions = [];
  const fp = makeFakePlatform([{ data: { circleId: 'c1', circleName: 'Us', inviteCode: 'AB12CD',
    memberId: 'm1', memberKey: 'mk-9' } }]);
  const c = NetAd.makeClient({ platform: fp, session: null,
    circleRef: () => null, onSession: (s) => sessions.push(s) });
  const r = await c.createCircle({ circleName: 'Us', memberName: 'Anu', avatarId: '0', accentId: '0' });
  assertEq(r.ok, true);
  assertEq(r.circle, { id: 'c1', name: 'Us', inviteCode: 'AB12CD' });
  assertEq(r.memberId, 'm1');
  assertEq(r.memberKey, 'mk-9');
  assertEq(c.getSession(), { platform: 'appdeploy', memberKey: 'mk-9' });
  assertEq(sessions.length, 1);
  assertEq(fp.calls[0].method, 'POST');
  assertEq(fp.calls[0].url, '/api/circles');
  assertEq(fp.calls[0].body, { name: 'Us', member: { name: 'Anu', avatarId: '0', accentId: '0' } });
});
test('adapter joins by code and normalizes members', async () => {
  const fp = makeFakePlatform([{ data: { circleId: 'c1', circleName: 'Us', inviteCode: 'AB12CD',
    memberId: 'm2', memberKey: 'mk-2',
    members: [{ id: 'm1', name: 'Anu', avatarId: '0', accentId: '0', joinedAt: 1000 }] } }]);
  const c = adClient(fp, { session: null });
  const r = await c.joinCircle({ code: 'ab12cd', memberName: 'Rhea', avatarId: '1', accentId: '1' });
  assertEq(r.ok, true);
  assertEq(fp.calls[0].url, '/api/circles/join');
  assertEq(fp.calls[0].body.code, 'AB12CD', 'code uppercased');
  assertEq(r.members[0].name, 'Anu');
  assertEq(r.memberKey, 'mk-2');
});
test('adapter pushes events with clientKey rename and identity', async () => {
  const fp = makeFakePlatform([{ data: { pushed: 1 } }]);
  const c = adClient(fp);
  const r = await c.pushEvents('c1', 'm1', [{ client_key: 'k1', type: 'step', payload: { stage: 1 } }]);
  assertEq(r.ok, true);
  assertEq(r.pushed, 1);
  assertEq(fp.calls[0].url, '/api/circles/c1/events');
  assertEq(fp.calls[0].body, { memberId: 'm1', memberKey: 'mk-1',
    events: [{ clientKey: 'k1', type: 'step', payload: { stage: 1 } }] });
});
test('adapter pulls and normalizes to the phase-2 wire shape', async () => {
  const fp = makeFakePlatform([{ data: { events: [
    { id: 'e9', memberId: 'm2', clientKey: 'k9', type: 'step',
      payload: { goalTitle: 'Run' }, createdAt: 2000 },
  ] } }]);
  const c = adClient(fp);
  const r = await c.pullEvents('c1', 1000);
  assertEq(r.ok, true);
  assertEq(r.events, [{ id: 'e9', member_id: 'm2', type: 'step',
    payload: { goalTitle: 'Run' }, created_at: 2000 }]);
  assertEq(r.cursor, 2000);
  assert(fp.calls[0].url.includes('since=1000'), 'cursor in query');
  assert(fp.calls[0].url.includes('memberKey=mk-1'), 'identity in query');
  const fp2 = makeFakePlatform([{ data: { events: [] } }]);
  const r2 = await adClient(fp2).pullEvents('c1', 1000);
  assertEq(r2.cursor, 1000, 'cursor unchanged on empty pull');
});
test('adapter builds invite links through the platform', () => {
  const fp = makeFakePlatform([]);
  const c = adClient(fp);
  assertEq(c.kind, 'appdeploy');
  assertEq(c.buildInviteLink('AB12CD'), 'https://app.example/?appdeploy_invite=AB12CD');
});
test('adapter ai surface maps caps and outages to warm errors', async () => {
  const fp = makeFakePlatform([{ data: { steps: ['a', 'b', 'c', 'd', 'e', 'f'] } }]);
  const c = adClient(fp);
  const ok = await c.ai.steps({ goalName: 'Run 5K', domain: 'fitness' });
  assertEq(ok.ok, true);
  assertEq(ok.steps.length, 6);
  assertEq(fp.calls[0].url, '/api/ai/steps');
  assertEq(fp.calls[0].body, { memberId: 'm1', memberKey: 'mk-1', circleId: 'c1',
    goalName: 'Run 5K', domain: 'fitness' });
  const capped = await adClient(makeFakePlatform([{ status: 429 }]))
    .ai.steps({ goalName: 'x', domain: 'fitness' });
  assertEq(capped.ok, false);
  assertEq(capped.error, 'ai-rest');
  const down = await adClient(makeFakePlatform([{ reject: true }]))
    .ai.cheer({ toName: 'Rhea', goalTitle: 'Run', kind: 'step' });
  assertEq(down.ok, false);
  assertEq(down.offline, true);
});
test('supabase client gained kind, null ai, and hash invite links', () => {
  const c = Net.makeClient({ url: 'https://x.supabase.co', anonKey: 'anon' });
  assertEq(c.kind, 'supabase');
  assertEq(c.ai, null);
  assert(c.buildInviteLink('ABC234').endsWith('#join=ABC234'), 'mirror keeps #join links');
});

// ---------- net + fake supabase (integration over real HTTP) ----------
const FakeSupabase = require('../tools/fake-supabase.js');

test('two clients share a circle end to end', async () => {
  const fake = FakeSupabase.createFake();
  const port = await fake.listen(0);
  const base = 'http://127.0.0.1:' + port;
  const mk = () => Net.makeClient({ url: base, anonKey: 'anon', fetchFn: fetch });
  try {
    const A = mk(), B = mk();
    assertEq((await A.signInAnon()).ok, true);
    assertEq((await B.signInAnon()).ok, true);

    const made = await A.createCircle({ circleName: 'Us', memberName: 'Anu', avatarId: '0', accentId: '0' });
    assertEq(made.ok, true);
    assert(/^[A-HJ-KM-NP-Z2-9]{6}$/.test(made.circle.inviteCode), 'code uses the unambiguous alphabet');

    const joined = await B.joinCircle({ code: made.circle.inviteCode, memberName: 'Rhea', avatarId: '1', accentId: '1' });
    assertEq(joined.ok, true);
    assertEq(joined.members.length, 2);
    const again = await B.joinCircle({ code: made.circle.inviteCode, memberName: 'Rhea', avatarId: '1', accentId: '1' });
    assertEq(again.members.length, 2, 'join is idempotent');
    assertEq((await B.joinCircle({ code: 'XXXXXX', memberName: 'R', avatarId: '1', accentId: '1' })).error,
      'not-found');

    const cid = made.circle.id;
    const stepEv = { client_key: '11111111-1111-4111-8111-111111111111',
      type: 'step', payload: { goalTitle: 'Run', stage: 1 } };
    assertEq((await B.pushEvents(cid, joined.memberId, [stepEv])).ok, true);
    assertEq((await B.pushEvents(cid, joined.memberId, [stepEv])).ok, true, 'duplicate push tolerated');

    const pull = await A.pullEvents(cid, 0);
    assertEq(pull.ok, true);
    assertEq(pull.events.length, 3, '2 joins + 1 step, deduped');
    assert(pull.events.every((e, i) => i === 0 || e.id > pull.events[i - 1].id), 'ascending ids');
    assertEq((await A.pullEvents(cid, pull.cursor)).events.length, 0, 'cursor is complete');

    const C = mk();
    await C.signInAnon();
    const spy = await C.pullEvents(cid, 0);
    assertEq(spy.ok, true);
    assertEq(spy.events.length, 0, 'RLS-like filtering: non-members read nothing');
    const sneak = await C.pushEvents(cid, joined.memberId,
      [{ client_key: '22222222-2222-4222-8222-222222222222', type: 'step', payload: {} }]);
    assertEq(sneak.ok, false, 'non-members cannot write');

    const left = await B.leaveCircle(cid, joined.memberId,
      { client_key: '33333333-3333-4333-8333-333333333333', type: 'leave', payload: { name: 'Rhea' } });
    assertEq(left.ok, true);
    assertEq((await A.fetchMembers(cid)).members.length, 1, 'B removed from members');
    assert((await A.pullEvents(cid, pull.cursor)).events.some(e => e.type === 'leave'),
      'leave event visible');

    for (let i = 0; i < 4; i++) {
      const X = mk();
      await X.signInAnon();
      assertEq((await X.joinCircle({ code: made.circle.inviteCode, memberName: 'M' + i,
        avatarId: '0', accentId: '0' })).ok, true, 'join ' + i);
    }
    const Y = mk();
    await Y.signInAnon();
    assertEq((await Y.joinCircle({ code: made.circle.inviteCode, memberName: 'Zoe',
      avatarId: '0', accentId: '0' })).error, 'full', 'five real members max');
  } finally {
    fake.close();
  }
});
test('the fake refreshes rotated tokens like gotrue', async () => {
  const fake = FakeSupabase.createFake();
  const port = await fake.listen(0);
  try {
    const A = Net.makeClient({ url: 'http://127.0.0.1:' + port, anonKey: 'anon', fetchFn: fetch });
    await A.signInAnon();
    fake.state.tokens.delete(A.getSession().access); // simulate expiry
    const made = await A.createCircle({ circleName: 'Us', memberName: 'Anu', avatarId: '0', accentId: '0' });
    assertEq(made.ok, true, '401 → refresh → retry succeeded');
  } finally {
    fake.close();
  }
});

// ---------- circle simulation ----------
function simState(lastVisitTs) {
  const st = S.defaultState(lastVisitTs);
  st.player.name = 'Ana';
  Sim.initMembers(st);
  st.lastVisit = lastVisitTs;
  return st;
}
const memberIds = new Set(D.MEMBERS.map(m => m.id));

test('initMembers seeds five lean members', () => {
  const st = simState(T('2026-07-01'));
  assertEq(st.circle.members.length, 5);
  for (const m of st.circle.members) assert(memberIds.has(m.id), 'known id');
});
test('catchUp generates bounded, in-window, believable activity', () => {
  const st = simState(T('2026-06-29'));
  const now = T('2026-07-02');
  const ev = Sim.catchUp(st, now, Sim.makeRng(42));
  assert(ev.length > 0, 'some activity over 3 days');
  assert(ev.length <= 30, 'capped at 30');
  for (const e of ev) {
    assert(e.ts >= st.lastVisit && e.ts <= now, 'timestamp in window');
    assert(memberIds.has(e.memberId), 'valid member');
    assert(typeof e.text === 'string' && e.text.length > 0, 'has text');
  }
  assertEq(st.circle.feed.length, ev.length, 'events landed in feed');
});
test('catchUp is deterministic for the same seed', () => {
  const a = simState(T('2026-06-29')), b = simState(T('2026-06-29'));
  const evA = Sim.catchUp(a, T('2026-07-02'), Sim.makeRng(7));
  const evB = Sim.catchUp(b, T('2026-07-02'), Sim.makeRng(7));
  assertEq(evA, evB);
});
test('a long absence produces one digest per member, not a flood', () => {
  const st = simState(T('2026-06-01'));
  const ev = Sim.catchUp(st, T('2026-07-02'), Sim.makeRng(1));
  assertEq(ev.length, 5);
  for (const e of ev) assertEq(e.type, 'digest');
});
test('a quick revisit produces nothing', () => {
  const now = T('2026-07-02');
  const st = simState(now - 2 * 60 * 1000);
  assertEq(Sim.catchUp(st, now, Sim.makeRng(1)).length, 0);
});
test('reactions bring 1-2 personal cheers from distinct members', () => {
  const st = simState(T('2026-07-02'));
  const ev = Sim.reactions(st, Sim.makeRng(5), T('2026-07-02'));
  assert(ev.length >= 1 && ev.length <= 2, 'one or two cheers');
  const seen = new Set();
  for (const e of ev) {
    assertEq(e.type, 'cheer_player');
    assert(!seen.has(e.memberId), 'distinct members'); seen.add(e.memberId);
    assert(e.text.length > 0, 'cheer text');
  }
});
test('only one struggle can be active at a time', () => {
  const st = simState(T('2026-07-02'));
  const always = () => 0; // forces the struggle roll
  const ev1 = Sim.maybeStruggle(st, always, T('2026-07-02'));
  assertEq(ev1.length, 1);
  assertEq(ev1[0].type, 'struggle');
  const ev2 = Sim.maybeStruggle(st, always, T('2026-07-02'));
  assertEq(ev2.length, 0, 'no second concurrent struggle');
  const st2 = simState(T('2026-07-02'));
  const never = () => 0.99;
  assertEq(Sim.maybeStruggle(st2, never, T('2026-07-02')).length, 0, 'roll can fail');
});
test('supporting a struggling member sparks a recovery crediting the player', () => {
  const st = simState(T('2026-07-02'));
  Sim.maybeStruggle(st, () => 0, T('2026-07-02'));
  const strugglerId = st.circle.activeStruggle.memberId;
  Sim.supportMember(st, strugglerId, T('2026-07-02') + 60000);
  assertEq(st.sunshineSent, 1, 'sunshine counted');
  assertEq(st.circle.activeStruggle, null, 'struggle resolved');
  const recovery = st.circle.feed.find(e => e.type === 'recovery');
  assert(recovery, 'recovery posted');
  assert(recovery.text.includes('Ana'), 'player named in recovery');
  const struggle = st.circle.feed.find(e => e.type === 'struggle');
  assertEq(struggle.cheered, true, 'struggle event marked cheered');
});

// ---------- voice: picking a warm female voice ----------
const V = (name, lang) => ({ name, lang });

test('pickVoice prefers a female Indian-English voice above all', () => {
  const v = Whisper.pickVoice([
    V('Microsoft Ravi - English (India)', 'en-IN'),
    V('Microsoft David - English (United States)', 'en-US'),
    V('Microsoft Heera - English (India)', 'en-IN'),
  ]);
  assertEq(v.name, 'Microsoft Heera - English (India)');
});
test('pickVoice knows Veena and Neerja are female Indian-English voices', () => {
  assertEq(Whisper.pickVoice([V('Veena', 'en-IN'), V('Google US English', 'en-US')]).name, 'Veena');
  assertEq(Whisper.pickVoice([
    V('Microsoft Neerja Online (Natural) - English (India)', 'en-IN'),
    V('Microsoft Aria Online (Natural) - English (United States)', 'en-US'),
  ]).name, 'Microsoft Neerja Online (Natural) - English (India)');
});
test('pickVoice falls back to any female English voice before a male Indian one', () => {
  const v = Whisper.pickVoice([
    V('Google UK English Female', 'en-GB'),
    V('Microsoft Ravi - English (India)', 'en-IN'),
  ]);
  assertEq(v.name, 'Google UK English Female');
});
test('pickVoice takes Indian-English over an unknown-gender default', () => {
  const v = Whisper.pickVoice([
    V('Microsoft David - English (United States)', 'en-US'),
    V('Microsoft Ravi - English (India)', 'en-IN'),
  ]);
  assertEq(v.name, 'Microsoft Ravi - English (India)');
});
test('pickVoice returns null when nothing matches', () => {
  assertEq(Whisper.pickVoice([]), null);
  assertEq(Whisper.pickVoice([V('Microsoft David - English (United States)', 'en-US')]), null);
});
test('pickVoice honors an explicit preferred voice name first', () => {
  const v = Whisper.pickVoice([
    V('Google UK English Female', 'en-GB'),
    V('Microsoft Heera - English (India)', 'en-IN'),
  ], 'Google UK English Female');
  assertEq(v.name, 'Google UK English Female');
});

// ---------- voice: dictation error handling ----------
function FakeRec() {
  FakeRec.last = this;
  this.started = 0; this.stopped = 0;
  this.start = () => { this.started += 1; if (this.onstart) this.onstart(); };
  this.stop = () => { this.stopped += 1; };
}

test('dictation reports errors and always ends', () => {
  Whisper._setRecognitionCtor(FakeRec);
  const got = { errors: [], ends: 0, texts: [] };
  const s = Whisper.makeDictation({
    onText: (t) => got.texts.push(t),
    onError: (e) => got.errors.push(e),
    onEnd: () => got.ends += 1,
  });
  s.start();
  FakeRec.last.onerror({ error: 'not-allowed' });
  FakeRec.last.onend();
  Whisper._setRecognitionCtor(null);
  assertEq(got.errors, ['not-allowed']);
  assertEq(got.ends, 1, 'onEnd exactly once');
  assertEq(got.texts, []);
});
test('dictation delivers transcribed text then ends cleanly', () => {
  Whisper._setRecognitionCtor(FakeRec);
  const got = { errors: [], ends: 0, texts: [] };
  const s = Whisper.makeDictation({
    onText: (t) => got.texts.push(t),
    onError: (e) => got.errors.push(e),
    onEnd: () => got.ends += 1,
  });
  s.start();
  FakeRec.last.onresult({ results: [[{ transcript: 'hello grove' }]] });
  FakeRec.last.onend();
  Whisper._setRecognitionCtor(null);
  assertEq(got.texts, ['hello grove']);
  assertEq(got.errors, []);
  assertEq(got.ends, 1);
});
test('a started-but-silent session trips the result watchdog as no-speech', async () => {
  Whisper._setRecognitionCtor(FakeRec); // fires onstart, then nothing
  const got = { errors: [], ends: 0 };
  const s = Whisper.makeDictation({
    onError: (e) => got.errors.push(e),
    onEnd: () => got.ends += 1,
  }, { watchdogMs: 20, resultMs: 45 });
  s.start();
  await new Promise(r => setTimeout(r, 30));
  assertEq(got.errors, [], 'onstart cleared the pre-start watchdog');
  await new Promise(r => setTimeout(r, 60));
  Whisper._setRecognitionCtor(null);
  assertEq(got.errors, ['no-speech'], 'silence after start becomes no-speech');
  assertEq(got.ends, 1, 'session ended exactly once');
  assert(FakeRec.last.stopped >= 1, 'recognition stop attempted');
});
test('the watchdog stays quiet when a result arrives in time', async () => {
  Whisper._setRecognitionCtor(FakeRec);
  const got = { errors: [], ends: 0, texts: [] };
  const s = Whisper.makeDictation({
    onText: (t) => got.texts.push(t),
    onError: (e) => got.errors.push(e),
    onEnd: () => got.ends += 1,
  }, { watchdogMs: 25 });
  s.start();
  FakeRec.last.onresult({ results: [[{ transcript: 'quick' }]] });
  FakeRec.last.onend();
  await new Promise(r => setTimeout(r, 70));
  Whisper._setRecognitionCtor(null);
  assertEq(got.texts, ['quick']);
  assertEq(got.errors, [], 'no watchdog false alarm');
  assertEq(got.ends, 1);
});

// ---------- state v4: voice preference ----------
test('state v4 carries a voice preference and migrates older saves', () => {
  const st = S.defaultState(T('2026-07-04'));
  assertEq(st.version, 5);
  assert(st.voice && 'name' in st.voice, 'voice pref present');
  assertEq(st.voice.name, null);
  const old = S.defaultState(T('2026-07-04'));
  old.version = 3;
  delete old.voice;
  const m = S.migrate(old);
  assertEq(m.version, 5);
  assertEq(m.voice.name, null);
});

// ---------- voice: audio mime picking + staged watchdogs ----------
test('pickAudioMime prefers opus-webm and degrades gracefully', () => {
  const only = (ok) => (t) => ok.includes(t);
  assertEq(Whisper.pickAudioMime(only(['audio/webm;codecs=opus', 'audio/webm'])), 'audio/webm;codecs=opus');
  assertEq(Whisper.pickAudioMime(only(['audio/webm'])), 'audio/webm');
  assertEq(Whisper.pickAudioMime(only(['audio/mp4'])), 'audio/mp4');
  assertEq(Whisper.pickAudioMime(only([])), null);
});

function FakeDeadRec() { // the Opera case: constructor exists, zero events ever
  FakeDeadRec.last = this;
  this.started = 0; this.stopped = 0;
  this.start = () => { this.started += 1; };
  this.stop = () => { this.stopped += 1; };
}

test('a never-starting recognition trips the fast pre-start watchdog', async () => {
  Whisper._setRecognitionCtor(FakeDeadRec);
  const got = { errors: [], ends: 0 };
  const s = Whisper.makeDictation({
    onError: (e) => got.errors.push(e),
    onEnd: () => got.ends += 1,
  }, { watchdogMs: 20, resultMs: 200 });
  s.start();
  await new Promise(r => setTimeout(r, 60));
  Whisper._setRecognitionCtor(null);
  assertEq(got.errors, ['no-response'], 'dead API detected before resultMs');
  assertEq(got.ends, 1);
});

// ---------- phase 4: state v5, claim triggers, backups ----------
test('state v5 carries account, prompt, and quiet fields', () => {
  const st = S.defaultState(T('2026-07-04'));
  assertEq(st.version, 5);
  assertEq(st.account.userId, null);
  assertEq(st.account.backupPrivateGoals, false);
  assertEq(st.accountPrompt, { shown: {}, claimed: false });
  assertEq(st.quiet, false);
  const old = S.defaultState(T('2026-07-04'));
  old.version = 4;
  delete old.account; delete old.accountPrompt; delete old.quiet;
  const m = S.migrate(old);
  assertEq(m.version, 5);
  assertEq(m.account.userId, null);
  assertEq(m.accountPrompt.claimed, false);
  assertEq(m.quiet, false);
});

test('claimTrigger fires per trigger, in priority order, and respects suppression', () => {
  const st = makeState(makeGoal(3, 0));
  st.account = { userId: null };
  st.accountPrompt = { shown: {}, claimed: false };
  st.net = { circle: null };
  assertEq(L.claimTrigger(st), null, 'nothing earned yet');
  st.streak.count = 7;
  assertEq(L.claimTrigger(st), 'streak-7');
  st.goals[0].bloomedAt = 1;
  assertEq(L.claimTrigger(st), 'first-bloom', 'bloom outranks streak');
  st.net.circle = { id: 'c1' };
  assertEq(L.claimTrigger(st), 'circle', 'circle outranks all');
  st.accountPrompt.shown = { circle: true };
  assertEq(L.claimTrigger(st), 'first-bloom', 'shown triggers are skipped');
  st.accountPrompt.shown = { circle: true, 'first-bloom': true, 'streak-7': true };
  assertEq(L.claimTrigger(st), null, 'all three dismissed, silence');
  st.accountPrompt.shown = {};
  st.account.userId = 'u1';
  assertEq(L.claimTrigger(st), null, 'linked account never prompts');
  st.account.userId = null;
  st.accountPrompt.claimed = true;
  assertEq(L.claimTrigger(st), null, 'claimed suppresses forever');
});

test('backupBlob strips private goals and their journal unless included', () => {
  const st = S.defaultState(T('2026-07-04'));
  st.player.name = 'Ana';
  st.goals.push({ id: 'g1', name: 'Public', domain: 'career', emoji: '✨', private: false,
    steps: [], createdAt: 1, bloomedAt: null, reflection: null });
  st.goals.push({ id: 'g2', name: 'Secret', domain: 'money', emoji: '🌙', private: true,
    steps: [], createdAt: 1, bloomedAt: null, reflection: null });
  st.journal.push({ day: '2026-07-01', text: 'about secret', goalId: 'g2' });
  st.journal.push({ day: '2026-07-02', text: 'about public', goalId: 'g1' });
  const stripped = JSON.parse(S.backupBlob(st, false));
  assertEq(stripped.goals.length, 1);
  assertEq(stripped.goals[0].name, 'Public');
  assertEq(stripped.journal.length, 1);
  assertEq(stripped.journal[0].goalId, 'g1');
  const full = JSON.parse(S.backupBlob(st, true));
  assertEq(full.goals.length, 2);
  assertEq(full.journal.length, 2);
  const back = S.importJson(S.backupBlob(st, false));
  assertEq(back.player.name, 'Ana', 'backups round-trip through importJson');
  assertEq(st.goals.length, 2, 'original state untouched');
});

// ---------- summary ----------
(async () => {
  // Pessimistic until the summary runs: if a hung test drains the event loop
  // mid-suite, the process still exits non-zero instead of silently passing.
  process.exitCode = 1;
  // Watchdog: a hung async test must fail loudly, not drain the event loop
  // into a silent exit-0. unref'd so a clean run exits naturally (forcing
  // process.exit() races libuv handle teardown on Windows).
  const watchdog = setTimeout(() => {
    console.log('TIMEOUT: test suite hung — a test never settled');
    process.exit(1);
  }, 120000);
  watchdog.unref();
  for (const t of queue) {
    try { await t.fn(); passed++; }
    catch (e) { failed++; failures.push({ name: t.name, message: e.message }); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  FAIL ${f.name}: ${f.message}`);
  process.exitCode = failed ? 1 : 0;
})();
