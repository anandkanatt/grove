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

// domain is one of six category ids — content-free, so quiet goals keep it
// (it feeds the aggregate-only keeper dashboard).
GroveSocial.buildStepEvent = function (goal, stageAfter) {
  return makeEvent('step', { goalTitle: goal.private ? null : goal.name, domain: goal.domain, stage: stageAfter });
};
GroveSocial.buildBloomEvent = function (goal) {
  return makeEvent('bloom', { goalTitle: goal.private ? null : goal.name, domain: goal.domain });
};
GroveSocial.buildStruggleEvent = function (text) {
  return makeEvent('struggle', { text: String(text).trim().slice(0, 280) });
};
GroveSocial.buildRecoverEvent = function (supporterIds) {
  return makeEvent('recover', { supporterMemberIds: supporterIds.slice() });
};
GroveSocial.buildCheerEvent = function (toMemberId, phraseId, text) {
  const payload = { toMemberId, phraseId };
  if (text) payload.text = text;   // whisperer cheers carry their own line
  return makeEvent('cheer', payload);
};
GroveSocial.buildLeaveEvent = function (name) {
  return makeEvent('leave', { name });
};

// Classify events pulled from the server into UI-ready results. PURE: reads
// state.net.members for names but never mutates state — main.js applies these.
GroveSocial.applyRemote = function (state, data, events, selfMemberId) {
  const members = (state.net && state.net.members) || [];
  const memberOf = (id) => members.find(x => x.id === id) || null;
  const nameOf = (id) => { const m = memberOf(id); return m ? m.name : 'A friend'; };
  const phraseOf = (pid) => {
    const p = data.CHEER_PHRASES.find(x => x.id === pid);
    return p ? p.text : 'sending sunshine';
  };
  const res = { feedItems: [], challengeSteps: 0, cheersForMe: [],
    recoveredWithMyHelp: [], memberChanged: false, maxId: 0 };

  for (const ev of events) {
    if (typeof ev.id === 'number' && ev.id > res.maxId) res.maxId = ev.id;
    if (ev.member_id === selfMemberId) continue;
    const name = nameOf(ev.member_id);
    const p = ev.payload || {};
    let type, text;

    if (ev.type === 'step') {
      type = 'step';
      text = p.goalTitle
        ? `${name} took a step toward “${p.goalTitle}”`
        : `${name} tended ${data.REAL_CIRCLE.quietGoalLabel}`;
      res.challengeSteps += 1;
    } else if (ev.type === 'bloom') {
      type = 'bloom';
      text = p.goalTitle
        ? `${name}’s “${p.goalTitle}” bloomed! A goal finished. 🌸`
        : `One of ${name}’s quiet goals bloomed 🌸`;
    } else if (ev.type === 'struggle') {
      type = 'struggle';
      text = `${name}: “${p.text || ''}”`;
    } else if (ev.type === 'recover') {
      type = 'recovery';
      const helped = (p.supporterMemberIds || []).includes(selfMemberId);
      text = `${name} is back on her feet 🌈${helped ? ' — your sunshine helped' : ''}`;
      if (helped) res.recoveredWithMyHelp.push(name);
    } else if (ev.type === 'cheer') {
      type = 'cheer_player';
      const phrase = p.text || phraseOf(p.phraseId);
      const toMe = p.toMemberId === selfMemberId;
      text = `${name} sent ${toMe ? 'you' : nameOf(p.toMemberId)} sunshine ☀️ — “${phrase}”`;
      if (toMe) res.cheersForMe.push({ fromMemberId: ev.member_id, name, phrase });
    } else if (ev.type === 'join') {
      type = 'welcome';
      text = `${p.name || name} joined the circle 🌱`;
      res.memberChanged = true;
    } else if (ev.type === 'leave') {
      type = 'leave';
      text = `${p.name || name} stepped out of the circle — wish her well 🍂`;
      res.memberChanged = true;
    } else {
      continue; // unknown event types: forward compatibility, cursor still advances
    }

    const m = memberOf(ev.member_id);
    const ts = typeof ev.created_at === 'number'
      ? ev.created_at : (Date.parse(ev.created_at) || 0);
    res.feedItems.push({
      id: 'r' + ev.id, ts, type, text,
      real: true, memberId: ev.member_id, name,
      avatarId: m ? m.avatarId : '0', cheered: false,
      goalTitle: (ev.type === 'step' || ev.type === 'bloom') ? (p.goalTitle || null) : undefined,
    });
  }
  return res;
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveSocial;
if (typeof window !== 'undefined') window.GroveSocial = GroveSocial;
