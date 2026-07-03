'use strict';
// GroveLogic — pure game rules. No DOM, no storage. Browser global + CommonJS.
const GroveLogic = {};

GroveLogic.XP = { STEP: 10, CHEER: 3, BLOOM: 50, CHALLENGE: 40 };
GroveLogic.PETALS = { STEP: 5, CHEER: 2, BLOOM: 25, CHALLENGE: 30 };

GroveLogic.LEVELS = [
  { at: 0, title: 'Seedling' },
  { at: 60, title: 'Sprout' },
  { at: 150, title: 'Gardener' },
  { at: 300, title: 'Bloomkeeper' },
  { at: 500, title: 'Grove Keeper' },
  { at: 800, title: 'Meadow Maker' },
  { at: 1200, title: 'Wildflower' },
  { at: 1800, title: 'Forest Heart' },
];

GroveLogic.levelForXp = function (xp) {
  const L = GroveLogic.LEVELS;
  let i = 0;
  while (i + 1 < L.length && xp >= L[i + 1].at) i++;
  const at = L[i].at;
  const nextAt = i + 1 < L.length ? L[i + 1].at : null;
  const progress = nextAt === null ? 1 : (xp - at) / (nextAt - at);
  return { level: i + 1, title: L[i].title, at, nextAt, progress };
};

