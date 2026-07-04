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
let recognitionOverride = null;   // test hook: inject a fake recognition ctor
GroveWhisper._setRecognitionCtor = function (Ctor) { recognitionOverride = Ctor; };

function recognitionCtor() {
  if (recognitionOverride) return recognitionOverride;
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

// Voice choice: the whisperer should sound like a warm woman, Indian English
// when the device has it (Heera/Neerja on Windows/Edge, Veena on Apple).
GroveWhisper.FEMALE_VOICE_HINTS = [
  'female', 'heera', 'veena', 'neerja', 'swara', 'zira', 'aria', 'jenny',
  'susan', 'samantha', 'karen', 'tessa', 'moira', 'fiona', 'emma', 'ava',
  'sonia', 'natasha', 'priya', 'kalpana',
];

function voiceLang(v) {
  return String(v.lang || '').toLowerCase().replace('_', '-');
}
function isEnglish(v) { return voiceLang(v).indexOf('en') === 0; }
function isIndianEnglish(v) { return voiceLang(v).indexOf('en-in') === 0; }
function soundsFemale(v) {
  const n = String(v.name || '').toLowerCase();
  return GroveWhisper.FEMALE_VOICE_HINTS.some(h => n.indexOf(h) !== -1);
}

// preferredName (from settings) wins; otherwise: female Indian-English →
// any female English → any Indian-English → null (engine default).
GroveWhisper.pickVoice = function (voices, preferredName) {
  const list = voices || [];
  if (preferredName) {
    const exact = list.find(v => v.name === preferredName);
    if (exact) return exact;
  }
  return list.find(v => isIndianEnglish(v) && soundsFemale(v))
    || list.find(v => isEnglish(v) && soundsFemale(v))
    || list.find(isIndianEnglish)
    || null;
};

// Chrome populates getVoices() asynchronously — poke it early so the list is
// warm by the first real speak().
GroveWhisper.warmVoices = function () {
  if (!GroveWhisper.speakAvailable()) return;
  try {
    window.speechSynthesis.getVoices();
    if (!window.speechSynthesis.onvoiceschanged) {
      window.speechSynthesis.onvoiceschanged = function () {};
    }
  } catch (e) { /* older engines */ }
};

GroveWhisper.listVoices = function () {
  if (!GroveWhisper.speakAvailable()) return [];
  const rank = (v) => (isIndianEnglish(v) ? 0 : isEnglish(v) ? 1 : 2);
  return window.speechSynthesis.getVoices()
    .map(v => ({ name: v.name, lang: v.lang }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
};

GroveWhisper.speak = function (text, preferredName) {
  if (!GroveWhisper.speakAvailable()) return false;
  const u = new SpeechSynthesisUtterance(text);
  const chosen = GroveWhisper.pickVoice(window.speechSynthesis.getVoices(), preferredName);
  if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
};

// Dictation with the full failure story: some browsers deny the mic
// ('not-allowed'), some can't reach their speech service ('network'), and
// some expose the API but never fire a single event — the watchdog catches
// that last kind so the UI can never get stuck "listening".
GroveWhisper.makeDictation = function (handlers, opts) {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const h = handlers || {};
  const watchdogMs = (opts && opts.watchdogMs) || 8000;
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

  let settled = false;   // a result or error was delivered
  let ended = false;     // onEnd already notified
  let watchdog = null;
  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function notifyEnd() {
    clearWatchdog();
    if (ended) return;
    ended = true;
    if (h.onEnd) h.onEnd();
  }

  rec.onstart = function () { if (h.onStart) h.onStart(); };
  rec.onresult = function (ev) {
    settled = true;
    clearWatchdog();
    const text = Array.from(ev.results).map(r => r[0].transcript).join(' ').trim();
    if (text) { if (h.onText) h.onText(text); }
    else if (h.onError) h.onError('no-speech');
  };
  rec.onerror = function (ev) {
    if (ended) return;
    settled = true;
    clearWatchdog();
    if (h.onError) h.onError((ev && ev.error) || 'unknown');
  };
  rec.onend = function () { notifyEnd(); };

  return {
    start() {
      clearWatchdog();
      watchdog = setTimeout(function () {
        if (settled || ended) return;
        try { rec.stop(); } catch (e) { /* not listening */ }
        if (h.onError) h.onError('no-response');
        notifyEnd();
      }, watchdogMs);
      try { rec.start(); } catch (e) { /* already listening */ }
    },
    stop() { try { rec.stop(); } catch (e) { /* not listening */ } },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveWhisper;
if (typeof window !== 'undefined') window.GroveWhisper = GroveWhisper;
