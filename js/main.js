'use strict';
// Grove boot — load, catch up the living circle, connect the real one, render.
// Boot is deferred to DOMContentLoaded so the platform bridge module
// (src/main.ts → window.GrovePlatform) always runs first on App Deploy hosts.
(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
  const D = window.GroveData, L = window.GroveLogic, Sim = window.GroveSim,
    S = window.GroveState, UI = window.GroveUI, Social = window.GroveSocial,
    Net = window.GroveNet, Sync = window.GroveSync;

  // The keeper's dashboard takes over the whole page — the game never boots.
  if (location.hash === '#admin') {
    const adminClient = window.GrovePlatform
      ? window.GroveNetAppDeploy.makeClient({
          platform: window.GrovePlatform, session: null,
          circleRef: () => null, onSession() {},
        })
      : null;
    window.GroveAdmin.boot(adminClient);
    return;
  }

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
  const onPlatform = () => !!window.GrovePlatform;
  const netAvailable = () => onPlatform() || configured();

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
    if (onPlatform()) {
      client = window.GroveNetAppDeploy.makeClient({
        platform: window.GrovePlatform,
        session: state.net.memberKey
          ? { platform: 'appdeploy', memberKey: state.net.memberKey } : null,
        circleRef: () => state.net.circle,
        onSession(s) {
          state.net.memberKey = s ? s.memberKey : null;
          state.net.platform = 'appdeploy';
          S.save(state);
        },
      });
    } else if (configured()) {
      client = Net.makeClient({
        url: window.GroveConfig.SUPABASE_URL,
        anonKey: window.GroveConfig.SUPABASE_ANON_KEY,
        session: state.net.session,
        onSession(s) { state.net.session = s; state.net.platform = 'supabase'; S.save(state); },
      });
    } else {
      return;
    }
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
      if (onPlatform()) window.GrovePlatform.invitesClient.clearPendingCode();
      return { ok: true, circleName: r.circle.name };
    },
    buildInviteLink(code) {
      return client ? client.buildInviteLink(code) : ('#join=' + code);
    },
    get ai() { return client ? client.ai : null; },
    get auth() { return client ? client.auth : null; },
    async linkAccount() { return client ? client.linkAccount() : { ok: false, error: 'offline' }; },
    async backupPush(blob) { return client ? client.backupPush(blob) : { ok: false, error: 'offline' }; },
    async backupPull() { return client ? client.backupPull() : { ok: false, error: 'offline' }; },
    async setQuiet(q) { return client ? client.setQuiet(q) : { ok: false, error: 'offline' }; },
    async pullNudges() { return client ? client.pullNudges() : { ok: true, notes: [] }; },
    async pullMessages(cid, since) { return client ? client.pullMessages(cid, since) : { ok: false, error: 'offline' }; },
    async sendMessage(cid, mid, p) { return client ? client.sendMessage(cid, mid, p) : { ok: false, error: 'offline' }; },
    async voiceUrl(cid, path) { return client ? client.voiceUrl(cid, path) : { ok: false, error: 'offline' }; },
    async setMentor(cid, mid, cfg) { return client ? client.setMentor(cid, mid, cfg) : { ok: false, error: 'offline' }; },
    async mentorChat(cid, mid, q, goals) { return client ? client.mentorChat(cid, mid, q, goals) : { ok: false, error: 'offline' }; },
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
      state.net.memberKey = null;   // the key belonged to that circle's member row
      rearmChallenge();
      Social.syncSpiritSlots(state, D); // spirits retake every seat
      S.save(state);
      return { ok: true };
    },
  };

  function pendingJoinCode() {
    // Platform invite URLs carry appdeploy_invite; the mirror uses #join=.
    if (onPlatform()) {
      const code = window.GrovePlatform.invitesClient.getPendingCode();
      return code ? String(code).toUpperCase() : null;
    }
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
  window.Grove.flags = null;

  // Feature flags + maintenance banner (platform hosts only; fail-open).
  if (onPlatform()) {
    const flagClient = window.GroveNetAppDeploy.makeClient({
      platform: window.GrovePlatform, session: null,
      circleRef: () => null, onSession() {},
    });
    flagClient.flags().then((r) => {
      if (r.ok) {
        window.Grove.flags = r.flags;
        UI.applyFlags(r.flags);
      }
    });
  }

  if (!state.onboarded) {
    S.save(state);
    UI.renderAll();
    const code = pendingJoinCode();
    if (code && netAvailable()) {
      if (!onPlatform()) consumeHash();   // platform helper already cleaned the URL
      UI.setPendingJoin(code);
    }
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
  maybeKeeperRound();

  const joinCode = pendingJoinCode();
  if (joinCode && netAvailable()) {
    if (!onPlatform()) consumeHash();
    UI.switchView('circle');
    UI.openJoinModal(joinCode);
  }

  if (gapDays >= 3) {
    UI.toast(UI.comebackLine(), 'rose');
  } else if (events.length > 0) {
    UI.toast(`🍃 Your circle was busy while you were away — ${events.length} update${events.length > 1 ? 's' : ''} in the feed.`);
  }

  // Keeper notes waiting for her, and the once-a-day cloud backup.
  async function maybeKeeperRound() {
    if (!client) return;
    try {
      if (state.net.circle) {
        const r = await client.pullNudges();
        if (r.ok) {
          for (const n of (r.notes || []).slice(0, 3)) {
            const safe = String(n.text || '').replace(/[<>&]/g, '');
            UI.toast('🌿 A note from the grove keeper: “' + safe + '”', 'rose');
          }
        }
      }
      const acct = state.account || {};
      if (acct.userId && client.auth && client.auth.isSignedIn()
          && acct.lastBackupDay !== L.dayKey(Date.now())) {
        const r = await client.backupPush(S.backupBlob(state, !!acct.backupPrivateGoals));
        if (r.ok) {
          state.account.lastBackupDay = L.dayKey(Date.now());
          S.save(state);
        }
      }
    } catch (e) { /* the keeper never blocks play */ }
  }
  } // end boot
})();
