# Grove Phase 3 — The Grove Whisperer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Grove onto App Deploy (circles on platform `db` + `invites`, anonymous) and add the Whisperer AI features (`ai.generate`) plus free Web Speech voice — per `docs/superpowers/specs/2026-07-03-grove-phase3-whisperer-design.md`.

**Architecture:** The plain-script client ships in `public/` unchanged; a tiny Vite module `src/main.ts` bridges the platform-injected `@appdeploy/client` to `window.GrovePlatform`; Grove boots on `DOMContentLoaded` so the bridge always wins the race. A new adapter `js/netad.js` implements the Phase 2 client surface over platform routes; `backend/index.ts` (TypeScript, platform SDK) implements circles/events/AI. One `index.html` serves the platform, the GitHub Pages mirror, Supabase self-hosters, and `file://` solo.

**Tech Stack:** Existing zero-dep JS client + Node test harness; App Deploy html-static template (Vite/TS build handled by the platform); `@appdeploy/sdk` backend (`router`, `db`, `invites`, `ai.generate`).

## Global Constraints

- Our client modules stay plain-script UMD, zero npm dependencies; the repo remains the single source of truth (Pages mirror + `file://` keep working with the same files).
- Frontend never imports `@appdeploy/sdk`; backend never imports `@appdeploy/client`; frontend reaches the backend **only** through the bridged `api` (never `fetch`).
- Template files (`package.json`, `vite.config.ts`, `tsconfig.json`, `postcss.config.js`, `tailwind.config.js`) are auto-included baselines — never resent; `src/main.ts`, `index.html`, `backend/index.ts` are modified via deploy contents.
- AI guardrails (verbatim from spec): 40 calls/circle/day total, coach 5/member/day; `thinkingMode:'NONE'`; `maxTokens ≤ 500`; cap hit → warm copy “The whisperer is resting — try again tomorrow 🌙”; 🌙 private goals never in AI payloads except the owner's own coach request; every AI surface consent-gated and with a non-AI fallback.
- Event model, types, payloads identical to Phase 2 (append-only, `clientKey` dedupe, prune to last 200/circle).
- All local tests: `node tests/run-tests.js` exits 0 (existing 79 must stay green). Commit after each green task on branch `real-circles`.

---

## File structure

```
src/main.ts              REPLACE template file: platform bridge → window.GrovePlatform
index.html               MODIFY: + bridge module tag, defer-boot note (tags unchanged otherwise)
js/netad.js              NEW: GroveNetAppDeploy — adapter over bridged api/invitesClient
js/whisper.js            NEW: GroveWhisper — consent state, AI payload builders (privacy rules), voice helpers
js/net.js                MODIFY: + kind:'supabase', + buildInviteLink(code)
js/state.js              MODIFY: version 3 migration
js/main.js               MODIFY: DOMContentLoaded boot, adapter selection, platform pending-invite
js/ui.js                 MODIFY: AI surfaces (consent modal, 🪄 coach, suggest-reply, insights card,
                         daily whisper, ✨ personal cheer), voice buttons, invite link via client
css/style.css            MODIFY: .whisper-*, .mic-btn, .consent-* styles
backend/grove.ts         NEW: pure helpers — validation, caps math, prompts, schemas (no SDK imports)
backend/index.ts         REPLACE template file: routes (circles/join/members/events/leave, ai/*)
tests/tests.txt          NEW: platform e2e scenarios (8 tests, one [sanity])
tools/pack-appdeploy.js  NEW: assembles appdeploy-dist/ from repo files (js/→public/js/ etc.)
tests/run-tests.js       MODIFY: new sections (state v3, whisper, netad)
README.md                MODIFY: “One-click grove (App Deploy)” section
.gitignore               MODIFY: + appdeploy-dist/
```

### Pinned contracts

