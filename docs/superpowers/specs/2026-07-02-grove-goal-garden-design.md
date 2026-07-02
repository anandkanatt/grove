# Grove — Design Document

**Date:** 2026-07-02
**Status:** Approved for implementation (autonomous session — decisions documented as revisable defaults)
**Tagline:** *Grow your goals, together.*

## 1. Brief

Build a game that encourages women players to achieve their real-life goals. Requirements from the brief:

1. It is a **game** (not a todo app with points sprinkled on top).
2. It **encourages women players** to achieve their goals.
3. It has a **community angle**.
4. It is **well gamified**.

## 2. Design questions and resolved answers

This was an autonomous session, so clarifying questions were resolved with documented defaults. Each is easy to change later.

| Question | Decision | Rationale |
|---|---|---|
| What kinds of goals? | Any personal goal. Six template domains — Career, Health & Fitness, Learning, Money, Wellbeing, Creative — plus fully custom goals. | The brief says "their goals," not a niche. Templates lower the blank-page cost. |
| Platform? | Zero-install browser game. Open `index.html`, no build step, no server, works offline. Mobile-responsive. | Playable immediately on any machine; nothing to deploy or install; user data never leaves the device. |
| Real or simulated community? | v1: simulated Circle of 5 members with distinct personalities who progress between sessions, cheer the player, and sometimes struggle and ask for support. v2 (documented, not built): real backend. | A real multi-user service needs auth, hosting, moderation, and privacy review — not shippable responsibly in one pass. The simulated Circle delivers the community *game loop* now, and the state layer is designed so a sync backend can replace the simulator. |
| Competitive or cooperative? | Cooperative-first. Collective weekly challenges, "together we…" framing, cheering as a first-class verb. No head-to-head ranking. | Large-sample player-motivation research (e.g., Quantic Foundry) finds women players over-index on completion, design/customization, fantasy, and social play, and under-index on competition. Accountability communities also work better supportive than adversarial. |
| Tone? | Warm, capable, never patronizing. No pink-washing, no "girl boss" clichés, no shame mechanics. | Respect is the feature. |

## 3. Approaches considered

**A. Grove — garden metaphor (chosen).** Every goal is a plant; doing a real-life step waters it; plants visibly grow from seed to radiant bloom; finished goals join a permanent Meadow. The community is a shared grove that flourishes from everyone's collective effort.
*Pros:* growth is the perfect visual for progress; nurture loop is proven sticky (Forest, Finch); supports beautiful pure-SVG art with no image assets; naturally cooperative; customization-friendly.
*Cons:* garden metaphor is well-trodden — mitigated by the community grove and goal-science mechanics.

**B. Constellation — night-sky metaphor.** Each goal is a constellation; each step lights a star; the community shares one sky.
*Pros:* elegant, less common, gorgeous dark UI. *Cons:* abstract; weaker nurture satisfaction; harder to read progress at a glance.

**C. Guild RPG.** Player is a heroine in a guild; goals are quests; steps are quest stages; guildmates run guild challenges.
*Pros:* classic gamification, strong identity fantasy. *Cons:* grindy tropes, higher art demands, competition creeps in structurally.

**Chosen: A.** Strongest progress-visualization, warmest community mapping, best art-per-effort ratio.

## 4. Game design

### 4.1 Core loop (daily)

1. Open Grove → **Today** view shows a short list of tiny steps across active goals.
2. Complete a real-life step → check it off → the plant visibly grows, petals (currency) and XP awarded, a varied affirmation appears.
3. Circle feed shows what Circle members did since last visit; the player can **cheer** them (send sunshine ☀). Sometimes a member is struggling and asks for encouragement — supporting others is a scored, first-class action.
4. Weekly collective challenge ticks up from everyone's steps (player + Circle). Hitting the target grows the shared Community Garden and awards a rare seed.

### 4.2 Goal model (goal science, gamified)

- A **goal** = a plant with a name, domain, target number of steps, and growth stages: seed → sprout → bud → bloom → radiant bloom.
- Goals are created from templates or custom. Templates suggest **tiny steps** (implementation-intention style: concrete, small, repeatable) — e.g., "Run a 5K" suggests "Put on running shoes and walk/run 10 minutes."
- Steps are deliberately small. The game says so out loud: small steps, taken often, beat big plans.
- Completing all steps **blooms** the goal: celebration, a permanent plant in the **Meadow** (trophy garden), and a one-line **reflection** saved to the Journal ("Growth Rings").

### 4.3 Gamification systems

| System | Mechanic | Anti-shame rule |
|---|---|---|
| XP & Levels | XP per step, per cheer, per bloom. Levels carry titles: Seedling → Sprout → Gardener → Bloomkeeper → Grove Keeper → Meadow Maker → Wildflower → Forest Heart. | Levels only ever go up. |
| Petals (currency) | Earned per step/challenge. Spent in the **Shop** on garden decor (butterflies, lanterns, fountain, arch…) and seed varieties. | Nothing gameplay-critical is gated. |
| Streaks | Daily streak for completing ≥1 step. **Dew Shields** auto-protect a missed day; one is earned each 7-day week of activity (max 3 held). | A missed day with no shield resets quietly — copy never scolds. A **Comeback badge** celebrates returning after 3+ days away. |
| Badges | First step, first bloom, 7/30-day streaks, 10 cheers sent, comeback, challenge wins, each domain's first bloom, etc. | Badges reward giving support, not just achieving. |
| Weekly Challenge | Collective target (e.g., "Together, 60 steps this week"). Everyone's steps count. Reward: rare seed + community garden growth. | Target scales so it is reachable; framing is "we," never ranks. |
| Customization | Decor placement in the garden; player picks a flower avatar and palette accent at onboarding. | — |

