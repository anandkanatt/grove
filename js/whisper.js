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
// some — Opera, headless builds — expose the API but never fire a single
// event. Two watchdogs: a fast pre-start one catches the zombie API in ~3s
// (so a fallback can take over quickly), and a longer post-start one turns
// endless silence into 'no-speech'. The UI can never get stuck "listening".
GroveWhisper.makeDictation = function (handlers, opts) {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const h = handlers || {};
  const watchdogMs = (opts && opts.watchdogMs) || 3000;   // until onstart
  const resultMs = (opts && opts.resultMs) || 12000;      // after onstart
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
  function armWatchdog(ms, kind) {
    clearWatchdog();
    watchdog = setTimeout(function () {
      if (settled || ended) return;
      try { rec.stop(); } catch (e) { /* not listening */ }
      if (h.onError) h.onError(kind);
      notifyEnd();
    }, ms);
  }
  function notifyEnd() {
    clearWatchdog();
    if (ended) return;
    ended = true;
    if (h.onEnd) h.onEnd();
  }

  rec.onstart = function () {
    armWatchdog(resultMs, 'no-speech'); // the API is alive; now wait for words
    if (h.onStart) h.onStart();
  };
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
      armWatchdog(watchdogMs, 'no-response');
      try { rec.start(); } catch (e) { /* already listening */ }
    },
    stop() { try { rec.stop(); } catch (e) { /* not listening */ } },
  };
};

// ---------- recorded dictation (for browsers whose recognition is a zombie) ----------

const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

GroveWhisper.pickAudioMime = function (isSupported) {
  for (const t of AUDIO_MIMES) {
    if (isSupported(t)) return t;
  }
  return null;
};

GroveWhisper.recorderAvailable = function () {
  return typeof window !== 'undefined'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    && typeof MediaRecorder !== 'undefined'
    && !!GroveWhisper.pickAudioMime(t => MediaRecorder.isTypeSupported(t));
};

// Records mic audio and hands back a base64 blob for the grove's own
// transcriber. Same handler shape as makeDictation, plus onBlob.
GroveWhisper.makeRecorder = function (handlers, opts) {
  if (!GroveWhisper.recorderAvailable()) return null;
  const h = handlers || {};
  const maxMs = (opts && opts.maxMs) || 30000;
  const mime = GroveWhisper.pickAudioMime(t => MediaRecorder.isTypeSupported(t));
  let rec = null, stream = null, cap = null, ended = false;

  function cleanup() {
    if (cap) { clearTimeout(cap); cap = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  function notifyEnd() {
    cleanup();
    if (ended) return;
    ended = true;
    if (h.onEnd) h.onEnd();
  }

  return {
    kind: 'recorder',
    start() {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        stream = s;
        const chunks = [];
        rec = new MediaRecorder(s, { mimeType: mime });
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mime });
          if (!blob.size) { if (h.onError) h.onError('no-speech'); notifyEnd(); return; }
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = String(reader.result).split(',')[1] || '';
            if (h.onBlob) h.onBlob(base64, mime.split(';')[0]);
            notifyEnd();
          };
          reader.onerror = () => { if (h.onError) h.onError('unknown'); notifyEnd(); };
          reader.readAsDataURL(blob);
        };
        rec.start();
        cap = setTimeout(() => { try { rec.stop(); } catch (e) { /* idle */ } }, maxMs);
        if (h.onStart) h.onStart();
      }).catch((e) => {
        if (h.onError) h.onError(e && e.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture');
        notifyEnd();
      });
    },
    stop() {
      if (rec && rec.state === 'recording') { try { rec.stop(); } catch (e) { /* idle */ } }
      else notifyEnd();
    },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveWhisper;
if (typeof window !== 'undefined') window.GroveWhisper = GroveWhisper;
