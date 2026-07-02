# Grove 🌿

*Grow your goals, together.*

Grove is a cozy browser game that turns real-life goals into a living garden.
Every goal you plant is a seed. Every tiny real-world step you take waters it —
from sprout, to bud, to a radiant bloom that lives forever in your Meadow.
You grow alongside a Circle of five women with goals of their own: they cheer
your steps, and sometimes they struggle and need *your* encouragement.

## How to play

**Just open [index.html](index.html) in any browser.** No install, no account,
no internet needed. Your garden lives entirely in your own browser
(with export/import for backups).

1. **Plant a goal** — pick a path (career, fitness, learning, money, wellbeing,
   creative) or write your own, broken into tiny steps that each fit in a day.
2. **Do a step in real life, then check it off** — your plant grows, you earn
   petals 🌸 and xp, and your streak warms up 🔥.
3. **Visit your Circle** — cheer the others on (it earns you as much warmth as
   your own steps), and help anyone who's having a rough week.
4. **Win the week together** — the Weekly Bloom Challenge counts *everyone's*
   steps toward one shared garden. No leaderboards, no losers.
5. **Spend petals** in the shop on butterflies, lanterns, a gnome named Beatrix.

## Design principles

- **Tiny steps beat big plans.** Templates ship with implementation-intention
  style steps ("Put on shoes and walk-run for 10 minutes"), not vague ambitions.
- **Grace, not shame.** Dew Shields 💧 auto-protect missed days; coming back
  after a break earns a *badge* (The Return), never a guilt trip.
- **Cooperative, not competitive.** Player-motivation research consistently
  finds women players over-index on completion, customization, and social
  play — so Grove's community mechanics are collective challenges and
  mutual support, never head-to-head rankings.
- **Giving support is gameplay.** Sunshine sent is tracked as prominently as
  steps taken, and struggle→recovery arcs make encouragement matter.

## Development

```
node tests/run-tests.js     # 47 logic/sim/state tests, no dependencies
node tools/dev-server.js    # optional static server at http://localhost:8478
```

Plain HTML/CSS/JS, zero dependencies, no build step. Pure logic
(`js/logic.js`, `js/sim.js`, `js/state.js`) is unit-tested in Node; the DOM
layer (`js/ui.js`, `js/garden.js`) sits on top. All art is code-generated SVG.

| File | Responsibility |
|---|---|
| `js/data.js` | Content: goal templates, circle members & voices, copy, badges, shop |
| `js/logic.js` | Rules: xp/levels, streaks & shields, goal stages, challenge, badges |
| `js/sim.js` | The living Circle: catch-up activity, reactions, struggle arcs |
| `js/state.js` | Versioned localStorage persistence, export/import |
| `js/garden.js` | SVG art: plants by stage, avatars, decor, community garden |
| `js/ui.js` / `js/main.js` | Views, wizard, toasts, boot |

## v2: a real community

The Circle is simulated in v1 so the game is playable instantly and privately.
The feed is already event-shaped (append-only member events), so a real
backend can replace `sim.js` with a sync client one day. That needs accounts,
hosting, and moderation — see
[docs/superpowers/specs/2026-07-02-grove-goal-garden-design.md](docs/superpowers/specs/2026-07-02-grove-goal-garden-design.md)
for the design notes.