### 4.4 Community design (v1 simulated)

- **Circle of 5 members**, distinct names/avatars/voices, each with their own goals in different domains and different consistency profiles (one is very steady, one is a comeback-prone struggler, etc.).
- **Offline simulation:** on load, the time elapsed since the last visit is converted into member activity events with plausible timestamps (steps taken, blooms, struggles, recoveries) that populate the **Circle feed**.
- Members **react to the player's real actions**: after the player completes steps, cheers arrive from members with varied, personality-consistent messages (never the same canned line twice in a row).
- **Struggle events:** a member occasionally posts that she's stuck. The player can send encouragement; the member later posts a recovery that credits the support. Giving support grants XP/petals and counts toward badges.
- **Sunshine sent** is a visible lifetime kindness stat, equal in prominence to steps taken.

### 4.5 What "game" means here — the fantasy

The player is tending a living garden that only real-life action can grow. The fantasy is *becoming someone who follows through, visibly, in good company*. Every screen reinforces: effort → growth → beauty → shared celebration.

## 5. Architecture

### 5.1 Stack

- **Vanilla HTML/CSS/JS, no build step, no dependencies.** Plain `<script>` tags (not ES modules) so `file://` double-click works in every browser.
- All art is **inline SVG generated by code** (plant growth stages, avatars, decor) — zero binary assets.
- **Node is used only for tests** (core logic files are dual-environment: browser global + CommonJS export guard).

### 5.2 Files

```
index.html          shell, view containers, script tags
css/style.css       full styling, responsive, botanical palette
js/data.js          content: goal templates, tiny-step suggestions, circle
                    member definitions, message pools, badges, shop items
js/logic.js         PURE game logic (no DOM): XP/levels, streak+shield rules,
                    petals, goal state machine, badge evaluation, challenge math
js/sim.js           PURE circle simulation (no DOM): elapsed-time event
                    generation, member reactions, struggle/recovery arcs
js/state.js         state shape, versioned persistence, localStorage,
                    export/import JSON
js/garden.js        SVG renderers: plants by stage, avatars, decor, meadow
js/ui.js            view rendering + event wiring (Today, Garden, Circle,
                    Challenge, Journal, Shop, Badges, onboarding)
js/main.js          boot: load state, run sim catch-up, route, render
tests/run-tests.js  Node test runner for logic.js, sim.js, state schema
```

### 5.3 State (localStorage, versioned)

```js
{
  version: 1,
  player: { name, avatarId, accentId, createdAt },
  xp, petals, level,                 // level derived, cached
  streak: { count, lastActiveDay, shields },
  goals: [ { id, name, domain, emoji, steps: [{id, text, done, doneAt}],
             stage, createdAt, bloomedAt, reflection } ],
  journal: [ { day, text, goalId } ],
  badges: { [badgeId]: earnedAt },
  decor: [ { itemId, x, y } ],
  shopOwned: [itemId],
  sunshineSent: n,
  circle: { members: [{ id, ...runtime state }], feed: [events],
            challenge: { weekKey, target, progress, rewarded } },
  lastVisit: timestamp
}
```

Export/import buttons give the player full data ownership. `version` field enables future migrations.

### 5.4 Error handling

- Corrupt/missing localStorage → fresh onboarding, never a crash (try/catch parse with schema check).
- Import validates schema version and required keys before replacing state.
- Sim catch-up is capped (long absences generate a bounded digest, not 10,000 events).
- All time math uses local calendar days (streaks respect timezones implicitly).

### 5.5 Testing

- `node tests/run-tests.js` — a tiny assert harness, no framework.
- Covered: XP/level thresholds, streak transitions (same-day, next-day, gap+shield, gap+no-shield), shield earn/cap, goal stage transitions, bloom detection, badge triggers, challenge week-key/target/progress math, sim event generation bounds + determinism given a seeded RNG, state save/load round-trip, import validation.
- UI is verified manually in-browser (documented checklist in the plan).

## 6. v2 path (not in scope, architecture-ready)

Real community: replace `sim.js` with a sync client; `circle.feed` and cheer/struggle events map 1:1 to a small event API (append-only event log per circle). Needs: auth, hosting, abuse/moderation tooling, privacy policy. The state layer's event-shaped feed is deliberately compatible.

## 7. Success criteria

- Opens from `file://` with zero install; onboarding to first completed step in under 2 minutes.
- A returning player (next day / after a week) sees a living, changed grove and a warm re-entry — never a guilt trip.
- All logic tests pass via `node tests/run-tests.js`.
- The community angle is *playable*: cheering, being cheered, collective challenge, visible shared garden.