```js
// window.GrovePlatform (set by src/main.ts on platform hosts only)
{ api: { get(url), post(url, body), put, delete },   // from '@appdeploy/client'
  invitesClient: { getPendingCode(), clearPendingCode(), buildJoinUrl(code, {path}) } }

// js/netad.js  — GroveNetAppDeploy.makeClient({platform}) -> client
// Same surface as GroveNet plus (both clients now expose):
client.kind                          // 'appdeploy' | 'supabase'
client.buildInviteLink(code)         // appdeploy: invitesClient.buildJoinUrl(code, {path:'/'})
                                     // supabase: origin + pathname + '#join=' + code
client.ai                            // appdeploy: {steps, cheer, boostReplies, insights}; supabase: null
client.getSession() -> {platform:'appdeploy', memberKey}|null
client.signInAnon() -> {ok:true, session}            // no-op; identity is memberKey
client.createCircle({circleName, memberName, avatarId, accentId})
  -> {ok, circle:{id,name,inviteCode}, memberId, memberKey}
client.joinCircle({code, ...}) -> {ok, circle, memberId, memberKey, members}
client.fetchMembers(circleId) -> {ok, members:[{id,name,avatarId,accentId,joinedAt}]}
client.pushEvents(circleId, memberId, events) -> {ok, pushed}
client.pullEvents(circleId, cursor) -> {ok, events, cursor}   // cursor = createdAt ms
  // events normalized to Phase 2 wire shape {id, member_id, type, payload, created_at}
client.leaveCircle(circleId, memberId, leaveEvent) -> {ok}
client.ai.steps({goalName, domain}) -> {ok, steps:[string]} | {ok:false, error}
client.ai.cheer({toName, goalTitle, kind}) -> {ok, line}
client.ai.boostReplies({struggleText}) -> {ok, replies:[s1,s2,s3]}
client.ai.insights({reflections, stats}) -> {ok, text}
// every method: never throws; network/HTTP failure → {ok:false, error, offline?}; 429 → error:'ai-rest'

// js/whisper.js — GroveWhisper (pure, Node-tested)
GroveWhisper.consentGranted(state) -> boolean
GroveWhisper.grantConsent(state, now) / revokeConsent(state)
GroveWhisper.whisperContext(state) -> {goals:[nonPrivate active titles], streak, blooms}
GroveWhisper.insightsPayload(state) -> {reflections:[≤10, private-goal entries excluded],
  stats:{stepsByWeekday:[7 ints], blooms, streak}}
GroveWhisper.dailyWhisperDue(state, now) -> boolean       // once per local dayKey
GroveWhisper.rememberWhisper(state, text, now)
// voice (browser-only, feature-detected, no-ops in Node):
GroveWhisper.speechAvailable() / speak(text) / makeDictation(onText) -> {start,stop}|null

// state v3 additions (migrate chain v1→v2→v3)
state.version === 3
state.net.platform: null|'appdeploy'|'supabase'
state.net.memberKey: null|string
state.aiConsent: {enabled:false, notedAt:null}
state.dailyWhisper: {day:null, text:null}

// Backend routes — bodies/returns exactly as spec §5.2; identity = memberId+memberKey pair
```

---

### Task 1: state.js — version 3

**Files:** Modify `js/state.js`, `tests/run-tests.js`

**Interfaces — Produces:** the v3 fields above; `migrate` upgrades v1 and v2 saves; `defaultState().version === 3`.

- [ ] **Step 1: failing tests** (section `---------- state v3 (whisperer) ----------`):
  - `defaultState` → `version 3`, `net.platform === null`, `net.memberKey === null`, `aiConsent` deep-equals `{enabled:false, notedAt:null}`, `dailyWhisper` deep-equals `{day:null, text:null}`.
  - A crafted **v1** save (as in the v2 tests) loaded through fake storage → version 3 with all new fields defaulted.
  - A crafted **v2** save (take v3 default, set `version:2`, delete the four new fields) → migrated to 3, `goals[0].private` preserved.
  - v3 round-trip save/load deep-equals; `importJson` of a v2 export migrates.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement — `defaultNet()` gains `platform:null, memberKey:null`; `defaultState` gains `aiConsent`/`dailyWhisper` and `version:3`; `migrate` becomes a chain:

