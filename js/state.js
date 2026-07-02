'use strict';
// GroveState — versioned persistence. Browser global + CommonJS.
const GroveState = {};

const SAVE_KEY = 'grove-save-v1';
let storage = (typeof localStorage !== 'undefined') ? localStorage : null;

GroveState._setStorage = function (s) { storage = s; };

GroveState.defaultState = function (now) {
  return {
    version: 1,
    player: { name: '', avatarId: 0, accentId: 0, createdAt: now },
    xp: 0,
    petals: 0,
    // One dew shield as a welcome gift — life happens, the garden understands.
    streak: { count: 0, lastActiveDay: null, shields: 1 },
    goals: [],
    journal: [],
    badges: {},
    decor: [],
    shopOwned: [],
    sunshineSent: 0,
    challengesWon: 0,
    comebackPending: false,
    circle: {
      members: [],
      feed: [],
      activeStruggle: null,
      challenge: { weekKey: null, target: 0, progress: 0, playerSteps: 0, rewarded: false },
    },
    lastVisit: now,
    onboarded: false,
  };
};

function isValid(raw) {
  return !!raw && typeof raw === 'object'
    && raw.version === 1
    && raw.player && typeof raw.player === 'object'
    && Array.isArray(raw.goals)
    && raw.streak && typeof raw.streak === 'object'
    && raw.circle && typeof raw.circle === 'object'
    && Array.isArray(raw.circle.feed);
}

GroveState.save = function (state) {
  if (!storage) return;
  try { storage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked — play on in memory */ }
};

GroveState.load = function () {
  if (!storage) return null;
  try {
    const text = storage.getItem(SAVE_KEY);
    if (!text) return null;
    const raw = JSON.parse(text);
    return isValid(raw) ? raw : null;
  } catch (e) {
    return null;
  }
};

GroveState.reset = function () {
  if (storage) try { storage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
};

GroveState.exportJson = function (state) {
  return JSON.stringify(state, null, 2);
};

GroveState.importJson = function (text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error('invalid save'); }
  if (!isValid(raw)) throw new Error('invalid save');
  return raw;
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveState;
if (typeof window !== 'undefined') window.GroveState = GroveState;
