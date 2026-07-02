'use strict';
// GroveSim — the living circle. Generates believable member activity between
// visits, reactions to the player, and struggle/recovery arcs. Pure: no DOM.
const GroveSim = {};

const _data = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : window.GroveData;
const _logic = (typeof module !== 'undefined' && module.exports) ? require('./logic.js') : window.GroveLogic;

const DAY = 86400000;
const memberDef = (id) => _data.MEMBERS.find(m => m.id === id);

// mulberry32 — tiny deterministic PRNG so tests can pin behavior.
GroveSim.makeRng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

GroveSim.initMembers = function (state) {
  // Save stays lean: pools and bios live in GroveData, looked up by id.
  state.circle.members = _data.MEMBERS.map(m => ({ id: m.id, lastCheerIdx: -1 }));
};

function nextEventId(state) {
  state.circle.feedSeq = (state.circle.feedSeq || 0) + 1;
  return 'e' + state.circle.feedSeq;
}

function pushFeed(state, event) {
  state.circle.feed.push(event);
  if (state.circle.feed.length > 80) {
    state.circle.feed = state.circle.feed.slice(-80);
  }
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

GroveSim.catchUp = function (state, now, rng) {
  const since = state.lastVisit;
  const span = now - since;
  if (span < 5 * 60 * 1000) return [];
  const days = span / DAY;
  const events = [];

  if (days > 14) {
    // A digest per member instead of a month-long flood.
    state.circle.members.forEach((m, i) => {
      const def = memberDef(m.id);
      const goal = pick(rng, def.goals);
      const verb = pick(rng, def.feedVerbs);
      events.push({
        id: nextEventId(state), ts: now - (i + 1) * 60000, memberId: m.id, type: 'digest',
        text: `${def.name} kept tending her garden while you were away — she ${verb} “${goal.name}” and more.`,
        cheered: false,
      });
    });
  } else {
    for (const m of state.circle.members) {
      const def = memberDef(m.id);
      const expected = days * def.pace * 1.8;
      let count = Math.floor(expected);
      if (rng() < expected - count) count += 1;
      for (let i = 0; i < count; i++) {
        const goal = pick(rng, def.goals);
        const verb = pick(rng, def.feedVerbs);
        const bloomRoll = rng();
        const isBloom = bloomRoll < 0.02;
        events.push({
          id: nextEventId(state), ts: since + Math.floor(rng() * span), memberId: m.id,
          type: isBloom ? 'bloom' : 'step',
          text: isBloom
            ? `${def.name}’s “${goal.name}” bloomed! A goal finished. 🌸`
            : `${def.name} ${verb} “${goal.name}”`,
          cheered: false,
        });
      }
    }
    events.sort((a, b) => a.ts - b.ts);
    if (events.length > 30) events.splice(0, events.length - 30);
  }

  for (const e of events) pushFeed(state, e);
  return events;
};

GroveSim.reactions = function (state, rng, now) {
  const howMany = rng() < 0.35 ? 2 : 1;
  const pool = state.circle.members.slice();
  const events = [];
  for (let i = 0; i < howMany && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length) % pool.length;
    const m = pool.splice(idx, 1)[0];
    const def = memberDef(m.id);
    let cheerIdx = Math.floor(rng() * def.cheers.length) % def.cheers.length;
    if (cheerIdx === m.lastCheerIdx) cheerIdx = (cheerIdx + 1) % def.cheers.length;
    m.lastCheerIdx = cheerIdx;
    const event = {
      id: nextEventId(state), ts: now + Math.floor(rng() * 90000), memberId: m.id,
      type: 'cheer_player', text: def.cheers[cheerIdx], cheered: false,
    };
    pushFeed(state, event);
    events.push(event);
  }
  return events;
};

GroveSim.maybeStruggle = function (state, rng, now) {
  if (state.circle.activeStruggle) return [];
  if (rng() >= 0.25) return [];
  const defs = state.circle.members.map(m => memberDef(m.id));
  const total = defs.reduce((s, d) => s + d.struggleProne, 0);
  let roll = rng() * total;
  let chosen = defs[0];
  for (const d of defs) { roll -= d.struggleProne; if (roll <= 0) { chosen = d; break; } }
  const event = {
    id: nextEventId(state), ts: now, memberId: chosen.id, type: 'struggle',
    text: pick(rng, chosen.struggles), cheered: false,
  };
  pushFeed(state, event);
  state.circle.activeStruggle = { memberId: chosen.id, since: now, supported: false };
  return [event];
};

GroveSim.supportMember = function (state, memberId, now) {
  const def = memberDef(memberId);
  if (!def) return [];
  // Mark her most recent un-cheered post as cheered.
  for (let i = state.circle.feed.length - 1; i >= 0; i--) {
    const e = state.circle.feed[i];
    if (e.memberId === memberId && !e.cheered && e.type !== 'cheer_player') {
      e.cheered = true;
      break;
    }
  }
  const events = _logic.cheer(state, now);

  const struggle = state.circle.activeStruggle;
  if (struggle && struggle.memberId === memberId && !struggle.supported) {
    const playerName = (state.player.name || 'friend').trim() || 'friend';
    // Deterministic pick keeps saves stable without threading an rng here.
    const line = def.recoveries[(state.sunshineSent + state.circle.feed.length) % def.recoveries.length];
    const recovery = {
      id: nextEventId(state), ts: now + 1500, memberId, type: 'recovery',
      text: line.split('{name}').join(playerName), cheered: false,
    };
    pushFeed(state, recovery);
    state.circle.activeStruggle = null;
    events.push({ type: 'recovery', memberId });
  }
  return events;
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveSim;
if (typeof window !== 'undefined') window.GroveSim = GroveSim;