```js
GroveState.migrate = function (raw) {
  if (raw.version === 1) raw.version = 2;
  if (!raw.net || typeof raw.net !== 'object') raw.net = defaultNet();
  const defaults = defaultNet();
  for (const k of Object.keys(defaults)) if (!(k in raw.net)) raw.net[k] = defaults[k];
  for (const g of raw.goals) if (typeof g.private !== 'boolean') g.private = false;
  if (raw.version === 2) raw.version = 3;
  if (!raw.aiConsent || typeof raw.aiConsent !== 'object') raw.aiConsent = { enabled: false, notedAt: null };
  if (!raw.dailyWhisper || typeof raw.dailyWhisper !== 'object') raw.dailyWhisper = { day: null, text: null };
  return raw;
};
```

  `isValid` accepts versions 1–3. **Step 4:** run → PASS (existing v2 tests updated only where they assert `version === 2` → now 3 via migration; the `defaultState carries the v2 net block` test gains the two new net keys).
- [ ] **Step 5:** `git commit -m "feat: state v3 — platform, memberKey, ai consent, daily whisper"`

### Task 2: whisper.js — consent, payload builders, privacy rules

**Files:** Create `js/whisper.js`; modify `tests/run-tests.js`, `index.html` (script tag after `js/social.js`)

**Interfaces — Produces:** the `GroveWhisper` contract above. UMD guard like every module.

- [ ] **Step 1: failing tests** (fixture: v3 default + two goals `{name:'Run 5K', private:false}` / `{name:'Secret', private:true}`, one done step per goal, journal entries pointing at each):
  - `consentGranted(default) === false`; after `grantConsent(st, T('2026-07-02'))` → true with `notedAt` set; `revokeConsent` → false.
  - `whisperContext(st).goals` deep-equals `['Run 5K']` — **private goal excluded** (the load-bearing privacy test).
  - `insightsPayload(st).reflections` contains only the non-private goal's entry; `stats.stepsByWeekday` has length 7 and sums to the number of done steps; `stats` includes `blooms` and `streak` numbers.
  - `dailyWhisperDue(st, T('2026-07-02')) === true`; after `rememberWhisper(st,'hello',T('2026-07-02'))` → `false` same day, `true` at `T('2026-07-03')`; `dailyWhisper` equals `{day:'2026-07-02', text:'hello'}`.
  - `speechAvailable() === false` in Node; `makeDictation(()=>{}) === null` in Node (no throw).
- [ ] **Step 2:** FAIL → **Step 3:** implement (pure; day math via `GroveLogic.dayKey` — require `./logic.js` like sim.js does; voice helpers guard `typeof window`). **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: whisper — consent, AI payload builders, privacy rules"`

### Task 3: netad.js — App Deploy adapter

**Files:** Create `js/netad.js`; modify `js/net.js` (+`kind`, +`buildInviteLink`), `tests/run-tests.js`, `index.html` (script tag after `js/net.js`)

**Interfaces — Consumes:** `window.GrovePlatform` shape (injected as `{platform}` param for tests). **Produces:** the full client contract pinned above.

