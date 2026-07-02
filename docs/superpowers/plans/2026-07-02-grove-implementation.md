# Grove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Grove, a zero-install browser game where completing tiny real-life goal steps grows a garden, alongside a simulated supportive Circle — per `docs/superpowers/specs/2026-07-02-grove-goal-garden-design.md`.

**Architecture:** Plain-script vanilla JS (works on `file://`), pure logic/sim layers with CommonJS export guards so Node can test them headlessly, DOM layer on top, versioned localStorage state, all art as code-generated inline SVG.

**Tech Stack:** HTML/CSS/JS (no deps, no build). Node 24 only for `tests/run-tests.js`.

**Execution note (autonomous session):** tasks are tightly coupled (greenfield app), so this plan is executed inline in-session with test-gate checkpoints, not via per-task subagents. Content-heavy files (`data.js`, `ui.js`, `css`) are specified by exact shape/counts rather than duplicating their full text here; logic contracts and tests are pinned exactly.

---

## File structure

```
index.html            app shell: header HUD, nav tabs, view containers, script tags
css/style.css         botanical palette, responsive layout, animations
js/data.js            GroveData: domains, goal templates (+tiny steps), 5 circle
                      members (+message pools), affirmations, badges, shop, levels
js/logic.js           GroveLogic (pure): xp/levels, petals, streak+shields, goal
                      stages, step completion, badges, weekly challenge
js/sim.js             GroveSim (pure): seeded rng, catch-up event generation,
                      member reactions, struggle/recovery, cheering
js/state.js           GroveState: defaultState, save/load/validate/migrate,
                      export/import, injectable storage for tests
js/garden.js          GroveGarden: SVG builders — plant by stage, member avatars,
                      decor items, meadow, community garden
js/ui.js              GroveUI: render views (Onboarding, Today, Garden, Circle,
                      Challenge, Shop, Journal, Badges) + event delegation
js/main.js            boot: load → migrate → sim catch-up → render; tab routing
tests/run-tests.js    assert harness + all logic/sim/state tests (Node)
README.md             how to play, design summary, v2 backend path
.gitignore            nothing needed beyond OS junk (no node_modules ever)
```

### Pinned API contracts

```js
// logic.js  (browser: window.GroveLogic; node: module.exports)
XP = { STEP:10, CHEER:3, BLOOM:50, CHALLENGE:40 }
PETALS = { STEP:5, CHEER:2, BLOOM:25, CHALLENGE:30 }
LEVELS = [ {at:0,title:'Seedling'}, {at:60,title:'Sprout'}, {at:150,title:'Gardener'},
  {at:300,title:'Bloomkeeper'}, {at:500,title:'Grove Keeper'}, {at:800,title:'Meadow Maker'},
  {at:1200,title:'Wildflower'}, {at:1800,title:'Forest Heart'} ]
levelForXp(xp) -> { level:1-based, title, at, nextAt|null, progress:0..1 }
dayKey(ts) -> 'YYYY-MM-DD' (local time)
daysBetween(dayKeyA, dayKeyB) -> integer calendar-day difference
applyActivity(streak, ts) -> { streak', usedShield:boolean, reset:boolean, earnedShield:boolean }
   rules: same day → no-op; next day → count+1; gap g>1 → if shields ≥ g-1 consume g-1
   & count+1 else reset to count=1; on count%7===0 earn shield (cap 3)
goalStage(goal) -> 0 seed | 1 sprout | 2 bud | 3 bloom | 4 radiant
   fraction done: 0→0, (0,.4)→1, [.4,.75)→2, [.75,1)→3, 1→4
completeStep(state, goalId, stepId, now) -> events[]   (mutates state; adds xp/petals,
   streak update, stage change detection, bloom handling, challenge progress+1)
cheer(state, now) -> events[]        (xp/petals/sunshineSent for cheering someone)
weekKey(ts) -> 'YYYY-MM-DD' of that week's Monday (local)
challengeTarget(state) -> 50 + 5*min(activeGoals,4)
rolloverChallengeIfNeeded(state, now) -> boolean (reset progress/target on new week)
addChallengeProgress(state, n, now) -> events[] (completion → rewarded, xp/petals)
evaluateBadges(state, now) -> [badgeId]  (adds to state.badges, returns new ones)
```

```js
// sim.js  (GroveSim)
makeRng(seed) -> () => float [0,1)          // mulberry32
catchUp(state, now, rng) -> events[]        // member activity since state.lastVisit,
   // hard cap 30 events; absence > 14 days → 1 digest event per member instead
reactions(state, rng, now) -> events[]      // 1–2 member cheers for the player, varied text
maybeStruggle(state, rng, now) -> events[]  // occasional struggle post (one active at a time)
supportMember(state, memberId, now) -> events[]  // player cheers member; if struggling,
   // queues recovery post crediting player; increments sunshineSent via logic.cheer
```

