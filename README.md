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

## One-click grove (App Deploy) — circles *and* the Whisperer, zero setup

Grove's primary home is the **App Deploy** platform: one deploy gives hosting,
real circles (its database + invite system, still anonymous — a name and a
flower, no accounts), and **the Grove Whisperer** — AI woven into the game
with no API key and nothing to configure:

- **🪄 Goal coach** — drafts 6–10 tiny steps for any goal you name (you edit
  everything before planting).
- **Daily whisper** — a personalized affirmation for your garden each day.
- **✨ Personal cheers & reply suggestions** — warm, specific lines you pick
  and send as your own sunshine.
- **Growth Rings insights** — on-demand reflections over your journal.
- **Voice** — dictate boosts and reflections, hear your affirmation (free,
  in-browser, works everywhere).

The Whisperer is **opt-in** (a consent note explains exactly what's sent, and
you can turn it off any time), only wakes in real circles, never sees 🌙
private goals, and rests at 40 calls per circle per day.

Deploying: `node tools/pack-appdeploy.js` assembles `appdeploy-dist/`, which
ships via the App Deploy tooling (`backend/` holds the platform backend,
`src/main.ts` bridges the platform client to the plain-script game).

## Make it real (self-hosted alternative): circles on your own Supabase

Out of the box your Circle is simulated. Phase 2 lets you share a **real,
private circle** with up to four women you know — real steps, real cheers,
real "I'm stuck" posts — synced through a free Supabase project that *you*
own. No accounts, no emails: players stay anonymous, identified only by a
first name and a flower.

Setup (~10 minutes, done once by whoever hosts the grove):

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL Editor → paste all of [supabase/schema.sql](supabase/schema.sql) → Run.
3. Authentication → Sign In / Up → enable **Anonymous sign-ins**.
4. Project Settings → API → copy the URL and `anon public` key into
   [js/config.js](js/config.js).
5. Host this folder anywhere static (GitHub Pages works) and share your URL.

Then in the game: **Circle → Make it real → Start a circle**, and send
friends the invite link (`your-url#join=CODE`). They onboard, join, and
everyone's steps water the same weekly challenge. Garden spirits keep the
remaining seats warm and are always labeled — real friends are never
simulated, and a quiet friend's flower is simply still.

Worth knowing:

- **Privacy:** goal titles and activity sync; the text of your steps never
  leaves your device. Any goal can be marked 🌙 private — your circle then
  sees progress only. Cheers are picked from a warm curated set; the only
  free text shared is your own "ask for a boost" post, visible only to the
  circle you invited.
- **Your data, yours:** everything lives in *your* Supabase project. Delete
  the project, and the cloud data is gone. Local play and export/import work
  exactly as before.
- **Free-tier naps:** Supabase pauses free projects after ~7 idle days. The
  game shrugs (offline-first, actions queue and retry); to avoid naps
  entirely, put this repo on GitHub, add `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` as repo secrets, and the included
  [keepalive workflow](.github/workflows/supabase-keepalive.yml) pings it
  twice a week.
- **Try it without Supabase:** `node tools/fake-supabase.js` runs an
  in-memory stand-in at `http://localhost:9911` — point `js/config.js` at it
  and play with two browser profiles.

## Development

```
node tests/run-tests.js     # 112 logic/sim/state/social/net/sync tests, no dependencies
node tools/dev-server.js    # optional static server at http://localhost:8478
node tools/fake-supabase.js # in-memory supabase double for local circles
```

Plain HTML/CSS/JS, zero dependencies, no build step — the client talks to
Supabase with plain `fetch`, no SDK. Pure logic (`js/logic.js`, `js/sim.js`,
`js/state.js`, `js/social.js`, `js/net.js`, `js/sync.js`) is tested in Node;
the DOM layer (`js/ui.js`, `js/garden.js`) sits on top. All art is
code-generated SVG.

| File | Responsibility |
|---|---|
| `js/data.js` | Content: goal templates, circle members & voices, copy, badges, shop |
| `js/logic.js` | Rules: xp/levels, streaks & shields, goal stages, challenge, badges |
| `js/sim.js` | The garden spirits: catch-up activity, reactions, struggle arcs |
| `js/state.js` | Versioned localStorage persistence (v2), migration, export/import |
| `js/social.js` | Real circles: hybrid roster, event builders, remote classification |
| `js/whisper.js` | Whisperer: consent, AI payload builders (privacy rules), voice |
| `js/net.js` | SDK-free Supabase client: anonymous auth, RPCs, event push/pull |
| `js/netad.js` | App Deploy adapter: same client surface over the platform bridge |
| `js/sync.js` | Outbox flush + cursor pull loop, offline handling |
| `js/garden.js` | SVG art: plants by stage, avatars, decor, community garden |
| `js/ui.js` / `js/main.js` | Views, wizard, toasts, circle flows, boot |
| `supabase/schema.sql` | Tables, row-level security, create/join RPCs |
| `tools/fake-supabase.js` | In-memory double of the exact server contract |
| `backend/` + `src/main.ts` | App Deploy backend (circles, events, Whisperer AI) and platform bridge |
| `tools/pack-appdeploy.js` | Assembles the App Deploy deploy tree |
