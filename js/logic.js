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

if (typeof module !== 'undefined' && module.exports) module.exports = GroveLogic;
if (typeof window !== 'undefined') window.GroveLogic = GroveLogic;
