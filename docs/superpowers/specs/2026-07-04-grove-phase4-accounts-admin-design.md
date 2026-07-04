# Grove Phase 4 — Progressive Accounts & the Grove Keeper's Dashboard

**Date:** 2026-07-04
**Status:** Designed, awaiting build approval (requirements from Anand, 2026-07-04; defaults chosen where unstated)
**Depends on:** Phase 3 (App Deploy platform, Whisperer)

## 1. Brief (as requested)

1. The app stays **login-free at first**; once a player is "serious enough into
   the actions," she should create an account.
2. An **admin interface** with a dashboard of users and "interesting insights
   into the users and the user behaviors."
3. **Aggregated information only — no personal information** — covering overall
   system health, sentiments, goal progress, and insight into goals.
4. The dashboard should reveal **who needs intervention** (technical trouble or
   goal trouble) and support **sending communications** — on a workflow
   (automated) basis or manually — to push them forward.

## 2. Resolved design questions

| Question | Decision (default) | Rationale |
|---|---|---|
| When is "serious enough"? | First of: **first bloom**, **7-day streak**, or **creating/joining a circle**. Soft, dismissible prompt; re-offered at the next trigger; never blocks play. | Those are the three moments of demonstrated investment. Nagging kills warmth. |
| What does an account give her? | Cross-device sync, recovery if the browser save is lost, portable circle identity. | Honest value, stated plainly in the prompt. |
| Auth mechanism | Platform `auth` feature (exact flow per SDK reference at build time). Anonymous play remains first-class forever. | Zero credential handling of our own. |
| What syncs to an account | The local save blob, with 🌙 **private goals stripped by default** (checkbox to include them). | Cloud backup is her data in her account, but private-by-default stays the brand promise. |
| Admin access control | Platform auth + an `ADMIN_EMAILS` allowlist held in platform `secrets`; `#admin` hash route in the same app. | No second deployment; secrets flow is platform-sanctioned. |
| New tracking? | **None for circle players** — aggregates come from data that already exists (circles, members, events, aiUsage). Account-holding solo players start sending the same event types (step/bloom/struggle/recover) with no goal text. | "Aggregated only, no personal information" is easiest to honor by not collecting more. |

## 3. Progressive accounts

- Trigger fires → a gentle card: *"Your grove is growing. Claim it, so it can
  follow you anywhere."* Buttons: **Claim my grove** / *not now*.
- Account creation links: her memberKey(s), the save backup, and (later) admin
  comms routing. Nothing else changes; the game plays identically.
- `state.account = { userId, linkedAt, backupPrivateGoals: false }` (state v5).
- Declining forever is fine; the prompt appears at most once per trigger type.

## 4. The Grove Keeper's Dashboard (`#admin`)

All panels show **aggregates or pseudonyms only** (a member is "Sofia 🌻 in
circle #a41f" — first name + flower is all the system ever has). No goal
texts, no boost texts, no emails on screen.

### 4.1 Panels

1. **Health** — DAU/WAU/MAU (distinct members with events), new members/day,
   circles created/day, backend error count/day (new lightweight counter
   table), push failure rate.
2. **Goals** — planted vs bloomed by domain, median steps-to-bloom, active
   goal age distribution, abandonment rate (no step in 14 days).
3. **Community** — circle-size distribution, cheers/day, struggle posts/day,
   median time-to-first-support, struggle→recovery rate.
4. **Sentiment** — daily cron classifies recent struggle/boost texts with
   `ai.classify` into `upbeat / steady / strained`; the dashboard shows only
   the counts trend, never the texts.
5. **Whisperer** — AI calls by route/day vs caps, consent adoption.
6. **Intervention lists** (pseudonymous, the "where do we step in" view):
   - *Goal trouble:* stalled members (no activity ≥7d), circles with an
     unsupported struggle >48h, repeated streak resets.
   - *Technical trouble:* members with repeated failed event pushes or
     4xx/5xx bursts (new per-day counter), AI-cap collisions.

### 4.2 Communications ("push them forward")

- **Channels:** (a) *Grove Keeper note* — a warm in-game note delivered on the
  member's next visit (server `nudges` table, pulled during sync/boot);
  (b) platform `notifications` push, where granted.
- **Manual:** from any intervention list, pick member/cohort → template or
  custom text → send; every send is logged and visible in the dashboard.
- **Workflow (cron, daily):**
  - stalled ≥7d → one gentle nudge (template pool, never guilt),
  - struggle unsupported ≥48h → nudge her circle-mates, not her,
  - caps: max 1 automated nudge per member per week; per-member "quiet mode"
    opt-out honored everywhere; all sends logged.
- Copy tone rules follow `GROVE_TONE`: warm, no shame, no streak-guilt.

## 5. Architecture notes

- Backend: new tables `nudges`, `dailyCounters`, `sentimentDaily`; new routes
  `GET /api/admin/overview`, `GET /api/admin/interventions`,
  `POST /api/admin/nudge` (auth: platform user ∈ ADMIN_EMAILS); `cron.json`
  daily job for counters + sentiment + workflow nudges.
- Frontend: `#admin` route renders dashboard panels as SVG charts in the
  existing garden aesthetic; no external chart libs.
- Solo-account event flow reuses the circle event schema with a personal
  stream id, so every aggregate query is one code path.

## 6. Out of scope (phase 4)

Payments, mentors (phase 5), email campaigns, raw-text browsing of any
player content.

## 7. Success criteria

- A never-logged-in player can still do everything she could in phase 3.
- The account prompt appears only at the three trigger moments and never again
  after "claim" or three dismissals.
- Admin dashboard loads from aggregates only; a reviewer can confirm no
  route returns goal/boost text to the admin UI.
- One manual nudge and one workflow nudge measurably arrive in-game.
