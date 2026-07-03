'use strict';
// GroveState — versioned persistence. Browser global + CommonJS.
const GroveState = {};

const SAVE_KEY = 'grove-save-v1';
let storage = (typeof localStorage !== 'undefined') ? localStorage : null;

GroveState._setStorage = function (s) { storage = s; };

function defaultNet() {
  return {
    session: null,          // {access, refresh, userId} once signed in
    circle: null,           // {id, name, inviteCode, memberId} once created/joined
    members: [],            // cached real members [{id, name, avatarId, accentId, joinedAt}]
    cursor: 0,              // highest server event id seen
    outbox: [],             // events awaiting push
    lastSyncAt: null,
    playerStruggle: null,   // {eventKey, postedAt, supporters: [memberId]}
    platform: null,         // 'appdeploy' | 'supabase' once a backend is chosen
    memberKey: null,        // appdeploy anonymous identity secret (uuid)
  };
}

GroveState.defaultState = function (now) {
  return {
    version: 3,
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
    net: defaultNet(),
    aiConsent: { enabled: false, notedAt: null },   // whisperer opt-in
    dailyWhisper: { day: null, text: null },        // cached daily AI affirmation
  };
};

// Migration chain: v1 gains the net block and per-goal privacy flag (v2);
// v2 gains platform/memberKey and the whisperer fields (v3). Missing keys are
// refilled at every step so partial/older exports stay loadable.
GroveState.migrate = function (raw) {
  if (raw.version === 1) raw.version = 2;
  if (!raw.net || typeof raw.net !== 'object') raw.net = defaultNet();
  const defaults = defaultNet();
  for (const k of Object.keys(defaults)) {
    if (!(k in raw.net)) raw.net[k] = defaults[k];
  }
  for (const g of raw.goals) {
    if (typeof g.private !== 'boolean') g.private = false;
  }
  if (raw.version === 2) raw.version = 3;
  if (!raw.aiConsent || typeof raw.aiConsent !== 'object') {
    raw.aiConsent = { enabled: false, notedAt: null };
  }
  if (!raw.dailyWhisper || typeof raw.dailyWhisper !== 'object') {
    raw.dailyWhisper = { day: null, text: null };
  }
  return raw;
};

function isValid(raw) {
  return !!raw && typeof raw === 'object'
    && (raw.version === 1 || raw.version === 2 || raw.version === 3)
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
    return isValid(raw) ? GroveState.migrate(raw) : null;
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
  return GroveState.migrate(raw);
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveState;
if (typeof window !== 'undefined') window.GroveState = GroveState;
