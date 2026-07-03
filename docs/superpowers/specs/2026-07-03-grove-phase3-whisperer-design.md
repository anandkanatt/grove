# Grove Phase 3 — The Grove Whisperer: Design Document

**Date:** 2026-07-03
**Status:** Approved by user (interactive brainstorm)
**Builds on:** `2026-07-03-grove-phase2-real-circles-design.md` (shipped on branch `real-circles`)

## 1. Brief

Bring AI into Grove — and move the whole game onto the **App Deploy** platform,
whose backend SDK provides LLM access (`ai.generate`), a key-value database,
an invite-code lifecycle, and hosting in one place. The grove owner's setup
drops to **zero**: no Supabase account, no schema paste, no keepalive, and no
AI API key — the platform meters AI itself.

## 2. Design questions and resolved answers

| Question | Decision | Rationale |
|---|---|---|
| Which AI modalities? | **Text** (LLM) as the core; **audio** via the free browser Web Speech API; **video: rejected** — slow, costly, off the SVG aesthetic. Bloom celebrations stay procedural SVG. | Value per effort; brand fit. |
| Which AI features? | Goal coach (draft tiny steps), personalized encouragement (daily affirmation + contextual cheers), boost reply suggestions, Growth Rings insights. Voice dictation + spoken affirmation. | User picked the full text bundle + free audio. |
| AI provider? | **App Deploy `ai.generate`** — platform-metered, no user key. (Earlier options — Anthropic/OpenAI/Gemini via Supabase Edge Functions — superseded by the platform choice.) | User: “lets use appdeploy service.” |
| Architecture? | **A: all-in on App Deploy** — html-static frontend + TypeScript backend; circles move to platform `db` + `invites`. Hybrid (external site calling App Deploy) fights the platform's client-injection contract; Supabase Edge Functions would reintroduce key management. | Platform contract read in full before deciding. |
| Accounts? | **Anonymous** (`invites` `authMode:'anonymous'` + server-minted per-member secret). No Google/Apple/X sign-in. | Preserves “no accounts, just a name and a flower.” |
| Who gets AI? | **Circle members only**, with a per-circle daily cap. Solo/mirror players see no AI surface. | An anonymous, unlimited public AI endpoint is an abuse magnet; framing: *the whisperer lives in real groves*. |
| Fate of Phase 2 Supabase stack? | Kept as a working alternative. The client picks its backend at boot: platform host → App Deploy adapter; `GroveConfig.SUPABASE_URL` set → existing net.js; neither → solo v1. GitHub Pages remains the solo/self-host mirror. | Zero regression; self-hosters keep a path; new default is App Deploy. |
| Existing circle data? | No migration. App Deploy circles start fresh; Supabase circles keep working on the mirror. Flagged, not silent. | Circles are days old; migration machinery is not worth it. |

## 3. Approaches considered

**A. All-in on App Deploy (chosen).** One platform for hosting, circles, and
AI. Phase 2's seams pay off: `sync.js`/`social.js` take an injected client, so
only a thin adapter is new; logic/sim/state carry over.
**B. Hybrid (GitHub Pages client + App Deploy AI backend).** Rejected: the
platform requires its frontends to call backends via the injected
`@appdeploy/client` on its own host; external-origin fetch is unsupported.
**C. Supabase Edge Functions + owner's Anthropic key.** Sound but keeps
account/key friction the user explicitly chose to avoid.

## 4. Game design

### 4.1 The Whisperer (AI features, all opt-in)

