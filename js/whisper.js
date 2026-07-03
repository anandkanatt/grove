'use strict';
// GroveWhisper — consent state, AI payload builders, and browser voice
// helpers. The payload builders are the ONLY exit door for text headed to the
// platform AI, so the privacy rules live here: 🌙 private goals never leave
// the device (titles filtered, private-goal journal entries dropped).
// Pure and Node-tested, except the voice bits, which feature-detect.
const GroveWhisper = {};

const _wlogic = (typeof module !== 'undefined' && module.exports)
  ? require('./logic.js') : window.GroveLogic;

// ---------- consent ----------
GroveWhisper.consentGranted = function (state) {
  return !!(state.aiConsent && state.aiConsent.enabled);
};
GroveWhisper.grantConsent = function (state, now) {
  state.aiConsent = { enabled: true, notedAt: now };
};
GroveWhisper.revokeConsent = function (state) {
  state.aiConsent = { enabled: false, notedAt: null };
};

// ---------- AI payloads ----------
GroveWhisper.whisperContext = function (state) {
  return {
    goals: state.goals.filter(g => !g.bloomedAt && !g.private).map(g => g.name),
    streak: state.streak.count,
    blooms: state.goals.filter(g => g.bloomedAt).length,
  };
};

GroveWhisper.insightsPayload = function (state) {
  const isPrivate = (goalId) => {
    const g = state.goals.find(x => x.id === goalId);
    return g ? g.private : false;
  };
  const reflections = state.journal
    .filter(j => !isPrivate(j.goalId))
    .slice(-10)
    .map(j => ({ day: j.day, text: j.text }));
  const stepsByWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const g of state.goals) {
    for (const s of g.steps) {
      if (s.done && s.doneAt) stepsByWeekday[new Date(s.doneAt).getDay()] += 1;
    }
  }
  return {
    reflections,
    stats: {
      stepsByWeekday,
      blooms: state.goals.filter(g => g.bloomedAt).length,
      streak: state.streak.count,
    },
  };
};

// ---------- daily whisper cache ----------
GroveWhisper.dailyWhisperDue = function (state, now) {
  return state.dailyWhisper.day !== _wlogic.dayKey(now);
};
GroveWhisper.rememberWhisper = function (state, text, now) {
  state.dailyWhisper = { day: _wlogic.dayKey(now), text };
};

// ---------- voice (browser-only, feature-detected) ----------
function recognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

GroveWhisper.speechAvailable = function () {
  return !!recognitionCtor();
};
GroveWhisper.speakAvailable = function () {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined';
};
GroveWhisper.speak = function (text) {
  if (!GroveWhisper.speakAvailable()) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
};
GroveWhisper.makeDictation = function (onText) {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  rec.onresult = function (ev) {
    const text = Array.from(ev.results).map(r => r[0].transcript).join(' ').trim();
    if (text) onText(text);
  };
  return {
    start() { try { rec.start(); } catch (e) { /* already listening */ } },
    stop() { try { rec.stop(); } catch (e) { /* not listening */ } },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveWhisper;
if (typeof window !== 'undefined') window.GroveWhisper = GroveWhisper;