- [ ] **Step 1: failing tests** (fake platform: `{api: {get:async(u)=>rec('GET',u), post:async(u,b)=>rec('POST',u,b), ...}, invitesClient: {buildJoinUrl:(code,o)=>'https://app.example/?appdeploy_invite='+code}}` with scripted responses):
  - `createCircle` POSTs `/api/circles` with `{name, member:{name,avatarId,accentId}}`, returns camel `{circle:{id,name,inviteCode}, memberId, memberKey}`, and `getSession()` afterwards equals `{platform:'appdeploy', memberKey}`.
  - `joinCircle` POSTs `/api/circles/join` with the code; members normalized.
  - `pushEvents('c1','m1',[{client_key,type,payload}])` POSTs `/api/circles/c1/events` with `{memberId, memberKey, events:[{clientKey,type,payload}]}` (client_key→clientKey rename) → `{ok, pushed:1}`.
  - `pullEvents('c1', 1000)` GETs `/api/circles/c1/events?since=1000&memberId=…&memberKey=…`; rows `[{id:'e9', memberId:'m2', type:'step', payload:{}, createdAt: 2000}]` normalize to `{id:'e9', member_id:'m2', type:'step', payload:{}, created_at: 2000}` and `cursor === 2000`; empty rows → cursor unchanged.
  - `buildInviteLink('AB12CD')` returns the fake's URL (proves `invitesClient` used, not '#join=').
  - `ai.steps({goalName:'Run 5K', domain:'fitness'})` POSTs `/api/ai/steps` including memberId/memberKey/circleId and returns `{ok, steps}`; an HTTP 429 response maps to `{ok:false, error:'ai-rest'}`; a rejecting api call maps to `{ok:false, offline:true}` (never throws).
  - Supabase client regression: `GroveNet.makeClient(...).kind === 'supabase'`, `.ai === null`, `buildInviteLink('ABC234')` ends with `'#join=ABC234'`.
- [ ] **Step 2:** FAIL → **Step 3:** implement `js/netad.js` (wrap every call in try/catch → offline mapping; store `{circleId→memberKey}`… memberKey lives in `state`, so the adapter holds it via `makeClient({platform, session})` + `onSession` like GroveNet). Add to `js/net.js`: `kind:'supabase'`, `ai:null`, `buildInviteLink`.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat: appdeploy adapter behind the phase-2 client seam"`

### Task 4: boot — bridge, DOMContentLoaded, adapter selection

**Files:** Create `src/main.ts`; modify `index.html`, `js/main.js`, `js/ui.js` (invite link only)

**Interfaces — Consumes:** Tasks 1–3. **Produces:** `window.GrovePlatform` on platform hosts; boot order guarantee; `Grove.net`/`Grove.sync` wired to whichever adapter matches the host.

- [ ] **Step 1:** `src/main.ts` (complete file — replaces template content):

```ts
// Platform bridge: expose the injected AppDeploy client to Grove's plain scripts.
import { api, invitesClient } from '@appdeploy/client';
(window as any).GrovePlatform = { api, invitesClient };
```

- [ ] **Step 2:** `index.html`: add `<script type="module" src="./src/main.ts"></script>` as the FIRST script tag (module scripts finish before `DOMContentLoaded`; on Pages/`file://` it 404s harmlessly).
- [ ] **Step 3:** `js/main.js`: wrap the existing boot IIFE body in `function boot() {…}` invoked via `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();`. Inside `connectNet()`, select the adapter:

```js
if (window.GrovePlatform) {
  client = GroveNetAppDeploy.makeClient({
    platform: window.GrovePlatform,
    session: state.net.memberKey ? { platform: 'appdeploy', memberKey: state.net.memberKey } : null,
    onSession(s) { state.net.memberKey = s ? s.memberKey : null; state.net.platform = 'appdeploy'; S.save(state); },
  });
} else if (configured()) { /* existing GroveNet path, unchanged */ }
```

  Deep link: when `window.GrovePlatform`, replace the `#join=` regex with `GrovePlatform.invitesClient.getPendingCode()` (call `clearPendingCode()` after a successful join in `joinCircleFlow`; keep `#join=` handling for the mirror). `ui.js` `copyInviteLink` becomes one line: `const link = window.Grove.net.client ? … ` — precisely: flows expose `Grove.net.buildInviteLink(code)` delegating to the active client; ui calls that.
