# Grove Phase 2 — Real Circles: Design Document

**Date:** 2026-07-03
**Status:** Approved by user (interactive brainstorm)
**Builds on:** `2026-07-02-grove-goal-garden-design.md` (v1, shipped)

## 1. Brief

Make Grove's community real. Replace "simulated-only" Circles with **private,
invite-code Circles of real people** syncing through a small backend, exactly as
v1's §6 anticipated: the feed is already event-shaped, so a sync client maps
1:1 onto an append-only event log per circle.

## 2. Design questions and resolved answers

All resolved interactively with the user on 2026-07-03.

| Question | Decision | Rationale |
|---|---|---|
| What is Phase 2? | Real community (v1 doc's documented v2 path). | User choice; it is the heart of the game's promise. |
| How do Circles form? | **Invite-first, matchmaking-ready.** Private 6-char invite codes, no public discovery. Data model (uuid ids, membership separate from circles, generic events) leaves matchmaking possible later without schema breaks. | Invite-only friends ≈ zero moderation burden → shippable responsibly in one phase. |
| Backend? | **Supabase**, accessed with plain `fetch()` — no SDK, no build step. | User choice (BaaS over self-hosted Node or Cloudflare). Supabase's REST (PostgREST) + GoTrue endpoints work SDK-free, preserving the zero-dependency client. |
| Free-tier pause risk? | Accept + mitigate: offline-first client shrugs off an unreachable server; ship an optional GitHub Actions weekly keepalive ping. | Free projects pause after ~7 idle days; a comeback-friendly game must tolerate that. |
| Sim members' fate? | **Hybrid fill.** Real members take slots as they join; sim members ("garden spirits", visibly labeled) fill the roster to 5. Solo/offline play is exactly v1. | A 2-person circle must not feel dead; instant-aliveness is a v1 feature worth keeping. |
| What is shared? | **Titles + activity.** Name, flower avatar, goal titles, and events (step, bloom, struggle, recover, cheer). Step *text* never leaves the device. Any goal can be marked private → syncs as "a quiet goal 🌙" with progress only. | "Respect is the feature." |
| Sync architecture? | **A: append-only event log + polling outbox** (over state-docs or realtime websockets). | Matches v1's event-shaped feed 1:1; conflict-free; offline-first; no SDK; pure and Node-testable. |

## 3. Approaches considered

**A. Event log + polling outbox (chosen).** Every action is an immutable
`events` row. Client applies actions locally at once (optimistic), queues them
in an outbox, pushes/pulls on a cursor. *Pros:* no conflicts, offline-first,
plain fetch, testable. *Cons:* cheers land on next poll (seconds) — fine for an
async check-in game.

**B. Shared state documents.** Members upload garden summaries; clients merge.
*Cons:* cheers/struggles are inherently events, so event semantics get rebuilt
anyway; last-write-wins conflicts; discards v1's compatible feed shape.

**C. Supabase Realtime channels.** Live websockets. *Cons:* requires the
supabase-js SDK (contradicts the no-SDK decision) and websocket lifecycle
handling, for marginal benefit.

## 4. Game design

### 4.1 Making it real (Circle tab)

- No real circle yet → a **"Make it real"** card: *Create a circle* (name it →
  get invite code + copyable link) or *Join with a code*.
- Invite links deep-link: `<app-url>#join=CODE` opens the join flow (after
  onboarding if the visitor is new).
- Circle exists → invite-code chip (with copy button), sync-status chip
  ("synced ✓" / "offline — will retry"), member cards. Real members get a
  `real` ribbon; spirits get a small leaf tag ("garden spirit").
- Up to **5 real members** per circle (the v1 roster size). Roster = real
  members first (by join date), spirits fill remaining slots deterministically.
- Settings gains **Leave circle** (deletes your membership; your past events
  remain in the shared log) and shows backend config status.

### 4.2 What syncs

| Event | Payload (jsonb) | Feed rendering |
|---|---|---|
| `step` | `{goalTitle\|null, stage}` | "Maya took a step toward *Run a 5K*" / "…toward a quiet goal 🌙" |
| `bloom` | `{goalTitle\|null}` | bloom celebration line |
| `cheer` | `{toMemberId, phraseId}` | "Anu sent Maya sunshine ☀ — *'You're doing the thing!'*" |
| `struggle` | `{text}` (≤280 chars) | boost-request card with cheer button |
| `recover` | `{supporterMemberIds}` | recovery line crediting supporters |
| `join` / `leave` | `{name}` | "Priya joined the circle 🌱" |

Cheers are **curated phrases** (a `CHEER_PHRASES` set in data.js, ≥8), picked
by one tap — warm, game-y, and no free-text moderation surface. The only free
text that leaves the device is the struggle post, visible solely to invited
friends.

### 4.3 The player's struggle arc (new gameplay)

V1 only let sim members struggle. Phase 2 adds the reverse: an **"Ask for a
boost"** composer. Friends' cheers land as support; the player's **next
completed step auto-posts her recovery**, crediting everyone who cheered —
*your next step is your comeback*. Spirits may also send supportive lines
(clearly in their sim voice), but recovery is triggered only by the player's
own action.

### 4.4 Weekly challenge with real people

Progress = count of all `step` events in the circle's event log this week
(player + real members + spirits), so every member computes the identical
number. Target for a real circle is a flat, reachable **70 steps/week**
(full 6-flower roster including the player); solo mode keeps the v1 formula.
Revisable default.

### 4.5 Honesty rules

- Real members are **never simulated** — no fake steps, cheers, or struggles
  attributed to a real person. A quiet friend's flower is simply still.
- Spirits are always visibly labeled; their copy keeps the existing sim voice.
- Sim struggle arcs continue for spirit slots only.

## 5. Architecture

### 5.1 Backend (one Supabase project, owned by the deployer)

Whoever deploys Grove creates the (free) Supabase project; her friends simply
use her game URL. The circle's data lives in *her* project, deletable by her.
Right shape for invite circles; only future matchmaking would need a hosted
instance.

**Tables** (`supabase/schema.sql`):

```sql
circles (
  id uuid pk default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
)
members (
  id uuid pk default gen_random_uuid(),
  circle_id uuid not null references circles on delete cascade,
  user_id uuid not null,           -- auth.uid()
  name text not null check (char_length(name) between 1 and 30),
  avatar_id text not null,
  accent_id text not null,
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
)
events (
  id bigint generated always as identity pk,
  circle_id uuid not null references circles on delete cascade,
  member_id uuid not null references members on delete cascade,
  client_key uuid not null,        -- idempotent retries
  type text not null check (type in
    ('step','bloom','struggle','recover','cheer','join','leave')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (circle_id, client_key)
)
```

**Auth:** Supabase **anonymous sign-ins** (enabled in dashboard). No emails,
passwords, or PII beyond chosen first name + flower. Sessions are JWTs with
rotating refresh tokens, persisted in Grove's state (and included in
export/import, so a save file restores identity).

