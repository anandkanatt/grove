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
  assertEq(st.version, 2);
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
test('defaultState carries the v2 net block', () => {
  const st = S.defaultState(T('2026-07-02'));
  assertEq(st.net, { session: null, circle: null, members: [], cursor: 0,
    outbox: [], lastSyncAt: null, playerStruggle: null });
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
  assertEq(back.version, 2);
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
  assertEq(back.version, 2);
  assert('net' in back, 'net added');
  assertEq(back.net.session, null);
  assertThrows(() => S.importJson('{}'), 'empty object rejected');
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
  const pub = Social.buildStepEvent({ name: 'Run 5K', private: false }, 2);
  assertEq(pub.type, 'step');
  assertEq(pub.payload, { goalTitle: 'Run 5K', stage: 2 });
  assert(UUID_V4.test(pub.client_key), 'client_key is a v4 uuid');
  assertEq(Social.buildStepEvent({ name: 'Secret', private: true }, 1).payload.goalTitle, null);
  const bloom = Social.buildBloomEvent({ name: 'Run 5K', private: false });
  assertEq(bloom.type, 'bloom');
  assertEq(bloom.payload, { goalTitle: 'Run 5K' });
  const strug = Social.buildStruggleEvent('  ' + 'x'.repeat(300));
  assertEq(strug.payload.text.length, 280, 'struggle text capped');
  assertEq(strug.payload.text[0], 'x', 'struggle text trimmed');
  assertEq(Social.buildRecoverEvent(['m2']).payload, { supporterMemberIds: ['m2'] });
  assertEq(Social.buildCheerEvent('m2', 'cp3').payload, { toMemberId: 'm2', phraseId: 'cp3' });
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
    'setupBody', 'boostPlaceholder', 'boostHint', 'quietGoalLabel']) {
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

// ---------- summary ----------
(async () => {
  // Ref'd watchdog: a hung async test must fail loudly, not drain the event
  // loop into a silent exit-0.
  const watchdog = setTimeout(() => {
    console.log('TIMEOUT: test suite hung — a test never settled');
    process.exit(1);
  }, 120000);
  for (const t of queue) {
    try { await t.fn(); passed++; }
    catch (e) { failed++; failures.push({ name: t.name, message: e.message }); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  FAIL ${f.name}: ${f.message}`);
  process.exit(failed ? 1 : 0);
})();
