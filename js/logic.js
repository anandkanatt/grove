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

if (typeof module !== 'undefined' && module.exports) module.exports = GroveLogic;
if (typeof window !== 'undefined') window.GroveLogic = GroveLogic;
