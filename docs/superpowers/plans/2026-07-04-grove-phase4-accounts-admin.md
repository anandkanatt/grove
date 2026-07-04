# Grove Phase 4 Implementation Plan — Accounts & Grove Keeper Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, this session). Spec: `docs/superpowers/specs/2026-07-04-grove-phase4-accounts-admin-design.md`.

**Goal:** Progressive account prompt + cloud backup, admin dashboard with aggregated insights + interventions, manual & cron workflow nudges — on the App Deploy platform.

**Architecture:** Pure trigger/backup logic in logic.js/state.js (Node-TDD). Backend grows auth-gated account/backup/nudge/admin routes + one daily cron (sentiment via ai.classify + workflow nudges). Bridge exposes platform `auth`; netad gains account/admin/nudge calls. New js/admin.js renders `#admin`. ADMIN_EMAILS = ['anandkanatt@gmail.com'] (SDK allowlist middleware).

**Scope cuts (explicit):** push notifications channel, solo-player event streams (accounts back up saves but don't stream events), payments — all later phases. Nudges deliver to circle members in-game.

---

### T1 Pure logic (TDD)
- `state v5`: `account {userId,email,linkedAt,backupPrivateGoals,lastBackupDay}`, `accountPrompt {shown:{},claimed}`, `quiet:false`; migrate v4→v5; isValid accepts 1–5. Tests: default+migration.
- `L.claimTrigger(state)` → `'circle'|'first-bloom'|'streak-7'|null`; null when account linked, prompt claimed, or trigger already in `accountPrompt.shown`. Tests: each trigger, precedence (circle first), suppression rules.
- `S.backupBlob(state, includePrivate)` → JSON string; private goals + their journal entries stripped unless included; parses as valid importable save. Tests.
- `Social.buildStepEvent/buildBloomEvent` carry `domain` (category id only). Adjust any payload-shape tests.

### T2 Backend
- `grove.ts`: `NUDGE_TEMPLATES` (stalled/struggle-support pools, warm), `pickNudge(kind, name, seed)`, `SENTIMENT_LABELS=['upbeat','steady','strained']`, day-bucket helper.
- `index.ts`: `ADMIN_EMAILS=['anandkanatt@gmail.com']`; `addEvent` also stamps `member.lastEventAt`.
  Routes: `POST /api/account/link` [requireAuth] (verify member creds → member.userId); `POST/GET /api/account/backup` [requireAuth] (upsert/read `backups` row ≤200KB, scoped by ctx.user.userId); `POST /api/circles/:id/quiet` (memberKey auth); `GET /api/circles/:id/nudges` (memberKey auth → undelivered for member/circle, mark delivered); admin: `GET /api/admin/overview`, `GET /api/admin/interventions`, `POST /api/admin/nudge` [requireAuth+allowlist] — aggregates scan circles/members/events/aiUsage/sentimentDaily (events already ≤200/circle; scale note in comment). Interventions: stalled ≥7d (lastEventAt), struggles unsupported >48h, aiUsage at cap — names+flower only.
- `cron.json`: `grove-keeper-daily` @ `30 2 * * *` Asia/Kolkata → exported `groveKeeperDaily`: (1) classify yesterday's struggle/boost texts (≤20, NONE thinking) → `sentimentDaily`; 429 → skip; (2) workflow nudges: stalled ≥7d & !quiet & not nudged ≤7d → 1 templated nudge; unsupported struggle >48h → nudge circle-mates; all logged rows `source:'workflow'`. Returns `{statusCode:200}`.

### T3 Bridge & adapter
- `src/main.ts`: expose `auth` too.
- `netad.js`: `account.link/backupPush/backupPull`, `nudges(circleId,…)`, `setQuiet`, `admin.overview/interventions/nudge` (api.* auto-bearer).
- `appdeploy.auth-login.json`: grove-styled (headline “Claim your grove”, accent #c66b8e, bg #faf6ef, light, radius 16).
- `tools/pack-appdeploy.js`: add `cron.json`, `appdeploy.auth-login.json`.

### T4 Game UI
- Today: claim card when `claimTrigger()` fires & platform present — Claim → `auth.signIn` → link current circle membership → backup push → `account` set, toast; Not now → mark shown.
- Boot: platform+circle → pull nudges → rose toasts “🌿 A note from the grove keeper: …”; auto-backup once/day when linked.
- Settings: account row (status/claim/sign-out), Back up now, Restore from account (confirm → importJson→replaceState), include-🌙 checkbox, Quiet mode toggle (syncs member.quiet in circle).

### T5 Admin UI
- `main.js`: `#admin` + platform → `GroveAdmin.boot()` (game skipped). `index.html` loads `js/admin.js`.
- `js/admin.js`: sign-in gate → overview (stat blocks, 14-day SVG bars, domains, sentiment stacked, whisperer usage) + interventions lists with “Send note” composer → POST nudge; 403 → locked-gate copy; refresh.
- CSS: reuse cards; small admin additions.

### T6 e2e (tests.txt → 10 total)
- Test 9: claim card appears after first bloom (platform), “not now” dismisses and stays dismissed after reload.
- Test 10: `#admin` unauthenticated shows the sign-in gate and no data.

### T7 Verify & ship
- `node tests/run-tests.js` green → pack → upload → deploy → poll; fix loop ≤3 on QA findings; Playwright spot-checks (claim card, admin gate); push master; memory; report.

## Self-review
- Spec coverage: triggers→T1/T4; backup→T1/T2/T4; admin panels/interventions→T2/T5; comms manual+workflow→T2/T5; sentiment→T2; privacy (aggregates/pseudonyms, 🌙 strip)→T1/T2; health→overview; quiet-mode→T2/T4. Cuts declared up top.
- Names pinned: `claimTrigger`, `backupBlob`, `accountPrompt.shown`, `groveKeeperDaily`, tables `backups/nudges/sentimentDaily`.
