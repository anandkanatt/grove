'use strict';
// GroveSocial — the merge brain for real circles: hybrid roster, outbox event
// builders, and classification of remote events. Pure: no DOM, no fetch.
const GroveSocial = {};

GroveSocial.uuid = function () {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC-4122 v4 fallback — the events.client_key column is uuid-typed.
  let out = '';
  for (const c of 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx') {
    if (c === 'x') out += Math.floor(Math.random() * 16).toString(16);
    else if (c === 'y') out += (8 + Math.floor(Math.random() * 4)).toString(16);
    else out += c;
  }
  return out;
};

// Roster = the 5 circle seats around the player: real members first (oldest
// join first), garden spirits fill whatever seats remain.
GroveSocial.roster = function (state, data) {
  const net = state.net || {};
  const selfId = net.circle ? net.circle.memberId : null;
  const real = net.circle
    ? (net.members || [])
        .filter(m => m.id !== selfId)
        .slice()
        .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
        .slice(0, 5)
        .map(member => ({ kind: 'real', member }))
    : [];
  const spirits = data.MEMBERS.slice(0, Math.max(0, 5 - real.length))
    .map(member => ({ kind: 'sim', member }));
  return real.concat(spirits);
};

// Keep the sim roster (state.circle.members) exactly equal to the spirit
// seats, so sim.js never animates a seat a real friend occupies.
GroveSocial.syncSpiritSlots = function (state, data) {
  const spiritIds = GroveSocial.roster(state, data)
    .filter(e => e.kind === 'sim').map(e => e.member.id);
  const existing = new Map(state.circle.members.map(m => [m.id, m]));
  state.circle.members = spiritIds.map(id => existing.get(id) || { id, lastCheerIdx: -1 });
  const s = state.circle.activeStruggle;
  if (s && !spiritIds.includes(s.memberId)) state.circle.activeStruggle = null;
};

// ---------- outbox event builders ----------
function makeEvent(type, payload) {
  return { client_key: GroveSocial.uuid(), type, payload };
}

GroveSocial.buildStepEvent = function (goal, stageAfter) {
  return makeEvent('step', { goalTitle: goal.private ? null : goal.name, stage: stageAfter });
};
GroveSocial.buildBloomEvent = function (goal) {
  return makeEvent('bloom', { goalTitle: goal.private ? null : goal.name });
};
GroveSocial.buildStruggleEvent = function (text) {
  return makeEvent('struggle', { text: String(text).trim().slice(0, 280) });
};
GroveSocial.buildRecoverEvent = function (supporterIds) {
  return makeEvent('recover', { supporterMemberIds: supporterIds.slice() });
};
GroveSocial.buildCheerEvent = function (toMemberId, phraseId) {
  return makeEvent('cheer', { toMemberId, phraseId });
};
GroveSocial.buildLeaveEvent = function (name) {
  return makeEvent('leave', { name });
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveSocial;
if (typeof window !== 'undefined') window.GroveSocial = GroveSocial;