GroveLogic.dayKey = function (ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

GroveLogic.daysBetween = function (dayA, dayB) {
  // Parse as local noon to dodge DST edges.
  const a = new Date(dayA + 'T12:00:00').getTime();
  const b = new Date(dayB + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
};

// Streak rules: same day no-op; next day +1; a gap is forgiven if the player
// holds enough dew shields (one per missed day), otherwise a quiet reset to 1.
// Every 7th consecutive day earns a shield (held cap: 3). Never shame.
GroveLogic.applyActivity = function (streak, ts) {
  const today = GroveLogic.dayKey(ts);
  const s = { count: streak.count, lastActiveDay: streak.lastActiveDay, shields: streak.shields };
  let usedShield = false, reset = false, earnedShield = false, missedDays = 0;

  if (s.lastActiveDay === today) {
    return { streak: s, usedShield, reset, earnedShield, missedDays };
  }
  if (s.lastActiveDay === null) {
    s.count = 1;
  } else {
    const gap = GroveLogic.daysBetween(s.lastActiveDay, today);
    missedDays = Math.max(0, gap - 1);
    if (missedDays === 0) {
      s.count += 1;
    } else if (s.shields >= missedDays) {
      s.shields -= missedDays;
      s.count += 1;
      usedShield = true;
    } else {
      s.count = 1;
      reset = true;
    }
  }
  s.lastActiveDay = today;
  if (s.count > 0 && s.count % 7 === 0 && s.shields < 3) {
    s.shields += 1;
    earnedShield = true;
  }
  return { streak: s, usedShield, reset, earnedShield, missedDays };
};

// Growth stages: 0 seed, 1 sprout, 2 bud, 3 bloom, 4 radiant bloom.
GroveLogic.goalStage = function (goal) {
  const total = goal.steps.length;
  if (total === 0) return 0;
  const done = goal.steps.filter(s => s.done).length;
  const f = done / total;
  if (f === 0) return 0;
  if (f < 0.4) return 1;
  if (f < 0.75) return 2;
  if (f < 1) return 3;
  return 4;
};

GroveLogic.weekKey = function (ts) {
  const d = new Date(ts);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return GroveLogic.dayKey(d.getTime());
};

GroveLogic.cheer = function (state, ts) {
  state.xp += GroveLogic.XP.CHEER;
  state.petals += GroveLogic.PETALS.CHEER;
  state.sunshineSent += 1;
  return [{ type: 'cheer', xp: GroveLogic.XP.CHEER, petals: GroveLogic.PETALS.CHEER }];
};

GroveLogic.addChallengeProgress = function (state, n, ts, fromPlayer) {
  const ch = state.circle.challenge;
  ch.progress += n;
  if (fromPlayer) ch.playerSteps += n;
  const events = [];
  if (!ch.rewarded && ch.target > 0 && ch.progress >= ch.target) {
    ch.rewarded = true;
    state.challengesWon += 1;
    state.xp += GroveLogic.XP.CHALLENGE;
    state.petals += GroveLogic.PETALS.CHALLENGE;
    events.push({ type: 'challenge-complete', xp: GroveLogic.XP.CHALLENGE, petals: GroveLogic.PETALS.CHALLENGE });
  }
  return events;
};

GroveLogic.completeStep = function (state, goalId, stepId, ts) {
  const goal = state.goals.find(g => g.id === goalId);
  if (!goal) return [];
  const step = goal.steps.find(s => s.id === stepId);
  if (!step || step.done) return [];

  const events = [];
  const stageBefore = GroveLogic.goalStage(goal);
  step.done = true;
  step.doneAt = ts;
  state.xp += GroveLogic.XP.STEP;
  state.petals += GroveLogic.PETALS.STEP;
  events.push({ type: 'step', goalId, stepId, xp: GroveLogic.XP.STEP, petals: GroveLogic.PETALS.STEP });

  const streakRes = GroveLogic.applyActivity(state.streak, ts);
  state.streak = streakRes.streak;
  if (streakRes.reset && streakRes.missedDays >= 3) state.comebackPending = true;
  events.push({ type: 'streak', count: state.streak.count, usedShield: streakRes.usedShield,
    reset: streakRes.reset, earnedShield: streakRes.earnedShield });

  const stageAfter = GroveLogic.goalStage(goal);
  if (stageAfter > stageBefore && stageAfter < 4) {
    events.push({ type: 'stage-up', goalId, stage: stageAfter });
  }
  if (stageAfter === 4 && !goal.bloomedAt) {
    goal.bloomedAt = ts;
    state.xp += GroveLogic.XP.BLOOM;
    state.petals += GroveLogic.PETALS.BLOOM;
    events.push({ type: 'bloom', goalId, xp: GroveLogic.XP.BLOOM, petals: GroveLogic.PETALS.BLOOM });
  }

  events.push(...GroveLogic.addChallengeProgress(state, 1, ts, true));
  return events;
};

GroveLogic.activeGoals = function (state) {
  return state.goals.filter(g => !g.bloomedAt);
};

GroveLogic.challengeTarget = function (state) {
  // A real circle computes progress from the shared event log, so every member
  // must see the same target — a flat, reachable number for the full roster.
  if (state.net && state.net.circle) return 70;
  return 50 + 5 * Math.min(GroveLogic.activeGoals(state).length, 4);
};

GroveLogic.rolloverChallengeIfNeeded = function (state, ts) {
  const wk = GroveLogic.weekKey(ts);
  const ch = state.circle.challenge;
  if (ch.weekKey === wk) return false;
  state.circle.challenge = {
    weekKey: wk, target: GroveLogic.challengeTarget(state),
    progress: 0, playerSteps: 0, rewarded: false,
  };
  return true;
};

// Badge conditions live here; display names/art live in data.js under the same ids.
const bloomedGoals = (state) => state.goals.filter(g => g.bloomedAt);
GroveLogic.BADGE_CHECKS = {
  'first-step': (s) => s.goals.some(g => g.steps.some(st => st.done)),
  'first-bloom': (s) => bloomedGoals(s).length >= 1,
  'three-blooms': (s) => bloomedGoals(s).length >= 3,
  'variety-bloom': (s) => new Set(bloomedGoals(s).map(g => g.domain)).size >= 3,
  'streak-7': (s) => s.streak.count >= 7,
  'streak-30': (s) => s.streak.count >= 30,
  'sunshine-10': (s) => s.sunshineSent >= 10,
  'sunshine-50': (s) => s.sunshineSent >= 50,
  'comeback': (s) => s.comebackPending === true,
  'challenge-1': (s) => s.challengesWon >= 1,
  'challenge-5': (s) => s.challengesWon >= 5,
  'five-goals': (s) => s.goals.length >= 5,
  'level-5': (s) => GroveLogic.levelForXp(s.xp).level >= 5,
};

GroveLogic.evaluateBadges = function (state, ts) {
  const earned = [];
  for (const id of Object.keys(GroveLogic.BADGE_CHECKS)) {
    if (state.badges[id]) continue;
    if (GroveLogic.BADGE_CHECKS[id](state)) {
      state.badges[id] = ts;
      earned.push(id);
    }
  }
  return earned;
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveLogic;
if (typeof window !== 'undefined') window.GroveLogic = GroveLogic;