**RLS:** enabled on all tables. A `security definer` helper
`is_circle_member(cid uuid)` avoids recursive-policy pitfalls:

- `circles`: select where `is_circle_member(id)`
- `members`: select where `is_circle_member(circle_id)`; delete own row
  (`user_id = auth.uid()`) — this is "leave circle"
- `events`: select where `is_circle_member(circle_id)`; insert only when the
  caller is a member and `member_id` is *her* member row; **no update/delete**
  (append-only)

**RPCs** (`security definer`, granted to `authenticated`):

- `create_circle(circle_name, member_name, avatar_id, accent_id)` → generates a
  6-char code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I; retry on
  collision), inserts circle + creator membership + `join` event; returns
  `{circle:{id,name,invite_code}, member_id}`.
- `join_circle(code, member_name, avatar_id, accent_id)` → case-insensitive
  code lookup; errors `'not-found'` / `'full'` (≥5 real members); idempotent if
  already a member; inserts membership + `join` event; returns
  `{circle, member_id, members[]}`.

RPCs exist because joining requires reading a circle you are not yet a member
of, which plain RLS correctly forbids.

**Keepalive:** `.github/workflows/supabase-keepalive.yml` — weekly cron curl to
`$SUPABASE_URL/rest/v1/` with the anon key (repo secrets `SUPABASE_URL`,
`SUPABASE_ANON_KEY`). Optional; only functions once the repo is on GitHub.

### 5.2 Client files

New (all UMD-guarded like v1 modules, pure, no DOM):

```
js/config.js          committed blank: {SUPABASE_URL:'', SUPABASE_ANON_KEY:''}
                      — user pastes her values; blank ⇒ net UI hidden, game is exactly v1
js/net.js             GroveNet: SDK-free Supabase client over injected fetch
js/social.js          GroveSocial: hybrid roster, event builders, remote-event
                      classification (the merge brain)
tools/fake-supabase.js  in-memory double of the exact endpoints net.js uses;
                      CORS-enabled for browser demos; used by integration tests
supabase/schema.sql   tables + RLS + RPCs, single pasteable file
```

Changed: `js/state.js` (v2 migration), `js/sim.js` (simulate spirit slots
only), `js/data.js` (+`CHEER_PHRASES`, spirit label copy, boost copy),
`js/ui.js` + `js/main.js` (Circle-tab cards, modals, deep link, sync loop,
toasts), `css/style.css` (ribbons, chips, composer), `README.md` (setup guide).

### 5.3 Pinned client contracts

