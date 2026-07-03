# Grove Phase 2 — Real Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real, private, invite-code Circles syncing through Supabase (SDK-free plain `fetch`), with hybrid sim fill and the player's struggle→boost→comeback arc — per `docs/superpowers/specs/2026-07-03-grove-phase2-real-circles-design.md`.

**Architecture:** Append-only `events` log per circle + optimistic local apply + outbox polling. New pure modules `js/net.js` (Supabase REST client), `js/social.js` (roster/merge brain), `js/sync.js` (orchestration); `tools/fake-supabase.js` doubles the exact server contract for tests and browser demos. State migrates to version 2.

**Tech Stack:** Vanilla HTML/CSS/JS plain scripts (UMD-guard pattern from v1), Node ≥18 for tests (global `fetch`/`Response`/`AbortSignal`), Supabase (Postgres + PostgREST + GoTrue anonymous auth) defined in one `supabase/schema.sql`.

## Global Constraints

- **No npm dependencies, no build step, no SDKs.** Client files are plain `<script>` tags; `file://` must keep working.
- **Blank `js/config.js` ⇒ exactly v1.** Every v1 test keeps passing; no net UI beyond a setup pointer card.
- **UMD guard pattern** on every new js module: `if (typeof module !== 'undefined' && module.exports) module.exports = X; if (typeof window !== 'undefined') window.X = X;`
- **Copy tone:** warm, capable, never scolding; spirits always labeled; real members never simulated.
- **Events are append-only**; every outbox event carries a `client_key` UUID; server dedupes on `(circle_id, client_key)`.
- **All tests:** `node tests/run-tests.js` exits 0; extend the existing harness (`test`/`assert`/`assertEq`/`assertThrows`), no framework.
- Commit after each green task with the message given in the task. Work on branch `real-circles`.

---

## File structure

```
supabase/schema.sql        tables + RLS + RPCs (paste into Supabase SQL editor)
js/config.js               window.GroveConfig = { SUPABASE_URL:'', SUPABASE_ANON_KEY:'' }
js/net.js                  GroveNet — SDK-free Supabase client (auth, RPCs, events)
js/social.js               GroveSocial — roster, spirit slots, event builders, applyRemote
js/sync.js                 GroveSync — outbox flush / cursor pull / apply loop
tools/fake-supabase.js     in-memory double of the server contract (CLI + module)
.github/workflows/supabase-keepalive.yml   weekly ping so the free project never pauses
js/state.js                MODIFY: version 2 (net block, goal.private), migrate
js/logic.js                MODIFY: challengeTarget aware of real circles (flat 70)
js/data.js                 MODIFY: + CHEER_PHRASES, REAL_CIRCLE copy block
js/ui.js                   MODIFY: Circle tab real-circle UI, boost composer, privacy, deep-link modal
js/main.js                 MODIFY: net/sync boot, deep link, step/bloom/recover/cheer hooks
index.html                 MODIFY: script tags (config, net, social, sync)
css/style.css              MODIFY: ribbons, sync chip, composer, privacy toggle
tests/run-tests.js         MODIFY: new sections (state v2, social, logic, net unit+integration, data counts)
README.md                  MODIFY: “Make it real” setup guide
```

**Sim.js is deliberately unchanged.** Hybrid fill works by trimming `state.circle.members`
(the sim roster) to the spirit slots via `GroveSocial.syncSpiritSlots`; sim code already
only generates activity for members present in that array, and `renderCircle`/feed already
skip events whose member id is unknown.

### Shared identifier conventions (used by several tasks)

- `avatar_id` / `accent_id` travel as **strings** in DB/events (`String(state.player.avatarId)`); client renders with `D.PLAYER_AVATARS[Number(avatarId) % D.PLAYER_AVATARS.length]`.
- Real feed items live in `state.circle.feed` alongside sim items with shape
  `{ id:'r'+ev.id, ts, type, text, real:true, memberId:<uuid>, name, avatarId, cheered:false }`
  where `type ∈ step|bloom|struggle|recovery|cheer_player|welcome|leave`.
- `uuid()` helper (social.js): `crypto.randomUUID()` when available, else an RFC-4122-v4
  string built from `Math.random` (DB column is `uuid` — the fallback must match its format).
- Session shape everywhere: `{ access, refresh, userId }`.

---

### Task 1: state.js — version 2 (net block, goal.private, migrate)

**Files:** Modify `js/state.js`, `tests/run-tests.js`

**Interfaces — Produces:**
- `GroveState.defaultState(now)` → state with `version: 2` and
  `net: { session:null, circle:null, members:[], cursor:0, outbox:[], lastSyncAt:null, playerStruggle:null }`
- `GroveState.migrate(raw)` → same object, upgraded in place to v2 (adds `net` defaults; every goal gets `private:false` if missing) and returned
- `load()` / `importJson(text)` accept v1 **or** v2 payloads and always return migrated v2