- [ ] **Step 4:** `node tests/run-tests.js` → all PASS (boot is browser-only; suite guards remain). Browser check on the dev server: fresh profile boots v1-identical, console clean (bridge 404 is a warning, not an error — acceptable; verify no thrown errors).
- [ ] **Step 5:** `git commit -m "feat: platform bridge + deferred boot + adapter selection"`

### Task 5: AI + voice UI

**Files:** Modify `js/ui.js`, `css/style.css`

Shape-pinned (v1/v2 convention for UI tasks); all actions via existing delegation:

- Consent: `whisper-consent-open` fires before any first AI action (`GroveWhisper.consentGranted` check inside a shared `withConsent(fn)` helper); modal copy explains what leaves the device; `whisper-consent-accept` → `grantConsent` + run the pending action; Settings gains a “Whisperer: on/off” row (`whisper-consent-revoke`).
- Wizard steps stage (only when `client.ai`): `🪄 draft my tiny steps` button (`whisper-steps`) → `client.ai.steps({goalName: ob.goalName, domain: ob.domain})` → replaces `ob.steps` with the returned steps (editable as normal); disabled state while in flight; failure → warm toast + steps untouched.
- Boost cards (real `struggle` feed items): `whisper-replies` button → three suggestions rendered as tappable chips; tapping one sends it through the existing cheer path with the chosen text as the phrase (cheer event `payload.phraseId:'ai'`, `payload.text:<line>` — social.applyRemote already falls back to a default phrase for unknown ids; extend its cheer text rule: prefer `payload.text` when present, one-line change + one Node test).
- Personal cheer: `✨ make it personal` beside one-tap sunshine on real items → `client.ai.cheer({toName, goalTitle, kind:'step'})` → sends as above.
- Daily whisper: in `renderToday`, when platform+circle+consent and `dailyWhisperDue` → fire-and-forget `client.ai.cheer({kind:'daily', …whisperContext})`, `rememberWhisper`, rerender; otherwise static affirmation (unchanged fallback).
- Growth Rings: `whisper-insights` button on the journal card → `client.ai.insights(GroveWhisper.insightsPayload(state))` → result rendered in a `.whisper-card`; failures → warm toast.
- Voice: mic button (`voice-dictate`, shown when `GroveWhisper.speechAvailable()`) on boost composer + reflection input appends dictated text; speaker button (`voice-speak`) on the affirmation reads it via `speak()`.
- CSS: `.whisper-card` (soft gold left border), `.whisper-btn` (small, ✨), `.mic-btn`, `.consent-note`, reply-chip styles.

- [ ] **Step 1:** implement; **Step 2:** `node tests/run-tests.js` PASS (includes the new applyRemote `payload.text` test); **Step 3:** browser-verify surfaces render/hide correctly with no platform (all AI buttons absent on the mirror). **Step 4:** `git commit -m "feat: whisperer UI — coach, replies, insights, daily whisper, voice"`

### Task 6: backend — grove.ts helpers + index.ts routes + e2e tests

**Files:** Create `backend/grove.ts`, `tests/tests.txt`; replace `backend/index.ts`

**Interfaces — Consumes:** `@appdeploy/sdk` (`router/json/error/db/invites/isInviteError/ai`). **Produces:** the spec §5.2 routes. Verified by platform e2e (no local SDK runtime) — keep `index.ts` thin, logic in `grove.ts`.

- [ ] **Step 1:** `backend/grove.ts` (pure, no SDK imports): `GROVE_TONE` system prompt (warm, capable, never scolding; tiny implementation-intention steps that fit in a day; plain language); JSON schemas `STEPS_SCHEMA {steps: string[], minItems 6, maxItems 10}`, `REPLIES_SCHEMA {replies: string[3]}`; `todayKey(ts)`; `capExceeded(usage, memberId, {circleCap:40, coachCap:5})`; `validEvent(e)` (type whitelist + payload size ≤ 2KB); `pruneList(events, 200)`.
- [ ] **Step 2:** `backend/index.ts` — complete route set:

```ts
import { router, json, error, db, invites, isInviteError, ai } from '@appdeploy/sdk';
import { GROVE_TONE, STEPS_SCHEMA, REPLIES_SCHEMA, todayKey, capExceeded, validEvent } from './grove';

async function member(circleId: string, memberId: string, memberKey: string) {
  const [m] = await db.get('members', [memberId]);
  return m && m.circleId === circleId && m.memberKey === memberKey ? m : null;
}
async function circleEvents(circleId: string) {   // full paginated list, small by design
  let items: any[] = [], nextToken: string | undefined;
  do {
    const page = await db.list('events', { filter: { circleId }, nextToken });
    items = items.concat(page.items); nextToken = page.nextToken;
  } while (nextToken);
  return items.sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
}
async function addEvent(circleId, memberId, type, payload) { /* createdAt nudge via circles.lastEventAt, db.add, prune >200 via db.delete */ }
async function aiAllowed(circleId, memberId, isCoach) { /* aiUsage day row: read-or-create, capExceeded, increment */ }
```

  Routes (each with full body in the actual file; behaviors pinned):
  - `POST /api/circles` → `db.add circles {name, createdAt, lastEventAt:0}` + member (mint `memberKey` via `crypto.randomUUID()`) + join event + `invites.create({resourceType:'circle', authMode:'anonymous', context:{circleId}})` → `{circleId, circleName, inviteCode, memberId, memberKey}`; name lengths clamped (1–40 / 1–30).
  - `POST /api/circles/join` → `invites.join({code})` in try/catch `isInviteError` → map `invite_not_found→'not-found'`; ≥5 members → `error('full',400)`; idempotency: a member row with the same memberKey isn't re-created (client re-join sends nothing — new device = new member, matching Phase 2 semantics); returns members[].
  - `GET /api/circles/:id/members`, `GET /api/circles/:id/events?since=` (filter `createdAt > since` in code), `POST /api/circles/:id/events` (verify member, per-event `validEvent`, in-code `clientKey` dedupe against existing, `addEvent` each), `POST /api/circles/:id/leave` (leave event, then `db.delete members`) — all 401 on bad member/memberKey via `error('unauthorized', 401)`.
  - `POST /api/ai/steps|cheer|boost-replies|insights` → verify member → `aiAllowed` (`steps` is the coach: per-member cap) else `error('ai-rest', 429)` → `ai.generate({system: GROVE_TONE, prompt: <task-specific>, schema?, maxTokens: ≤500, temperature: 0.7, thinkingMode: 'NONE'})` → parse/return; catch → `error('ai-unavailable', 502)`. Private-goal exclusion is client-side by construction (whisper.js builds payloads); backend never receives other goals.