```js
// net.js — every method resolves {ok:true, ...} | {ok:false, error, offline?};
// on 401: refresh once, retry once; 8s AbortController timeout; never throws.
GroveNet.makeClient({url, anonKey, fetchFn}) -> client
client.signInAnon() -> {ok, session:{access, refresh, userId}}
client.refresh(session) -> {ok, session}
client.createCircle(session, {circleName, memberName, avatarId, accentId})
  -> {ok, circle:{id, name, inviteCode}, memberId}
client.joinCircle(session, {code, memberName, avatarId, accentId})
  -> {ok, circle, memberId, members}
client.leaveCircle(session, circleId) -> {ok}
client.fetchMembers(session, circleId) -> {ok, members}
client.pushEvents(session, circleId, memberId, events) -> {ok, pushed}
  // stamps circle_id + member_id onto each row; Prefer: resolution=ignore-duplicates
client.pullEvents(session, circleId, cursor, limit=200) -> {ok, events, cursor}
```

```js
// social.js
GroveSocial.roster(state, data) -> [{kind:'real'|'sim', member}]   // ≤5, deterministic
GroveSocial.buildStepEvent(goal, stageAfter) -> outbox event   // respects goal.private
GroveSocial.buildBloomEvent(goal); buildStruggleEvent(text);
GroveSocial.buildRecoverEvent(supporterIds); buildCheerEvent(toMemberId, phraseId)
GroveSocial.applyRemote(state, data, events, selfMemberId)
  -> {feedItems, challengeSteps, cheersForMe, struggleUpdates, memberChanges}
  // pure classification; main.js applies results via logic.js
```

```js
// state.js — version 2
state.net = {
  session: null | {access, refresh, userId},
  circle:  null | {id, name, inviteCode, memberId},
  members: [],            // cached [{id, name, avatarId, accentId, joinedAt}]
  cursor: 0,              // highest events.id seen
  outbox: [],             // events awaiting push
  lastSyncAt: null,
  playerStruggle: null | {eventKey, postedAt, supporters: [memberId]},
}
// every goal gains: private: false
// migrate(v1) -> v2 adds the above; load() accepts both, saves v2
```

`client_key` values come from `crypto.randomUUID()` (browser and Node).

### 5.4 Sync algorithm (main.js)

1. **Action** → build event → apply locally immediately (existing logic.js
   paths) → append to `net.outbox` → debounced flush (~2s).
2. **Flush:** push outbox with `Prefer: resolution=ignore-duplicates`; on
   success clear pushed events; on failure keep them for the next cycle.
3. **Pull:** `events?circle_id=eq.X&id=gt.cursor&order=id.asc` on boot, on
   `visibilitychange→visible`, and every 30s while visible. Skip own events
   (`member_id === self`); classify the rest via `social.applyRemote`; advance
   the cursor; persist.
4. Cheers addressed to the player toast immediately ("Maya sent you sunshine ☀")
   and award via existing logic; foreign steps advance the weekly challenge.

### 5.5 Error handling

- **Blank config** → real-circle UI replaced by a setup pointer card; game is
  exactly v1. All v1 tests must keep passing.
- **Offline / paused project / timeouts** → status chip flips to "offline —
  will retry"; outbox retains events; gameplay never blocks. A free-tier pause
  is indistinguishable from being offline, by design.
- **401** → refresh once → on failure re-auth anonymously; if the old identity
  is unrecoverable the player rejoins with the invite code (new member row) —
  documented, acceptable v2 trade-off since sessions are also in export files.
- **Unknown event types** are ignored (forward compatibility).
- **Deep link with bad/full code** → warm error copy, never a crash.

## 6. Testing

- **Node** (`tests/run-tests.js`, extending the v1 47): social.js roster fill /
  privacy masking / remote classification / recovery-credits; state v1→v2
  migration + round-trip; net.js unit (injected fake fetch: auth, refresh-once,
  retry, timeout) **and** integration over real HTTP against
  `tools/fake-supabase.js` on an ephemeral port.
- **Browser two-player smoke** (fake-supabase + dev-server, two profiles):
  create → copy link → join → step in B appears in A within a poll → cheer from
  A toasts in B → struggle → boost → next step auto-recovers with credit →
  challenge counts both → spirits fill and are labeled → private goal shows
  quiet title → kill server (offline badge, queued outbox) → restart (flush).
- **Real Supabase:** README checklist for first run (user-executed).

## 7. Ship list

`supabase/schema.sql` · `js/config.js` (blank) · `js/net.js` · `js/social.js` ·
`tools/fake-supabase.js` · `.github/workflows/supabase-keepalive.yml` · state
v2 migration · sim/ui/main/css integration · tests · README "Make it real"
setup guide (create project → paste schema → enable anonymous sign-ins → copy
URL/key into config.js → host statically, e.g. GitHub Pages).

**Not in Phase 2:** matchmaking (model-ready only), realtime websockets,
PWA/notifications, free-text chat, invite-code rotation.

## 8. Success criteria

1. Full two-player flow passes against fake-supabase in two browser profiles.
2. All Node tests pass (`node tests/run-tests.js`), including the untouched v1 suite.
3. Client remains plain scripts: no SDK, no build step, no npm dependencies.
4. Blank config behaves exactly like v1 (solo, offline, `file://`).
5. A non-technical deployer can go from zero to a working real circle with the
   README in ≤10 minutes.
