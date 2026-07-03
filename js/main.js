'use strict';
// Grove boot — load, catch up the living circle, connect the real one, render.
(function () {
  const D = window.GroveData, L = window.GroveLogic, Sim = window.GroveSim,
    S = window.GroveState, UI = window.GroveUI, Social = window.GroveSocial,
    Net = window.GroveNet, Sync = window.GroveSync;

  let state = S.load();
  const now = Date.now();
  if (!state) {
    state = S.defaultState(now);
    Sim.initMembers(state);
  }
  if (!state.circle.members.length) Sim.initMembers(state);

  const ctx = {
    get state() { return state; },
    save() { S.save(state); },
    replaceState(next) {
      state = next;
      if (!state.circle.members.length) Sim.initMembers(state);
      S.save(state);
      connectNet(); // an imported save may carry a circle — reconnect
    },
  };

  // ---------- real-circle plumbing ----------
  const configured = () => !!(window.GroveConfig
    && window.GroveConfig.SUPABASE_URL && window.GroveConfig.SUPABASE_ANON_KEY);

  let client = null;
  let sync = null;

  function onSyncUpdate(report) {
    for (const c of report.cheersForMe) {
      UI.toast(`☀️ ${c.name} sent you sunshine — “${c.phrase}”`, 'rose');
    }
    for (const n of report.recoveredWithMyHelp) {
      UI.toast(`🌈 ${n} is back on her feet — your sunshine helped.`, 'rose');
    }
    UI.renderAll();
  }

  function connectNet() {
    if (sync) { sync.stop(); sync = null; }
    window.Grove.sync = null;
    client = null;
    if (!configured()) return;
    client = Net.makeClient({
      url: window.GroveConfig.SUPABASE_URL,
      anonKey: window.GroveConfig.SUPABASE_ANON_KEY,
      session: state.net.session,
      onSession(s) { state.net.session = s; S.save(state); },
    });
    sync = Sync.makeSync({ ctx, client, logic: L, social: Social, data: D, onUpdate: onSyncUpdate });
    window.Grove.sync = sync;
    if (state.net.circle) {
      Social.syncSpiritSlots(state, D);
      sync.start();
    }
  }

  async function ensureSession() {
    if (state.net.session) return { ok: true };
    return client.signInAnon(); // onSession persists it
  }

  // The weekly challenge is re-armed whenever circle membership changes —
  // the target and the shared count both change meaning at that moment.
  function rearmChallenge() {
    state.circle.challenge = {
      weekKey: L.weekKey(Date.now()), target: L.challengeTarget(state),
      progress: 0, playerSteps: 0, rewarded: false,
    };
  }

  function adoptCircle(circle, memberId, members) {
    state.net.circle = { id: circle.id, name: circle.name, inviteCode: circle.inviteCode, memberId };
    state.net.members = members || [{
      id: memberId, name: state.player.name || 'friend',
      avatarId: String(state.player.avatarId), accentId: String(state.player.accentId),
      joinedAt: new Date().toISOString(),
    }];
    state.net.cursor = 0;
    state.net.playerStruggle = null;
    rearmChallenge();
    Social.syncSpiritSlots(state, D);
    S.save(state);
    if (sync) sync.start();
  }

  window.GroveFlows = {
    async createCircleFlow(name) {
      if (!client) return { ok: false, error: 'offline' };
      const s = await ensureSession();
      if (!s.ok) return s;
      const r = await client.createCircle({
        circleName: name,
        memberName: state.player.name || 'friend',
        avatarId: String(state.player.avatarId),
        accentId: String(state.player.accentId),
      });
      if (!r.ok) return r;
      adoptCircle(r.circle, r.memberId, null);
      return { ok: true, circleName: r.circle.name };
    },
    async joinCircleFlow(code) {
      if (!client) return { ok: false, error: 'offline' };
      const s = await ensureSession();
      if (!s.ok) return s;
      const r = await client.joinCircle({
        code,
        memberName: state.player.name || 'friend',
        avatarId: String(state.player.avatarId),
        accentId: String(state.player.accentId),
      });
      if (!r.ok) return r;
      adoptCircle(r.circle, r.memberId, r.members);
      return { ok: true, circleName: r.circle.name };
    },
    async leaveCircleFlow() {
      if (!client || !state.net.circle) return { ok: false, error: 'offline' };
      const rc = state.net.circle;
      const r = await client.leaveCircle(rc.id, rc.memberId,
        Social.buildLeaveEvent(state.player.name || 'friend'));
      if (!r.ok) return r;
      if (sync) sync.stop();
      state.net.circle = null;
      state.net.members = [];
      state.net.cursor = 0;
      state.net.outbox = [];
      state.net.playerStruggle = null;
      rearmChallenge();
      Social.syncSpiritSlots(state, D); // spirits retake every seat
      S.save(state);
      return { ok: true };
    },
  };

  function pendingJoinCode() {
    const m = (location.hash || '').match(/^#join=([A-Za-z0-9]{6})$/i);
    return m ? m[1].toUpperCase() : null;
  }
  function consumeHash() {
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { /* file:// may refuse; harmless */ }
  }

  // ---------- boot ----------
  UI.init(ctx);
  window.Grove = ctx;           // console/debug handle
  window.Grove.net = window.GroveFlows;
  window.Grove.sync = null;

  if (!state.onboarded) {
    S.save(state);
    UI.renderAll();
    const code = pendingJoinCode();
    if (code && configured()) { consumeHash(); UI.setPendingJoin(code); }
    connectNet();
    UI.startOnboarding();
    return;
  }

  // Returning player: how long were we away?
  const gapDays = L.daysBetween(L.dayKey(state.lastVisit), L.dayKey(now));

  connectNet(); // trims spirit slots + starts sync when a circle exists

  L.rolloverChallengeIfNeeded(state, now);

  const rng = Sim.makeRng(now % 2147483647);
  const events = Sim.catchUp(state, now, rng);
  const memberSteps = events.filter(e => e.type === 'step' || e.type === 'bloom').length;
  if (memberSteps > 0) L.addChallengeProgress(state, memberSteps, now, false);
  Sim.maybeStruggle(state, rng, now);

  state.lastVisit = now;
  S.save(state);
  UI.renderAll();

  const joinCode = pendingJoinCode();
  if (joinCode && configured()) {
    consumeHash();
    UI.switchView('circle');
    UI.openJoinModal(joinCode);
  }

  if (gapDays >= 3) {
    UI.toast(UI.comebackLine(), 'rose');
  } else if (events.length > 0) {
    UI.toast(`🍃 Your circle was busy while you were away — ${events.length} update${events.length > 1 ? 's' : ''} in the feed.`);
  }
})();