| Feature | Where | Contract |
|---|---|---|
| **Goal coach** | Wizard: “🪄 draft my tiny steps” on the custom-goal path (and a “re-draft” on templates) | Input: goal name + domain. Output: 6–10 implementation-intention steps, each fitting in a day, editable before planting. |
| **Daily whisper** | Today view affirmation slot | Once per local day per device, personalized to active goals/streak; cached in state; silently falls back to static `AFFIRMATIONS` when unavailable. |
| **Contextual cheer** | A small “✨ make it personal” button rendered beside the existing one-tap “Send sunshine” on real members' feed items — the curated one-tap stays the default | One warm line ≤120 chars referencing the friend's goal title; sent through the normal cheer event. |
| **Boost replies** | Friend's struggle card: “suggest a reply” | Three distinct warm replies ≤140 chars; player picks/edits one; sending uses the normal cheer event. |
| **Growth Rings insights** | More → Growth Rings: “what do my rings say?” | 3–4 sentence reflection from the last ≤10 journal entries + step-timing stats. On demand only. |
| **Voice** | Mic button on journal/boost inputs; speaker on affirmation | Browser Web Speech API (`SpeechRecognition`/`speechSynthesis`), feature-detected, hidden when unsupported. No server, no cost. |

### 4.2 Consent & privacy rules

- One-time **consent modal** on first AI-button tap: goal titles and journal
  text you choose to analyze are sent to the platform's AI; nothing is sent
  until you tap an AI button. Stored as `state.aiConsent`; revocable in
  Settings.
- 🌙 **Private goals are never included** in any AI payload (coach on your own
  private goal is allowed — you asked about your own text; its title still
  never reaches other members).
- Step text never syncs (unchanged); AI never sees other members' boost text
  except when *you* tap “suggest a reply” on that specific card.
- Anti-shame tone rules ship as the system prompt on every AI route.

### 4.3 Rate & cost guardrails

`aiUsage` table caps AI calls at **40/circle/day** (coach 5/member/day).
Cap hit → HTTP 429 → warm copy: “The whisperer is resting — try again
tomorrow 🌙”. `thinkingMode:'NONE'`, `maxTokens ≤ 500`, temperatures 0.6–0.8.

## 5. Architecture

### 5.1 Platform app

