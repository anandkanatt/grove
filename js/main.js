'use strict';
// Grove boot — load, catch up the living circle, render.
(function () {
  const D = window.GroveData, L = window.GroveLogic, Sim = window.GroveSim,
    S = window.GroveState, UI = window.GroveUI;

  let state = S.load();
  const now = Date.now();
  const isNew = !state;
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
    },
  };
  UI.init(ctx);
  window.Grove = ctx; // console/debug handle

  if (!state.onboarded) {
    S.save(state);
    UI.renderAll();
    UI.startOnboarding();
    return;
  }

  // Returning player: how long were we away?
  const gapDays = L.daysBetween(L.dayKey(state.lastVisit), L.dayKey(now));

  L.rolloverChallengeIfNeeded(state, now);

  const rng = Sim.makeRng(now % 2147483647);
  const events = Sim.catchUp(state, now, rng);
  const memberSteps = events.filter(e => e.type === 'step' || e.type === 'bloom').length;
  if (memberSteps > 0) L.addChallengeProgress(state, memberSteps, now, false);
  Sim.maybeStruggle(state, rng, now);

  state.lastVisit = now;
  S.save(state);
  UI.renderAll();

  if (gapDays >= 3) {
    UI.toast(UI.comebackLine(), 'rose');
  } else if (events.length > 0) {
    UI.toast(`🍃 Your circle was busy while you were away — ${events.length} update${events.length > 1 ? 's' : ''} in the feed.`);
  }
})();