```js
// state.js (GroveState)
defaultState(now) -> state          // matches spec §5.3 schema, version:1
save(state), load() -> state|null   // validate: version + required keys, try/catch
exportJson(state) -> string
importJson(text) -> state           // throws Error('invalid save') on bad input
_setStorage(obj)                    // test hook: {getItem,setItem}
```

---

### Task 1: Test harness + logic.js core math (XP/levels/petals)

**Files:** Create `tests/run-tests.js`, `js/logic.js`, `.gitignore`

- [ ] Write `tests/run-tests.js`: `test(name, fn)` + `assertEq(a,b,msg)` helpers collecting pass/fail, exit code 1 on any fail; `require('../js/logic.js')`. Add first tests:
  - `levelForXp(0)` → level 1 'Seedling'; `levelForXp(59)` → level 1; `levelForXp(60)` → level 2 'Sprout'; `levelForXp(1800)` → level 8 'Forest Heart', `nextAt === null`; progress in (0,1) mid-band.
- [ ] Run `node tests/run-tests.js` → expect FAIL (module missing).
- [ ] Implement `js/logic.js` with UMD-style guard: `const GroveLogic = {...}; if (typeof module!=='undefined') module.exports = GroveLogic; if (typeof window!=='undefined') window.GroveLogic = GroveLogic;` Implement constants + `levelForXp`.
- [ ] Run tests → PASS. Commit `feat: logic core — xp/levels`.

### Task 2: logic.js — day math, streaks & dew shields

- [ ] Add tests: `dayKey` stable format; `daysBetween('2026-07-01','2026-07-02')===1`;
  streak same-day no-op; consecutive-day increment; 7th day earns shield (cap 3);
  1-day gap with 0 shields → reset to 1 (`reset:true`); 2-day gap with 1 shield → consumes it, `count+1`, `usedShield:true`; 3-day gap with 1 shield → reset.
- [ ] Run → FAIL. Implement `dayKey/daysBetween/applyActivity`. Run → PASS. Commit.

### Task 3: logic.js — goal stages, completeStep, bloom

- [ ] Tests: stage fractions per contract (0, .2, .4, .75, 1 with 10-step goal → 0,1,2,3,4); `completeStep` marks step done+`doneAt`, awards XP.STEP/PETALS.STEP, emits `{type:'stage-up'}` when stage crosses, final step → goal.bloomedAt set, bloom XP/petals, `{type:'bloom'}` event; double-complete same step → no double award.
- [ ] Run → FAIL. Implement. Run → PASS. Commit.

### Task 4: logic.js — weekly challenge + badges

- [ ] Tests: `weekKey` of a Wednesday returns that week's Monday; target formula (1 goal → 55, 4+ goals → 70); rollover on new week resets progress and re-arms `rewarded`; `addChallengeProgress` to ≥ target → `rewarded:true` once, emits `{type:'challenge-complete'}`, second call no double reward. Badges: first-step, first-bloom, streak-7, cheer-10, comeback (return after ≥3-day gap) each trigger exactly once from crafted states.
- [ ] Run → FAIL. Implement (badges as declarative `BADGE_CHECKS` map keyed by id; data.js will carry display info). Run → PASS. Commit.

### Task 5: state.js — schema, persistence, import/export

- [ ] Tests (inject fake storage object): `defaultState` has all spec §5.3 keys, version 1; save→load round-trip deep-equals; corrupted JSON in storage → `load()` returns null (no throw); `importJson` of exported string round-trips; `importJson('{}')` throws.
- [ ] Run → FAIL. Implement `js/state.js` (same UMD guard; storage defaults to `globalThis.localStorage`, `_setStorage` overrides). Run → PASS. Commit.

### Task 6: data.js — all content

**Files:** Create `js/data.js` (content only, no logic — UMD guard like others)

