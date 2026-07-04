# Grove Phase 5 — Mentors in the Circle (AI personas & real professionals)

**Date:** 2026-07-04
**Status:** Designed, awaiting build approval (requirements from Anand, 2026-07-04)
**Depends on:** Phase 4 (accounts — pro mentors need identity; AI mentor only needs Phase 3)

## 1. Brief (as requested)

- A **mentor/coach** can join your circle and help you. It is either a fully
  **AI persona** or a **real person, a professional**.
- The AI persona is **customizable**, and can **replace the current simulated
  members** — a circle becomes: autonomous characters + real friends + real
  or AI mentors.
- **Each seat kind has distinct verbs**: friends support and cheer you; the AI
  mentor writes, revises, and assesses your plan; the real mentor can (in the
  future) take payments and help online or offline — the human aspect of the
  platform.
- Mentor interaction modes: **Explore, Chat, and Voice.**

## 2. Seat model

`Social.roster` grows from two seat kinds to four:

| Kind | Who | Verbs | Labeled as |
|---|---|---|---|
| `real` | invited friend | cheer, support, boost replies | "real" ribbon (exists) |
| `sim` | garden spirit | ambient warmth, struggle arcs | "garden spirit" (exists) |
| `ai-mentor` | customizable persona | plan, revise, assess, weekly review, check-ins, chat | "mentor · AI" ribbon |
| `pro-mentor` | verified professional | everything a friend can + structured feedback, sessions, (future) payments | "mentor · pro" ribbon |

Players control seat allocation in Circle settings (e.g., swap spirits for a
mentor, or run all five seats as spirits exactly as today). Honesty rule
stands: an AI is always labeled AI.

## 3. The AI mentor

- **Customizable persona:** name, flower avatar, tone slider (gentle ↔
  direct), focus domain, check-in cadence (daily / weekly / only-when-asked).
  Stored in state + mirrored to the circle so friends see the same mentor.
- **Distinct powers** (all consent-gated by the existing Whisperer consent,
  each output editable before it touches her garden):
  - **Plan** — turn a named ambition into 6–10 tiny steps (existing coach,
    re-homed under the mentor).
  - **Assess** — score her current plan: too-big steps flagged, missing
    first-step, stale steps; returns specific rewrites.
  - **Revise** — propose a diff to the plan (add/replace/split steps);
    she approves per-step.
  - **Weekly review** — reads her week's events, returns 3 observations +
    1 gentle adjustment (cron, respects quiet mode).
  - **Chat** — bounded conversation about goals with persona memory
    (rolling summary, not transcripts).
- **Interaction modes:** *Explore* (guided goal-discovery wizard: five warm
  questions → suggested goal + plan), *Chat* (text), *Voice* (existing
  speak/dictate stack over chat).
- **Budget:** separate mentor budget (default 20 calls/member/day) on the
  aiUsage rails; proactive messages capped at 1/day.

## 4. The real (professional) mentor

- **Identity:** requires a Phase-4 account flagged `mentor` after manual
  vetting (v1: allowlist set by admin; marketplace later).
- **Joining:** a dedicated mentor invite (distinct from friend codes) so a
  circle explicitly chooses to admit a professional.
- **Powers v1 (no money movement):** see consented mentee data (garden
  overview, non-private goals, weekly digest), structured feedback via the
  same assess/revise UI (human-authored), session scheduling (share a
  meeting link or "offline session" note), private mentor⇄mentee thread.
- **Payments (explicitly future):** design seam only — an `engagements`
  table (mentor, mentee, package, status) with provider integration
  deferred; no provider chosen in this spec.
- **Trust rails:** mentee can revoke mentor access instantly; every mentor
  read/write is logged and visible to the mentee; mentors never see 🌙
  private goals or other members' data beyond the shared feed.

## 5. Rollout

1. **5a — AI mentor** (pure software, builds on Whisperer): seat kind,
   persona editor, plan/assess/revise/review/chat, Explore wizard.
2. **5b — Pro mentor without payments:** vetting flag, mentor invite,
   consented visibility, feedback tools, scheduling.
3. **5c — Payments** on the engagement seam once a provider is chosen.

## 6. Out of scope

Marketplace discovery/search, mentor ratings, payouts/tax handling, video
calling (links only), group coaching.

## 7. Success criteria

- A circle can run any mix (e.g., 2 friends + 1 AI mentor + 2 spirits) and
  every card is truthfully labeled.
- The AI mentor's assess/revise outputs are always editable-before-apply, and
  her plan never changes without an explicit approve tap.
- A pro mentor sees exactly what the consent screen says — verified by a
  route-by-route privacy checklist.
- Removing a mentor (AI or pro) restores spirits and deletes mentor access
  in one tap.