- [ ] **Step 3:** `tests/tests.txt` — 8 stateless scenarios, exactly one `[sanity]`: (1) `[sanity]` app loads + onboarding modal visible (desktop); (2) onboarding completes → Today shows the planted goal (mobile); (3) Circle tab shows “Start a circle” (desktop); (4) create circle → invite code chip visible (desktop); (5) Actor A creates circle + step, Actor B joins via invite URL → sees A's step in feed (desktop, multi-actor); (6) first 🪄 tap shows the consent note (desktop); (7) `QA Faults` 429 on `POST /api/ai/steps` → warm “whisperer is resting” toast, wizard steps unchanged (desktop); (8) 375px mobile: circle cards and composer usable (mobile).
- [ ] **Step 4:** `node tests/run-tests.js` still PASS (backend files aren't loaded by the local suite). `git commit -m "feat: appdeploy backend — circles, events, whisperer routes + e2e specs"`

### Task 7: packaging + README

**Files:** Create `tools/pack-appdeploy.js`; modify `.gitignore`, `README.md`

- [ ] **Step 1:** `tools/pack-appdeploy.js` (zero-dep): assembles `appdeploy-dist/`: copies `index.html`, `src/`, `backend/`, `tests/tests.txt` verbatim; maps `js/*.js → public/js/`, `css/style.css → public/css/`; skips `js/config.js`? **No — include it blank** (mirror parity; platform host ignores Supabase config because the bridge wins adapter selection). Prints a file manifest. `.gitignore` += `appdeploy-dist/`.
- [ ] **Step 2:** README: “One-click grove (App Deploy)” — what the platform gives (no Supabase, no keys, AI included), that AI is consent-gated and circle-members-only, caps, and that Pages/Supabase modes remain. Dev table += netad/whisper/backend rows.
- [ ] **Step 3:** run pack; verify manifest lists every expected file. `git commit -m "feat: appdeploy packaging + docs"`

### Task 8: deploy + fix loop

- [ ] **Step 1:** `node tools/pack-appdeploy.js`; multipart PUT the tree via `upload_assets` (payload manifest: text files as content; no binaries exist) → `upload_id`.
- [ ] **Step 2:** `deploy_app` — `app_id: null`, `app_name: "Grove"`, `app_type: "frontend+backend"`, `frontend_template: "html-static"`, `features: ["api","database","invites","ai.generate"]`, `description`, `intent: "initial app deploy"`, `initiator: "user"`, `type: "feature"`, `model: "claude-fable-5"`, `upload_id`.
- [ ] **Step 3:** poll `get_app_status` every ≥5s to terminal; on QA/e2e/runtime errors: `src_glob/src_grep/src_read` + `get_e2e_qa_run_details` first, fix, redeploy (≤3 auto-attempts). Record `app_id` in `docs/superpowers/plans/` notes, NOT in the deploy tree.
- [ ] **Step 4:** on `ready`: `git commit` any fix-loop source changes (`fix: appdeploy qa findings`).

### Task 9: live verification + wrap

- [ ] **Step 1:** Two-player smoke on the live URL: browser A (preview) onboards, creates circle, copies the platform invite link; player B via `curl` against `/api/circles/join` + `/api/circles/:id/events` (anonymous routes make curl a valid second client) — steps/cheers/boost→comeback sync within a poll; coach 🪄 returns 6–10 editable steps after consent; insights and daily whisper render; caps return the resting copy when exhausted (drive with repeated curl coach calls as B).
- [ ] **Step 2:** Regression: GitHub Pages mirror still boots v1-identical (blank config, no bridge); `node tests/run-tests.js` green; `git diff` for strays.
- [ ] **Step 3:** Final commit `docs: phase 3 notes`; report live URL + summary.

## Self-review (done)

- **Spec coverage:** §4.1 features → T5 (+T2 payloads, T3 ai surface); §4.2 consent/privacy → T2 (privacy tests) + T5 (gating) + backend-by-construction note in T6; §4.3 caps → T6 (`aiAllowed`) + e2e test 7; §5.1 platform app → T4/T6/T8; §5.2 routes/tables → T6; §5.3 adapter/seam → T3/T4; §5.4 state v3 → T1; §5.5 errors → T3 (offline/429 mapping), T5 (fallbacks), T6 (401/429/502); §6 testing → per-task + tests.txt (T6) + live smoke (T9); §7 ship list fully mapped; §8 criteria = T9.
- **Placeholder scan:** backend route bodies are pinned by behavior + helper signatures with full code written at implementation into `backend/index.ts` (single file, contents fixed by T6's behavior list); UI shape-pinned per repo convention; no TBDs.
- **Type consistency:** `clientKey` on the wire ↔ `client_key` in client events (rename confined to netad, tested in T3); cursor is adapter-opaque ms (sync.js untouched); `GrovePlatform` shape identical in T3 fakes, T4 bridge, and netad.