`app_type: frontend+backend`, `frontend_template: html-static`,
`features: [api, database, invites, ai.generate]`. The existing plain-script
client ships as the frontend (template's index.html replaced by ours). The
platform injects `@appdeploy/client`; the exact exposure for html-static apps
is read from `get_app_template` output at implementation time and bound inside
the adapter only.

### 5.2 Backend (`backend/index.ts`, platform SDK)

**Tables** (`db` KV, auto ids):

```
circles: { name, createdAt, lastEventAt }        // lastEventAt: monotonic nudge
members: { circleId, memberKey, name, avatarId, accentId, joinedAt }
events:  { circleId, memberId, clientKey, type, payload, createdAt }
aiUsage: { circleId, day, count, byMember: {memberId: n} }
```

**Anonymous identity:** creating/joining mints a `memberKey` (uuid) returned
once and stored on-device; every write carries `memberId + memberKey`, which
the backend verifies. Same capability-trust level as Phase 2's anonymous auth.

**Routes** (platform `router`; all bodies JSON):

```
POST /api/circles                {name, member:{name,avatarId,accentId}}
  → invites.create({resourceType:'circle', authMode:'anonymous',
                    context:{circleId}})
  → {circleId, circleName, inviteCode, memberId, memberKey}
POST /api/circles/join           {code, member:{...}}
  → invites.resolve/join (anonymous) → cap 5 real members → join event
  → {circleId, circleName, inviteCode, memberId, memberKey, members[]}
GET  /api/circles/:id/members    ?memberId&memberKey → {members[]}
POST /api/circles/:id/events     {memberId, memberKey, events:[{clientKey,type,payload}]}
  → verify member; dedupe on clientKey; stamp createdAt (nudged +1ms via
    circles.lastEventAt when equal — best-effort monotonic for tiny circles);
    prune history to last 200 events per circle
GET  /api/circles/:id/events     ?since=<ms>&memberId&memberKey
  → events with createdAt > since, sorted asc (db.list by circleId filter,
    paginated fully, filtered in code — small tables by design)
POST /api/circles/:id/leave      {memberId, memberKey} → leave event + delete member
POST /api/ai/steps               {memberId, memberKey, circleId, goalName, domain}
  → ai.generate schema {steps: string[6..10]}
POST /api/ai/cheer               {…, toName, goalTitle|null, kind:'daily'|'step'|'struggle'}
  → {line}
POST /api/ai/boost-replies       {…, struggleText} → {replies: string[3]}
POST /api/ai/insights            {…, reflections[≤10], stats} → {text}
```

Event types, payloads, and the append-only/dedupe semantics are **identical to
Phase 2** — the shared event model is the contract both backends implement.

### 5.3 Client adapter seam

New `js/netad.js` — `GroveNetAppDeploy.makeClient({apiFn})` implementing the
same surface as the Supabase client, plus two additions both clients gain:

```
client.kind                   'appdeploy' | 'supabase'
client.buildInviteLink(code)  appdeploy → invitesClient.buildJoinUrl(code, {path})
                              supabase  → origin + pathname + '#join=' + code
client.ai                     appdeploy → {steps, cheer, boostReplies, insights}
                              supabase  → null   (AI surface hidden)
```

Adapter normalizes event rows to the Phase 2 wire shape
(`{id, member_id, type, payload, created_at}`) and defines its own cursor
(`createdAt` ms) — `sync.js` already treats the cursor as adapter-opaque.
**social.js, sync.js, logic.js, sim.js are untouched.**

Boot selection in `main.js`: platform client detected → App Deploy adapter;
else `GroveConfig.SUPABASE_URL` set → existing `GroveNet`; else solo. Join
deep-links: on-platform uses `invitesClient.getPendingCode()`; the mirror
keeps `#join=CODE`.

### 5.4 State (version 3)

`migrate` chain v1→v2→v3 adds: `net.platform: null|'appdeploy'|'supabase'`,
`net.memberKey: null|string`, `aiConsent: {enabled:false, notedAt:null}`,
`dailyWhisper: {day:null, text:null}`. Export/import carries all of it.

### 5.5 Error handling

- AI failures/caps → warm toasts; every AI surface has a non-AI fallback
  (static affirmations, curated cheer phrases, hand-written reply).
- Wrong/expired invite → existing warm join errors; `isInviteError` codes map
  onto `not-found`/`full`/`offline` copy.
- Platform offline → existing offline chip + outbox behavior (sync.js
  unchanged).
- Voice APIs feature-detected; buttons absent when unsupported.
- Backend never builds URLs; never trusts client identity without memberKey.

## 6. Testing

- **Local Node suite** (extends the 79): App Deploy adapter against a fake
  `api` object (route/shape/normalization/cursor), state v3 migration chain,
  AI-payload privacy rule (private goals excluded), consent gating logic.
  All Phase 1/2 tests keep passing (mirror behavior is a hard constraint).
- **Platform e2e** (`tests/tests.txt`, 3–10 scenarios, one `[sanity]`):
  load, onboarding, circle create shows invite chip, join via invite URL,
  step sync between two anonymous users, AI consent modal appears on first
  🪄 tap. AI content itself asserted loosely (presence, not wording).
- **Manual two-browser smoke** on the deployed app mirroring the Phase 2
  checklist plus the four AI features.

## 7. Ship list

`backend/index.ts` (+ small pure helpers file) · `js/netad.js` adapter ·
boot selection + invite-link/AI seams in `main.js`/`ui.js` · consent modal ·
wizard coach button · boost “suggest a reply” · Growth Rings insights card ·
daily whisper cache · Web Speech mic/speaker buttons · state v3 migration ·
`tests/tests.txt` · Node tests · README “One-click grove (App Deploy)”
section · deploy via `get_app_template` → `upload_assets` → `deploy_app` →
poll `get_app_status` green.

**Not in Phase 3:** realtime websockets, push notifications, `ai.image`
bloom cards, open-ended spirit chat, migration of existing Supabase circle
data, custom domains.

## 8. Success criteria

1. Deployed App Deploy app: two anonymous browsers create/join a circle via
   the platform invite URL; steps, cheers, boost→comeback all sync.
2. Goal coach returns 6–10 editable steps; caps enforce; consent gates every
   AI surface; private goals provably excluded (unit-tested).
3. GitHub Pages mirror with blank config still behaves exactly like v1, and
   Supabase config still works — full existing suite green.
4. Platform e2e QA green on the shipped deploy; no API keys anywhere in the
   repo or the app.