- [ ] Write content meeting these exact minimums (checked by tests):
  - `DOMAINS`: 6 (career, fitness, learning, money, wellbeing, creative) with emoji + accent color.
  - `GOAL_TEMPLATES`: ≥3 per domain, each with `name`, `emoji`, 6–10 concrete tiny steps written implementation-intention style.
  - `MEMBERS`: exactly 5 — Maya (steady runner, fitness+career), Priya (learning+creative, night-owl), Sofia (money+wellbeing, comeback-prone struggler), Amara (career-switcher, high-energy), Jen (new mom, low-pace but consistent). Each: `id,name,emoji,palette,bio,pace(0..1),struggleProne(0..1),goals[2],cheers[≥6],struggles[≥3],recoveries[≥3],feedVerbs[≥4]` — distinct voices, warm, zero clichés.
  - `AFFIRMATIONS` ≥15 varied (never salesy), `COMEBACK_LINES` ≥4 (warm re-entry, no guilt).
  - `BADGES` ≥12 display defs matching logic BADGE ids (incl. giving-support badges).
  - `SHOP_ITEMS` ≥8: decor with `id,name,price,kind` (kinds map to garden.js renderers).
- [ ] Add count/shape assertions to tests (e.g., every member ≥6 cheers; every template 6–10 steps). Run → PASS. Commit.

### Task 7: sim.js — circle simulation

- [ ] Tests (seeded rng): `catchUp` over 3 simulated days yields >0 and ≤30 events, timestamps strictly within (lastVisit, now), only valid member ids; 30-day absence → exactly 5 digest events (one per member); `reactions` after a player step returns 1–2 cheer events with member-specific text; `maybeStruggle` never creates a second concurrent struggle; `supportMember` on a struggling member queues a recovery event that names the player and increments `sunshineSent`.
- [ ] Run → FAIL. Implement `js/sim.js`. Run → PASS. Commit `feat: circle simulation`.

### Task 8: garden.js — SVG renderers (visual, browser-verified)

- [ ] Implement `GroveGarden`: `plantSvg(goal, stage, accent)` (5 visibly distinct growth stages, domain-tinted flower), `avatarSvg(member|player)` (flower-face avatar from palette), `decorSvg(kind)` (≥8 kinds: butterfly, lantern, fountain, arch, birdbath, windchime, gnome, fairylights), `communityGardenSvg(progressFraction)` (fills with flowers as fraction rises), `meadowPlant(goal)`. Pure string-returning functions; no DOM reads.
- [ ] Verification: rendered on every view in Task 10's browser smoke test (stages forced via a temporary `?debug=stages` grid — remove before final commit). Commit.

### Task 9: index.html + css/style.css

- [ ] `index.html`: header HUD (level ring, title, petals, streak+shields), 6 tab nav (Today, Garden, Circle, Challenge, Shop, More→Journal/Badges/Settings), view containers, toast container, modal container, script tags in dependency order (data, logic, sim, state, garden, ui, main).
- [ ] `style.css`: CSS variables for palette (warm botanical: cream bg, deep green ink, rose/terracotta accents), responsive ≤480px single-column, card system, growth/celebration keyframe animations, reduced-motion media query, focus-visible styles. Commit.

### Task 10: ui.js + main.js — views & wiring

- [ ] `GroveUI.renderAll(state)` + per-view renderers and one delegated click handler (`data-action` attributes). Views: Onboarding (3 steps: name+avatar → pick template/custom → tiny-steps editor), Today (steps due, affirmation, quick-add), Garden (plants grid + placed decor + Meadow strip), Circle (feed with cheer buttons, member cards, sunshine stat), Challenge (progress bar, community garden svg, history), Shop (buy/place decor), Journal (reflections timeline), Badges (earned/locked grid), Settings (export/import/reset).
- [ ] `main.js` boot per spec §5.2: load→migrate→onboarding?→`rolloverChallengeIfNeeded`→`catchUp`→`maybeStruggle`→render; toast queue for events; bloom modal with reflection input.
- [ ] Browser smoke checklist (chrome-devtools MCP against `file://` URL):
  onboarding completes; step check-off grows plant + toast + petals/xp; cheer works; struggle→support→recovery; challenge progresses & rewards; shop buy+place; export produces JSON; import restores; reload persists; `lastVisit` rewound 3 days in localStorage → feed catch-up + comeback line (no guilt copy); mobile 375px layout usable.
- [ ] Fix findings, run `node tests/run-tests.js` → all PASS. Commit.

### Task 11: README + final review

- [ ] README.md: what it is, how to play (double-click index.html), design highlights, test command, v2 real-backend path, data-ownership note.
- [ ] Remove any debug params; final `node tests/run-tests.js` PASS; final commit.

## Self-review (done)

- Spec coverage: every §4 mechanic and §5 file maps to a task (streak/shields→T2, badges/challenge→T4, sim arcs→T7, export/import→T5+T10, comeback copy→T6+T10 checklist).
- No placeholders; contracts pinned above are the single source for names/signatures.
- Type consistency: event objects always `{type, ...}`; state keys match spec §5.3.