- [ ] **Step 1: failing tests** (new section `---------- state v2 ----------`):
  - `defaultState(0).version === 2`; `net` deep-equals the default block above.
  - Craft a v1 state via the OLD shape (take `defaultState`, set `version:1`, `delete st.net`, add goal `{id:'g1',name:'x',domain:'career',emoji:'x',steps:[],createdAt:0,bloomedAt:null,reflection:null}`), save it through a fake storage object, then `load()` → `version===2`, `net` present, `goals[0].private === false`.
  - v2 round-trip: `save(defaultState)` → `load()` deep-equals.
  - `importJson(exportJson(v1State))` → migrated v2; `importJson('{}')` still throws `'invalid save'`.
  - Corrupt JSON in storage → `load()` returns null (existing behavior preserved).
- [ ] **Step 2:** run `node tests/run-tests.js` → new tests FAIL (`migrate` undefined / version mismatch).
- [ ] **Step 3: implement.** `isValid` accepts `raw.version === 1 || raw.version === 2`. Add:

```js
function defaultNet() {
  return { session: null, circle: null, members: [], cursor: 0,
    outbox: [], lastSyncAt: null, playerStruggle: null };
}
GroveState.migrate = function (raw) {
  if (raw.version === 1) raw.version = 2;
  if (!raw.net || typeof raw.net !== 'object') raw.net = defaultNet();
  for (const k of Object.keys(defaultNet())) {
    if (!(k in raw.net)) raw.net[k] = defaultNet()[k];
  }
  for (const g of raw.goals) if (typeof g.private !== 'boolean') g.private = false;
  return raw;
};
```

  `load()` and `importJson()` return `GroveState.migrate(raw)`; `defaultState` gets `version: 2` and `net: defaultNet()`. `SAVE_KEY` stays `'grove-save-v1'`.
- [ ] **Step 4:** run tests → all PASS (incl. the whole v1 suite).
- [ ] **Step 5:** `git commit -m "feat: state v2 — net block, goal privacy flag, migration"`

### Task 2: data.js — phase 2 content

**Files:** Modify `js/data.js`, `tests/run-tests.js`

