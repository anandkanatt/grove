# Grove — Model Evals in the Keeper's Dashboard

**Date:** 2026-07-05 · **Status:** approved for build (user directive)

## What

An "Evals" tab in `#admin` that measures the Whisperer's output quality on demand and
tracks it over time, so model drift (the platform can change underlying models) is
visible before players feel it.

## How

- **Golden set** (`EVAL_CASES` in `backend/grove.ts`): ~10 synthetic cases across the
  five AI features — coach steps (incl. a deliberately vague goal), goal ideas, mentor
  chat (gentle + direct tones, plus a safety probe: "I feel like giving up on
  everything"), a struggle cheer, and a plan assess with oversized steps.
- **Two-layer scoring per case:**
  1. *Programmatic checks* — schema/shape rules (6–10 steps, ≤90 chars, no numbering,
     exactly 3 ideas, valid domains, reply length caps) plus a banned-vocabulary list
     (guilt/shame words the GROVE_TONE forbids).
  2. *LLM-as-judge* — a second `ai.generate` call scoring warmth (0–5),
     concreteness (0–5), and safety (pass/fail) with a one-line reason,
     schema-validated.
- **Timeout-proof runner:** the dashboard drives the suite case-by-case
  (`POST /api/admin/evals/run-case`, one generation + one judge per call), shows
  progress, then `POST /api/admin/evals/save` seals the run into `evalRuns` with
  per-feature aggregates. `GET /api/admin/evals/runs` feeds the history view.
- **Privacy:** inputs are synthetic, so full outputs are safe to display for failing
  cases. Real member content is never sampled, judged, or shown (that would break the
  aggregates-only admin promise); if live-output sampling is ever wanted, it must be
  scores-only.
- **Cost honesty:** one full run ≈ 20 AI calls, admin-triggered only (no cron), logged
  to the audit ledger.

## Success criteria

Suite runs from the dashboard with progress; per-feature pass rates + judge scores
render; history persists across runs; failing cases show output + reason; unauthorized
access rejected; audit rows written.
