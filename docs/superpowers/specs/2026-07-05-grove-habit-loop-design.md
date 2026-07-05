# Grove — The Habit Pass (+ voice/LLM provider ADR)

**Date:** 2026-07-05
**Status:** Approved for build (user directive). Provider ADR in §3.

## 1. Frame

The Hook model (trigger → action → variable reward → investment) and Fogg's tiny-habits
research (anchor prompts, celebration emotion) applied to what Grove already does well
(tiny steps, grace streaks, social warmth). Everything below is anti-shame by
construction — variability delights, never punishes.

## 2. What we build

| Hook stage | Feature | Mechanics |
|---|---|---|
| Trigger (external) | **Garden time reminder** | She picks a local hour in settings; an hourly cron pushes "your garden time 🌿" to claimed accounts — only if she hasn't been active today, never in quiet mode, max once/day. |
| Trigger (context) | **Goal anchors** | Planting asks (optionally) *when* — morning ☀️ / midday 🌤️ / evening 🌙; Today shows the anchor beside each step (implementation-intention prompt). |
| Action | (already tiny steps) | — |
| Variable reward | **Lucky petals** | On a completed step: 12% chance of 🍀 +8 bonus petals, 3% chance of ✨ golden seed +20. Seeded-RNG testable; amounts small and gentle. |
| Reward (emotion) | **Petal burst** | A half-second petal-fall animation at the checkbox on every completion (Fogg: celebration wires the habit). |
| Reward (visibility) | **Week strip** | Mon–Sun dots on Today showing this week's active days (soft, never red); needs a new `activeDays` history (last 21 day-keys). |
| Reward (social) | **Keeper notes card** | Notes now persist to a dismissible Today card (`keeperNotes`, cap 5) instead of evaporating as toasts — warmth waits for her return. |
| Investment | **Next-seed prompt** | When her last active goal blooms, the wizard opens itself: reflection → plant the next seed in one breath. |

State: defensive additions, no schema bump — `activeDays: []`, `keeperNotes: []`,
`reminderHour`, per-goal `anchor`. Backend: `member.reminderUtcHour` (+ route),
new hourly cron `grove-reminder-hourly` (UTC) beside the nightly keeper round;
reminder sends log as `nudges` rows (`source: 'reminder'`) so the Studio sees them.

## 3. ADR — OpenRouter / LiveKit / Groq

**Decision: none today; seams documented.** Grove's intelligence runs on the platform's
integrated AI (no keys, budgeted, live-verified). Adding a provider means an external
account, keys via the secrets flow, and unverifiable-without-key code paths.

- **Groq** — first candidate to adopt. Trigger: dictation/transcription quality or
  latency complaints. Plan: `GROQ_API_KEY` via secrets → `/api/ai/transcribe` prefers
  Groq Whisper (multipart POST from backend) with platform AI as fallback. One session
  to wire + verify once a key exists.
- **LiveKit** — adopt when live audio rooms matter (natural fit: pro-mentor sessions,
  phase 5b). Provides the TURN/SFU infrastructure that made live rooms out of scope.
  Requires account, token-minting route, client SDK.
- **OpenRouter** — adopt only if platform AI cost/model-quality becomes limiting;
  would slot behind the same `generate()` helper in `backend/index.ts` (single choke
  point, so the swap is contained).

## 4. Success criteria

Lucky rewards and week-strip logic unit-tested (seeded); reminder cron registered and
its route member-gated; notes card survives reload and dismisses; anchors flow
wizard → goal → Today; petal burst visible; all deployed with e2e ≥ 9/10.