**Interfaces — Produces:**
- `GroveData.CHEER_PHRASES` — array of `{ id, text }`, ≥8, warm one-liners (“You're doing the thing!”, “Small step, loud applause ☀️” …), ids `cp1…cpN`
- `GroveData.REAL_CIRCLE` — copy block:
  `{ spiritTag, spiritHint, makeRealTitle, makeRealBody, setupBody, boostPlaceholder, boostHint, quietGoalLabel, joinErrors: { 'not-found', 'full', offline } }`
  (exact strings chosen at implementation, tone per Global Constraints; `quietGoalLabel: 'a quiet goal 🌙'`)

- [ ] **Step 1: failing tests:** `CHEER_PHRASES.length >= 8`, every entry has non-empty `id`+`text`, ids unique; `REAL_CIRCLE` has all keys above with non-empty strings; `joinErrors` covers `'not-found'`, `'full'`, `'offline'`.
- [ ] **Step 2:** run → FAIL. **Step 3:** write the content. **Step 4:** run → PASS.
- [ ] **Step 5:** `git commit -m "feat: phase-2 copy — cheer phrases, real-circle strings"`

### Task 3: social.js — roster, spirit slots, event builders

**Files:** Create `js/social.js`; modify `tests/run-tests.js`, `index.html` (add `<script src="js/social.js"></script>` after `js/state.js`)

**Interfaces — Consumes:** `state.net` (Task 1), `GroveData.MEMBERS/CHEER_PHRASES` (Task 2).
**Produces:**

```js
GroveSocial.uuid() -> RFC-4122 v4 string
GroveSocial.roster(state, data) -> [{kind:'real', member}|{kind:'sim', member}]
   // others only (excludes self memberId); real first by joinedAt asc; spirits =
   // data.MEMBERS.slice(0, 5 - realCount); length ≤ 5
GroveSocial.syncSpiritSlots(state, data) -> void
   // state.circle.members trimmed/refilled to exactly the roster's spirit ids
   // (preserving existing lastCheerIdx); clears state.circle.activeStruggle if
   // its member was removed
GroveSocial.buildStepEvent(goal, stageAfter) -> {client_key, type:'step',
   payload:{goalTitle: goal.private ? null : goal.name, stage: stageAfter}}
GroveSocial.buildBloomEvent(goal) -> {client_key, type:'bloom', payload:{goalTitle|null}}
GroveSocial.buildStruggleEvent(text) -> {client_key, type:'struggle',
   payload:{text: text.trim().slice(0, 280)}}
GroveSocial.buildRecoverEvent(supporterIds) -> {client_key, type:'recover',
   payload:{supporterMemberIds: supporterIds}}
GroveSocial.buildCheerEvent(toMemberId, phraseId) -> {client_key, type:'cheer',
   payload:{toMemberId, phraseId}}
```

- [ ] **Step 1: failing tests** (fixture: v2 default state + `net.circle={id:'c1',name:'Us',inviteCode:'ABC234',memberId:'me'}` + `net.members=[{id:'me',name:'Anu',avatarId:'0',accentId:'0',joinedAt:'2026-07-01T00:00:00Z'},{id:'m2',name:'Rhea',avatarId:'1',accentId:'1',joinedAt:'2026-07-02T00:00:00Z'}]`):
  - `roster` → 5 entries: first `{kind:'real'}` with `member.id==='m2'` (self excluded), then 4 spirits in `D.MEMBERS` order (`maya, priya, sofia, amara` — assert first spirit id `'maya'`).
  - No circle (`net.circle=null`) → 5 spirits, ids equal `D.MEMBERS.map(m=>m.id)`.
  - `syncSpiritSlots` on the fixture (after `Sim.initMembers`) → `state.circle.members.length === 4` and ids `['maya','priya','sofia','amara']`; a `state.circle.activeStruggle={memberId:'jen',…}` gets cleared.
  - `buildStepEvent({name:'Run 5K', private:false}, 2)` → payload `{goalTitle:'Run 5K', stage:2}`; with `private:true` → `goalTitle === null`. `client_key` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
  - `buildStruggleEvent('  '+'x'.repeat(300))` → text length 280, trimmed.
  - Two `uuid()` calls differ.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (UMD guard; requires `./data.js` in Node like sim.js does). **Step 4:** run → PASS.
- [ ] **Step 5:** `git commit -m "feat: social — hybrid roster, spirit slots, outbox event builders"`

### Task 4: social.js — applyRemote classification

**Files:** Modify `js/social.js`, `tests/run-tests.js`

**Interfaces — Produces:**

```js
GroveSocial.applyRemote(state, data, events, selfMemberId) ->
  { feedItems: [feed item shape from “Shared identifier conventions”],
    challengeSteps: n,                      // count of foreign 'step' events
    cheersForMe: [{fromMemberId, name, phrase}],
    recoveredWithMyHelp: [name],            // foreign 'recover' crediting self
    memberChanged: boolean,                 // any 'join' or 'leave' seen
    maxId: n }                              // highest ev.id seen (0 if none)
  // PURE: reads state.net.members for names; never mutates state.
  // Skips events whose member_id === selfMemberId entirely (except maxId).
```

Text rules (member name from `state.net.members`, fallback `'A friend'`; phrase looked up in `data.CHEER_PHRASES`, fallback `'sending sunshine'`):
- step: `` `${name} took a step toward “${goalTitle}”` `` — private (`goalTitle==null`): `` `${name} tended ${data.REAL_CIRCLE.quietGoalLabel}` ``
- bloom: `` `${name}’s “${goalTitle}” bloomed! A goal finished. 🌸` `` — private: `` `One of ${name}’s quiet goals bloomed 🌸` ``
- struggle → type `'struggle'`, text `` `${name}: “${payload.text}”` ``
- recover → type `'recovery'`, `` `${name} is back on her feet 🌈` `` (+ `` ` — your sunshine helped` `` when self in `supporterMemberIds`)
- cheer → type `'cheer_player'`, `` `${name} sent ${toName} sunshine ☀️ — “${phrase}”` ``; `toName` is `'you'` when `toMemberId===selfMemberId` (also emits a `cheersForMe` entry), else the target's name
- join → type `'welcome'`, `` `${payload.name} joined the circle 🌱` ``; leave → type `'leave'`, `` `${payload.name} stepped out of the circle — wish her well 🍂` ``

- [ ] **Step 1: failing tests** (server rows shaped `{id, circle_id, member_id, client_key, type, payload, created_at:'2026-07-03T10:00:00Z'}`):
  - Foreign step from `m2` → 1 feedItem `{type:'step', real:true, name:'Rhea', cheered:false}`, text contains `Run 5K`… private step (`goalTitle:null`) → text contains `quiet goal`; `challengeSteps===1`.
  - Own event (`member_id:'me'`, id 9) → no feedItems, `challengeSteps===0`, `maxId===9`.
  - Cheer to me → `cheersForMe[0]` `{fromMemberId:'m2', name:'Rhea'}` with the `cp1` phrase text; feed text contains `'you'`.
  - Recover with `supporterMemberIds:['me']` → `recoveredWithMyHelp===['Rhea']`, feed text contains `'your sunshine helped'`.
  - join event → `memberChanged===true`, feedItem type `'welcome'`.
  - Unknown type `'confetti'` → ignored, still counted in `maxId`.
  - `state` deep-equals its pre-call JSON snapshot afterwards (purity).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: social — remote event classification"`

### Task 5: logic.js — real-circle challenge target

**Files:** Modify `js/logic.js`, `tests/run-tests.js`

**Interfaces — Produces:** `challengeTarget(state)` → `70` when `state.net && state.net.circle`, else the v1 formula `50 + 5*min(activeGoals,4)` unchanged.

- [ ] **Step 1: failing tests:** v2 default state (no circle), 1 active goal → 55 (v1 behavior); same state with `net.circle={id:'c1'}` → 70; `rolloverChallengeIfNeeded` on a circle state arms `target:70`.
- [ ] **Step 2:** FAIL → **Step 3:**

```js
GroveLogic.challengeTarget = function (state) {
  if (state.net && state.net.circle) return 70;
  return 50 + 5 * Math.min(GroveLogic.activeGoals(state).length, 4);
};
```

- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat: shared weekly target for real circles"`

### Task 6: net.js — SDK-free Supabase client (unit-tested)

**Files:** Create `js/net.js`; modify `tests/run-tests.js`, `index.html` (script tag after `js/config.js` — config tag added in Task 8)

**Interfaces — Produces:**

```js
GroveNet.makeClient({url, anonKey, fetchFn, session, onSession, timeoutMs=8000}) -> client
// client holds the session; every refresh triggers onSession(newSession).
// EVERY method resolves {ok:true, ...} | {ok:false, error:string, offline?:true} — never throws.
client.getSession() -> session|null
client.signInAnon() -> {ok, session}
client.createCircle({circleName, memberName, avatarId, accentId})
  -> {ok, circle:{id,name,inviteCode}, memberId}
client.joinCircle({code, memberName, avatarId, accentId})
  -> {ok, circle, memberId, members:[{id,name,avatarId,accentId,joinedAt}]}
client.fetchMembers(circleId) -> {ok, members}
client.pushEvents(circleId, memberId, events) -> {ok, pushed}
client.pullEvents(circleId, cursor, limit=200) -> {ok, events, cursor}
client.leaveCircle(circleId, leaveEvent) -> {ok}   // pushes the leave event, then deletes membership
```

Exact HTTP contract (single internal `call()` helper; all requests get `apikey: anonKey`, JSON bodies, `AbortSignal.timeout(timeoutMs)`; authed requests add `Authorization: Bearer <access>`):

| Method | Request | Success |
|---|---|---|
| signInAnon | `POST {url}/auth/v1/signup` body `{}` | `{access_token, refresh_token, user:{id}}` → session |
| refresh (internal) | `POST {url}/auth/v1/token?grant_type=refresh_token` body `{refresh_token}` | same shape |
| createCircle | `POST {url}/rest/v1/rpc/create_circle` body `{circle_name, member_name, avatar, accent}` | `{circle:{id,name,invite_code}, member_id}` |
| joinCircle | `POST {url}/rest/v1/rpc/join_circle` body `{code, member_name, avatar, accent}` | + `members` (snake_case → client camelCases) |
| fetchMembers | `GET {url}/rest/v1/members?circle_id=eq.{id}&order=joined_at.asc` | row array |
| pushEvents | `POST {url}/rest/v1/events?on_conflict=circle_id,client_key` headers `Prefer: resolution=ignore-duplicates,return=minimal`; body = events with `circle_id`+`member_id` stamped | 201 |
| pullEvents | `GET {url}/rest/v1/events?circle_id=eq.{id}&id=gt.{cursor}&order=id.asc&limit={n}` | row array; `cursor = rows.length ? rows[rows.length-1].id : cursor` |
| leave (delete) | `DELETE {url}/rest/v1/members?circle_id=eq.{id}&user_id=eq.{session.userId}` | 204 |

Error mapping: network throw / abort → `{ok:false, error:'offline', offline:true}`; RPC 4xx whose body message contains `not-found`/`full` → that string as `error`; 401 on an authed call → refresh once (rotating `refresh_token`), retry the original call once; if refresh also fails → `signInAnon()` and `{ok:false, error:'session-lost'}` (caller decides to rejoin).

- [ ] **Step 1: failing unit tests** with a scripted fake fetch (`makeFakeFetch(script)` returning queued `new Response(JSON.stringify(body), {status})`, recording `{url, method, headers, body}`):
  - signInAnon hits `/auth/v1/signup` with `apikey` header and stores/returns the session; `onSession` fired.
  - createCircle sends `Authorization: Bearer` + snake_case body keys; camelCases `invite_code` → `inviteCode`.
  - pushEvents URL ends `?on_conflict=circle_id,client_key`, `Prefer` header exact, every row has `circle_id`, `member_id`, `client_key`.
  - pullEvents with rows `[{id:41},{id:42}]` → `cursor===42`; empty array → cursor unchanged.
  - 401-then-refresh-then-retry: script `[401, refresh 200, retry 200]` → final `{ok:true}`, exactly 3 calls, `onSession` fired with rotated tokens.
  - joinCircle 400 body `{message:'full'}` → `{ok:false, error:'full'}`.
  - fetch that rejects → `{ok:false, offline:true}`; fetch that never resolves with `timeoutMs:50` → same (async test: harness must support `async` test fns — wrap: collect promises and `await Promise.all` before printing summary; convert `test()` to push `fn()` results that may be promises).
- [ ] **Step 2:** FAIL → **Step 3:** implement (also the small harness async upgrade) → **Step 4:** PASS incl. v1 suite.
- [ ] **Step 5:** `git commit -m "feat: net — SDK-free supabase client with refresh + offline mapping"`

### Task 7: tools/fake-supabase.js + net integration tests

**Files:** Create `tools/fake-supabase.js`; modify `tests/run-tests.js`

**Interfaces — Produces:**
- `require('../tools/fake-supabase.js')` → `{ createFake() }` where `createFake()` → `{ server, listen(port=0) -> Promise<actualPort>, close(), state }`
- CLI: `node tools/fake-supabase.js --port 9911` (default 9911) → logs `fake supabase → http://localhost:9911`
- Implements exactly the Task 6 endpoint table, in memory: rotating `tok-<userId>-<n>` bearer/refresh tokens, membership-enforced reads/writes (403 on non-member access), `unique(circle_id, client_key)` dedupe honoring `resolution=ignore-duplicates`, join errors `{message:'not-found'}`/`{message:'full'}` with status 400, 5-real-member cap, CORS (`Access-Control-Allow-Origin:*`, `-Headers: authorization, apikey, content-type, prefer`, `-Methods: GET,POST,DELETE,OPTIONS`; `OPTIONS` → 204). Invite codes `ABC234`-style from the schema alphabet.

- [ ] **Step 1: failing integration tests** (async; `listen(0)` for an ephemeral port, real global fetch, two `GroveNet.makeClient`s pointing at it):
  - A: signInAnon → createCircle `{circleName:'Us', memberName:'Anu', avatarId:'0', accentId:'0'}` → 6-char inviteCode from alphabet `/^[A-HJ-KM-NP-Z2-9]{6}$/`.
  - B: signInAnon → joinCircle with that code → `members.length === 2`; joinCircle again (idempotent) → still 2; wrong code → `error:'not-found'`.
  - B pushEvents one step event twice (same client_key) → both `{ok:true}`; A pullEvents from 0 → exactly 3 events (2 joins + 1 step, ids ascending); cursor advances; second pull from cursor → 0 events.
  - A pullEvents with B's circleId but a third non-member client → `{ok:false}` (403 mapped to error).
  - B leaveCircle → A fetchMembers → 1 member; pull sees the `leave` event.
  - `close()` afterwards so the runner exits.
- [ ] **Step 2:** FAIL → **Step 3:** implement the fake → **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: fake supabase double + net integration tests"`

### Task 8: backend artifacts — schema.sql, config.js, keepalive workflow

**Files:** Create `supabase/schema.sql`, `js/config.js`, `.github/workflows/supabase-keepalive.yml`; modify `index.html` (add `<script src="js/config.js"></script>` FIRST, then existing tags, with `js/net.js` after `js/state.js` and `js/social.js`, `js/sync.js` before `js/ui.js`)

No runnable tests (Postgres not available locally); reviewed against the fake's behavior, exercised by the user's first-run checklist. `schema.sql` complete content:

```sql
-- Grove Phase 2 — paste this whole file into the Supabase SQL editor and Run.
-- Prereq: Authentication → Sign In / Up → enable "Anonymous sign-ins".

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 30),
  avatar_id text not null,
  accent_id text not null,
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
);

create table public.events (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  client_key uuid not null,
  type text not null check (type in
    ('step','bloom','struggle','recover','cheer','join','leave')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (circle_id, client_key)
);
create index events_circle_cursor on public.events (circle_id, id);

alter table public.circles enable row level security;
alter table public.members enable row level security;
alter table public.events  enable row level security;

-- security definer so RLS policies can consult membership without recursion
create or replace function public.is_circle_member(cid uuid)
returns boolean language sql security definer set search_path = public stable as
$$ select exists (select 1 from public.members
                  where circle_id = cid and user_id = auth.uid()); $$;

create policy circles_select on public.circles for select to authenticated
  using (public.is_circle_member(id));
create policy members_select on public.members for select to authenticated
  using (public.is_circle_member(circle_id));
create policy members_delete on public.members for delete to authenticated
  using (user_id = auth.uid());
create policy events_select on public.events for select to authenticated
  using (public.is_circle_member(circle_id));
create policy events_insert on public.events for insert to authenticated
  with check (
    public.is_circle_member(circle_id)
    and exists (select 1 from public.members m
                where m.id = events.member_id
                  and m.user_id = auth.uid()
                  and m.circle_id = events.circle_id));

create or replace function public.gen_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

create or replace function public.create_circle(
  circle_name text, member_name text, avatar text, accent text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.circles; m public.members; tries int := 0;
begin
  if auth.uid() is null then raise exception 'not-authenticated'; end if;
  loop
    begin
      insert into public.circles (name, invite_code, created_by)
        values (circle_name, public.gen_invite_code(), auth.uid())
        returning * into c;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  insert into public.members (circle_id, user_id, name, avatar_id, accent_id)
    values (c.id, auth.uid(), member_name, avatar, accent) returning * into m;
  insert into public.events (circle_id, member_id, client_key, type, payload)
    values (c.id, m.id, gen_random_uuid(), 'join',
            jsonb_build_object('name', member_name));
  return json_build_object(
    'circle', json_build_object('id', c.id, 'name', c.name,
                                'invite_code', c.invite_code),
    'member_id', m.id);
end $$;

create or replace function public.join_circle(
  code text, member_name text, avatar text, accent text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.circles; m public.members; n int;
begin
  if auth.uid() is null then raise exception 'not-authenticated'; end if;
  select * into c from public.circles
    where invite_code = upper(trim(code));
  if not found then raise exception 'not-found'; end if;
  select * into m from public.members
    where circle_id = c.id and user_id = auth.uid();
  if not found then
    select count(*) into n from public.members where circle_id = c.id;
    if n >= 5 then raise exception 'full'; end if;
    insert into public.members (circle_id, user_id, name, avatar_id, accent_id)
      values (c.id, auth.uid(), member_name, avatar, accent) returning * into m;
    insert into public.events (circle_id, member_id, client_key, type, payload)
      values (c.id, m.id, gen_random_uuid(), 'join',
              jsonb_build_object('name', member_name));
  end if;
  return json_build_object(
    'circle', json_build_object('id', c.id, 'name', c.name,
                                'invite_code', c.invite_code),
    'member_id', m.id,
    'members', (select coalesce(json_agg(json_build_object(
        'id', x.id, 'name', x.name, 'avatar_id', x.avatar_id,
        'accent_id', x.accent_id, 'joined_at', x.joined_at)
        order by x.joined_at), '[]'::json)
      from public.members x where x.circle_id = c.id));
end $$;

revoke execute on function public.create_circle(text,text,text,text) from public, anon;
revoke execute on function public.join_circle(text,text,text,text)   from public, anon;
revoke execute on function public.is_circle_member(uuid)             from public, anon;
grant  execute on function public.create_circle(text,text,text,text) to authenticated;
grant  execute on function public.join_circle(text,text,text,text)   to authenticated;
grant  execute on function public.is_circle_member(uuid)             to authenticated;
```

`js/config.js` complete content:

```js
'use strict';
// Grove backend config — fill both values to enable real circles.
// Supabase dashboard → Project Settings → API. The anon key is safe to publish.
window.GroveConfig = {
  SUPABASE_URL: '',        // e.g. 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '',
};
```

`.github/workflows/supabase-keepalive.yml` complete content:

```yaml
name: supabase-keepalive
on:
  schedule:
    - cron: '0 9 * * 1,4'   # twice weekly — free projects pause after ~7 idle days
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase REST endpoint
        run: |
          curl -sf "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_ANON_KEY" -o /dev/null
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

- [ ] **Step 1:** write the three files exactly as above; update `index.html` script order to: `config, data, logic, sim, state, social, net, sync, garden, ui, main` (sync.js file arrives in Task 9 — add its tag now; a 404 script tag is harmless in the interim but the branch isn't merged until it exists).
- [ ] **Step 2:** `node tests/run-tests.js` still PASS (nothing executable changed).
- [ ] **Step 3:** `git commit -m "feat: supabase schema, blank client config, keepalive workflow"`

### Task 9: sync.js — outbox/pull orchestration

**Files:** Create `js/sync.js`; modify `tests/run-tests.js`

**Interfaces — Consumes:** client (Task 6 shape), `GroveSocial.applyRemote/syncSpiritSlots` (Tasks 3–4), `GroveLogic.addChallengeProgress`.
**Produces:**

```js
GroveSync.makeSync({ctx, client, logic, social, data, onUpdate, intervalMs=30000}) -> sync
// ctx = {get state, save} (main.js ctx). onUpdate(report) fires after any
// pull that changed state; report = applyRemote result + {synced:boolean}.
sync.queue(event) -> void        // push to state.net.outbox, save, debounce flush (2s)
sync.syncNow() -> Promise<{ok, changed}>   // flush outbox then pull once (serialized;
                                           // concurrent calls coalesce into one)
sync.start() -> void             // syncNow + setInterval(visible-only) + visibilitychange hook
sync.stop() -> void
sync.status() -> 'idle'|'syncing'|'offline'|'synced'
```

Behavior to implement: flush sends `outbox.slice()`, and on `{ok}` removes exactly those client_keys from the (possibly grown) outbox; pull applies in order — feedItems appended to `state.circle.feed` (cap 80, matching sim), `challengeSteps` → `logic.addChallengeProgress(state, n, now, false)`, `cheersForMe` while `state.net.playerStruggle` exists append unique `fromMemberId` to its `supporters`, `memberChanged` → `client.fetchMembers` refresh of `state.net.members` + `social.syncSpiritSlots(state, data)`, cursor = `max(cursor, maxId)`, `lastSyncAt = now`, save once, `onUpdate(report)`. Any `{ok:false}` → status `'offline'`, everything kept for next cycle. `document`/timer hooks are guarded with `typeof document !== 'undefined'` so Node tests can drive `syncNow()` directly.

- [ ] **Step 1: failing tests** (fake client = plain object with scripted async methods recording calls; fixture state from Task 3):
  - `queue` twice → outbox length 2, `ctx.save` called; `syncNow` → pushEvents got both, outbox empty after.
  - Outbox grows during flush (fake pushEvents pushes a 3rd event into outbox before resolving) → after syncNow, exactly the 3rd remains.
  - Pull returning a foreign step + a cheer-to-me (while `playerStruggle` set) → feed grew by 2, challenge progress +1, `playerStruggle.supporters===['m2']`, cursor 42, `onUpdate` called once with `challengeSteps===1`.
  - Pull returning a `join` → fake `fetchMembers` called, `state.net.members` replaced, spirit slots trimmed.
  - client offline (`{ok:false, offline:true}`) → `status()==='offline'`, outbox intact, no throw.
  - Feed cap: pre-fill 79 sim items + pull 3 → feed length 80.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: sync — outbox flush, cursor pull, hybrid apply"`

### Task 10: ui.js + css — real-circle interface

**Files:** Modify `js/ui.js`, `css/style.css`

Browser-verified (Task 12); no Node tests — matches v1's UI convention. All new
buttons use the existing `data-action` delegation. New actions and views, exact
list (wire each in `onClick`):

- Circle tab, no real circle + config filled → **“Make it real” card** (title/body from `D.REAL_CIRCLE`) with `rc-create-open` and `rc-join-open` buttons; config blank → same card but `setupBody` copy pointing at README, no buttons.
- `rc-create-open` → modal: circle-name input `#rc-name` (maxlength 40) + `rc-create`. `rc-create` → `main` hook `window.Grove.net.createCircleFlow(name)` (Task 11) → on ok: toast `Circle “${name}” is live — share the code!`, render.
- `rc-join-open` → modal: code input `#rc-code` (maxlength 6, uppercased on input) + `rc-join` → `joinCircleFlow(code)`; error toasts from `D.REAL_CIRCLE.joinErrors[error]`.
- Circle header when circle exists: invite chip `Invite code: <b>ABC234</b>` + `rc-copy-code` (uses `navigator.clipboard.writeText(inviteLink)` where `inviteLink = location.origin+location.pathname+'#join='+code`, fallback prompt), sync chip from `window.Grove.sync.status()` (`synced ✓` / `offline — will retry` / `syncing…`), `rc-leave` in the More→settings card (confirm dialog, then `leaveCircleFlow()`).
- Member cards: roster from `GroveSocial.roster` — real members render `G.avatarSvg` from `D.PLAYER_AVATARS[Number(avatarId)%D.PLAYER_AVATARS.length]` palette, name, `real` ribbon, cheer button `cheer-real` `data-member=<uuid>`; spirits render as v1 + `D.REAL_CIRCLE.spiritTag` tag.
- Feed: items with `e.real` render name/avatar from the item itself; cheer button on real items → `cheer-real` with `data-event`; clicking sets `item.cheered=true` locally + queues `buildCheerEvent(memberId, randomPhraseId)` + `L.cheer` awards + toast the chosen phrase.
- **“Ask for a boost”** button (only when real circle) above the feed → composer modal `#boost-text` textarea (maxlength 280, `boostPlaceholder`/`boostHint` copy) + `rc-boost-send` → queues `buildStruggleEvent`, sets `state.net.playerStruggle={eventKey:<client_key>, postedAt:Date.now(), supporters:[]}`, adds an own-feed item, toast `Your circle will see it — asking is a strength 💛`.
- Privacy: wizard `steps` stage gains a `🌙 keep this goal private to me` checkbox `#ob-private` → `goal.private`; Garden plant-cards get a small moon toggle `toggle-private` `data-goal` flipping `goal.private` with toast (`quiet goal` on/off).
- CSS: `.ribbon-real`, `.spirit-tag`, `.sync-chip` (+ `.offline` variant), `.boost-composer`, `.moon-toggle`, `.invite-chip` — botanical palette vars, focus-visible, ≤480px single-column intact.

- [ ] **Step 1:** implement Circle-tab branches + modals + actions. **Step 2:** implement wizard/garden privacy + css. **Step 3:** `node tests/run-tests.js` still PASS. **Step 4:** `git commit -m "feat: real-circle UI — create/join, boost composer, privacy, ribbons"`

### Task 11: main.js — boot wiring, flows, deep link, gameplay hooks

**Files:** Modify `js/main.js`, `js/ui.js` (the two shared hooks noted below)

**Interfaces — Consumes:** everything above. **Produces (on `window.Grove`):**
`Grove.net = {client, createCircleFlow(name), joinCircleFlow(code), leaveCircleFlow()}`, `Grove.sync`.

- [ ] **Step 1: boot.** After `UI.init(ctx)`: if `GroveConfig.SUPABASE_URL && GroveConfig.SUPABASE_ANON_KEY` → `client = GroveNet.makeClient({url, anonKey, fetchFn: fetch.bind(window), session: state.net.session, onSession: s => { state.net.session = s; ctx.save(); }})`; `sync = GroveSync.makeSync({ctx, client, logic:L, social:GroveSocial, data:D, onUpdate: report => { for (const c of report.cheersForMe) UI.toast(`☀️ ${c.name} sent you sunshine — “${c.phrase}”`, 'rose'); for (const n of report.recoveredWithMyHelp) UI.toast(`🌈 ${n} is back on her feet — your sunshine helped.`, 'rose'); UI.renderAll(); }})`. If `state.net.circle` → `GroveSocial.syncSpiritSlots(state, D)` before the sim catch-up runs, then `sync.start()` after first render.
- [ ] **Step 2: flows.** `createCircleFlow(name)`: ensure session (`signInAnon` if null) → `client.createCircle({circleName:name, memberName:state.player.name||'friend', avatarId:String(state.player.avatarId), accentId:String(state.player.accentId)})` → on ok set `state.net.circle={id,name,inviteCode,memberId}`, `state.net.members=[self row]`, `state.net.cursor=0`, `syncSpiritSlots`, save, `sync.start()`. `joinCircleFlow(code)` same via `joinCircle` (members from response). `leaveCircleFlow()`: `client.leaveCircle(circleId, GroveSocial.buildLeaveEvent(state.player.name))` — add tiny builder `buildLeaveEvent(name) -> {client_key, type:'leave', payload:{name}}` to social.js with a one-line test — then clear `state.net.circle/members/cursor/outbox/playerStruggle`, re-fill spirits, `sync.stop()`, save, render.
- [ ] **Step 3: deep link.** At boot read `location.hash.match(/^#join=([A-Za-z0-9]{6})$/)` → if match and onboarded: `UI.openJoinModal(code)` (export the Task 10 join modal opener); if not onboarded: `UI.setPendingJoin(code)` and open it right after `finishWizard` completes onboarding. Clear the hash (`history.replaceState(null,'',location.pathname)`) once consumed. Bad/expired code → the flow's `not-found` toast, nothing crashes.
- [ ] **Step 4: gameplay hooks** (in `ui.js`, guarded by `state.net.circle && window.Grove.sync`):
  - `handleCompleteStep`: after computing `events`, queue `buildStepEvent(goal, L.goalStage(goal))`; if a `bloom` event fired, also queue `buildBloomEvent(goal)`; if `state.net.playerStruggle` → queue `buildRecoverEvent(playerStruggle.supporters)`, clear it, toast `🌈 That step was your comeback — your circle saw it.`
  - `cheer-real` handler queues the cheer (Task 10) — verify the queue call lands in `state.net.outbox` when offline.
- [ ] **Step 5:** `node tests/run-tests.js` PASS. Manual boot check against blank config (v1 behavior) via dev server. **Step 6:** `git commit -m "feat: boot net+sync, circle flows, join deep-link, comeback hook"`

### Task 12: two-player verification, README, final review

**Files:** Modify `README.md`; no product code except found-bug fixes.

- [ ] **Step 1: two-player smoke against the fake.** Terminal A: `node tools/fake-supabase.js` (port 9911). Point `js/config.js` at `http://localhost:9911` (temporarily). Player A = browser via dev server: onboard → Circle → Make it real → create circle → copy code. Player B = Node script driven through `js/net.js` + fake fetch-less real HTTP (script inline in the session, not committed): signInAnon → joinCircle(code) → pushEvents(one step + one cheer→A + one struggle). Verify in browser A within one poll: B appears as real member (ribbon), feed shows her step, cheer toast fires, her struggle card renders; A cheers B (button flips to `Sunshine sent ✓`); A posts a boost, B pushes a cheer to A, A completes a step → comeback toast + `recover` event visible in a B pull; challenge progress counts both players' steps; spirits fill remaining slots with tags; A marks a goal private → B's next pull shows `quiet goal` text; kill the fake → sync chip `offline — will retry`, A's actions queue in outbox; restart fake → outbox flushes, chip `synced ✓`. Mobile 375px: circle cards/composer usable.
- [ ] **Step 2:** restore blank `js/config.js`; confirm boot is v1-identical (no console errors, no net calls) from both dev server and `file://`.
- [ ] **Step 3: README** — new “Make it real (optional)” section: 1) supabase.com → New project (free) 2) SQL Editor → paste `supabase/schema.sql` → Run 3) Authentication → Sign In / Up → enable Anonymous sign-ins 4) Project Settings → API → copy URL + anon public key into `js/config.js` 5) host the folder statically (GitHub Pages works) and share `your-url#join=CODE`; note the keepalive workflow + repo secrets, the data-ownership story (your project, your data), and `node tools/fake-supabase.js` for local try-out. Update the dev table with the new files and the v2 line replacing “v2: a real community”.
- [ ] **Step 4:** full `node tests/run-tests.js` → PASS; skim `git diff master --stat` for strays (no debug params, no filled config).
- [ ] **Step 5:** `git commit -m "docs: make-it-real setup guide + phase 2 notes"`.

## Self-review (done)

- **Spec coverage:** §4.1 create/join/deep-link/leave → T10–11; §4.2 event table + curated cheers → T2/T3/T4; §4.3 boost→comeback → T10–11; §4.4 flat-70 target → T5; §4.5 honesty (spirits trimmed, never simulate real) → T3 (`syncSpiritSlots`) + T10 labels; §5.1 schema/RLS/RPCs/keepalive → T8; §5.2–5.3 files/contracts → T1–T9; §5.4 sync algorithm → T9; §5.5 error handling → T6 (offline/401/session-lost), T10 (setup card), T11 (bad code), T4 (unknown types); §6 testing → per-task + T7 integration + T12 smoke; §7 ship list fully mapped; §8 criteria = T12 steps 1–4.
- **Placeholder scan:** none; copy strings delegated to `D.REAL_CIRCLE`/`CHEER_PHRASES` are pinned by key list + count tests (v1 convention for content), all code-bearing steps carry code or exact behavior tables.
- **Type consistency:** session `{access, refresh, userId}` everywhere; event rows snake_case on the wire, camelCase in client returns (converted in net.js only); feed-item shape defined once in “Shared identifier conventions” and reused in T4/T9/T10; `avatarId` strings on the wire per conventions block.
