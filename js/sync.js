'use strict';
// GroveSync — outbox flush + cursor pull orchestration for real circles.
// Dependencies are injected (client, logic, social, data) so Node can drive
// syncNow() directly; browser timers/visibility hooks are guarded.
const GroveSync = {};

GroveSync.makeSync = function (opts) {
  const ctx = opts.ctx;
  const client = opts.client;
  const L = opts.logic;
  const Social = opts.social;
  const D = opts.data;
  const onUpdate = opts.onUpdate || function () {};
  const intervalMs = opts.intervalMs || 30000;
  const nowFn = opts.now || (() => Date.now());

  let status = 'idle';
  let flushTimer = null;
  let interval = null;
  let inFlight = null;   // concurrent syncNow calls coalesce into one pass

  function queue(event) {
    const st = ctx.state;
    if (!st.net.circle) return;
    st.net.outbox.push(event);
    ctx.save();
    flushSoon();
  }

  function flushSoon() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; syncNow(); }, 2000);
  }

  async function doSync() {
    const st = ctx.state;
    if (!st.net.circle || !client) return { ok: false, changed: false };
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    status = 'syncing';
    let changed = false;

    // Flush: send a snapshot; only remove exactly what was sent, so events
    // queued while the request is in the air survive to the next cycle.
    if (st.net.outbox.length) {
      const batch = st.net.outbox.slice();
      const pr = await client.pushEvents(st.net.circle.id, st.net.circle.memberId, batch);
      if (!pr.ok) { status = 'offline'; ctx.save(); return { ok: false, changed }; }
      const sent = new Set(batch.map(e => e.client_key));
      st.net.outbox = st.net.outbox.filter(e => !sent.has(e.client_key));
      changed = true;
    }

    // Pull everything after the cursor and fold it in.
    const pull = await client.pullEvents(st.net.circle.id, st.net.cursor);
    if (!pull.ok) { status = 'offline'; ctx.save(); return { ok: false, changed }; }
    const report = Social.applyRemote(st, D, pull.events, st.net.circle.memberId);

    for (const item of report.feedItems) st.circle.feed.push(item);
    if (st.circle.feed.length > 80) st.circle.feed = st.circle.feed.slice(-80);
    // Only this week's steps water the challenge — a first pull after joining
    // replays the circle's whole history and must not inflate the count.
    const wk = L.weekKey(nowFn());
    const weekSteps = report.feedItems
      .filter(i => i.type === 'step' && L.weekKey(i.ts) === wk).length;
    if (weekSteps > 0) {
      L.addChallengeProgress(st, weekSteps, nowFn(), false);
    }
    if (st.net.playerStruggle) {
      for (const c of report.cheersForMe) {
        if (!st.net.playerStruggle.supporters.includes(c.fromMemberId)) {
          st.net.playerStruggle.supporters.push(c.fromMemberId);
        }
      }
    }
    if (report.memberChanged) {
      const mr = await client.fetchMembers(st.net.circle.id);
      if (mr.ok) {
        st.net.members = mr.members;
        Social.syncSpiritSlots(st, D);
      }
    }
    if (pull.cursor > st.net.cursor) st.net.cursor = pull.cursor;

    st.net.lastSyncAt = nowFn();
    status = 'synced';
    ctx.save();

    const pulledAnything = report.feedItems.length || report.challengeSteps
      || report.cheersForMe.length || report.recoveredWithMyHelp.length
      || report.memberChanged;
    if (pulledAnything) onUpdate(Object.assign({ synced: true }, report));
    return { ok: true, changed: !!(changed || pulledAnything) };
  }

  function syncNow() {
    if (inFlight) return inFlight;
    inFlight = doSync().finally(() => { inFlight = null; });
    return inFlight;
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') syncNow();
  }

  return {
    queue,
    syncNow,
    status: () => status,
    start() {
      syncNow();
      if (typeof document !== 'undefined') {
        interval = setInterval(() => {
          if (document.visibilityState === 'visible') syncNow();
        }, intervalMs);
        document.addEventListener('visibilitychange', onVisibility);
      } else {
        interval = setInterval(syncNow, intervalMs);
      }
    },
    stop() {
      if (interval) { clearInterval(interval); interval = null; }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveSync;
if (typeof window !== 'undefined') window.GroveSync = GroveSync;
