# Grove Phase 5/6 — Circle Chat, the AI Mentor, and the Keeper's Studio

**Date:** 2026-07-05
**Status:** Approved for build (user directive: build + deploy). Scope cuts declared in §6.

## 1. Brief (Anand, 2026-07-05)

1. Chat / voice chat inside circles.
2. Execute Phase 5 (mentors).
3. Rework UI/UX so an 8th-grader can use it.
4. Full marketing-automation workflow builder in admin — chat, email, WhatsApp etc.
5. Full admin ops features covering manual-intervention scenarios.
6. Deploy everything.

## 2. Circle chat + voice notes

- New `messages` table (circleId, memberId, kind `text|voice`, text ≤500 / audioPath,
  createdAt monotonic per circle, capped 300/circle). Separate from the event log so
  chatter never crowds out garden history.
- Routes: `GET/POST /api/circles/:id/messages` (memberKey auth, cursor pull);
  voice notes: recorded with the existing `makeRecorder`, sent base64 (≤ ~1MB),
  stored via platform `storage` at `voice/{circleId}/{id}`, played back through
  short-lived signed URLs fetched per message (member-gated, path-checked).
- Client: Chat card at the top of Circle view — last 30 messages, input +
  🎙️ voice-note button, 🔈 read-aloud on any text message. Pulls piggyback the
  sync tick plus an 8s interval while the Circle view is open, and immediately
  after send. **Deliberate cut:** no websockets — the platform realtime feature
  exists, but polling matches the cozy async pace and halves the moving parts.
- **Live voice *rooms* are out of scope** (WebRTC needs TURN/media infra the
  platform doesn't provide). Voice notes are the voice-chat deliverable.

## 3. Phase 5a — the AI mentor (5b/5c stay deferred)

- A circle may invite **one AI mentor**: `circles.mentor = {name, avatarId, tone: gentle|direct}`,
  configured by any member (cozy consensus), removable any time, always labeled "mentor · AI".
- **Chat:** messages addressed to the mentor (@-button) hit `POST /api/circles/:id/mentor-chat`
  → persona-toned `ai.generate` over the last 12 chat messages + the asker's
  non-private goal names → reply lands in chat as the mentor. Whisperer consent + circle budget apply.
- **Assess my plan:** in the steps editor, "🧭 mentor check" sends the goal name +
  current steps → returns a short verdict + up to 3 concrete step rewrites
  (coach budget, 5/member/day). Revise = the existing coach; Explore = the
  existing goal-discovery.
- **Deferred to 5b/5c:** real professional mentors, vetting, scheduling, payments
  (needs real humans + a payment provider decision).

## 4. The Keeper's Studio (marketing automation) + Ops

### 4.1 Campaigns (workflow builder)
- `campaigns` table: name, active, **trigger** (stalled-Xd / new-member / first-bloom /
  struggle-unsupported / everyone), threshold days, **channels** [note, push],
  template (≤240 chars, `{name}`/`{friend}` vars), cooldown days, sent counters.
- The nightly cron generalizes into a campaign executor (the built-in stalled/struggle
  nudges become two seeded default campaigns, editable). Every send logs a `nudges`
  row with campaignId; quiet-mode and per-campaign cooldowns always respected.
- **Channels honestly:** *in-app note* = live today; *push* = live for members who
  claimed accounts and granted notifications (platform `notifications.send`);
  *email / WhatsApp* = adapter seam + status chips ("needs provider keys") — players
  are anonymous by design, so these channels also require opt-in contact collection,
  a product decision deferred with the seam in place (`GET /api/admin/channels`
  reports readiness via `secrets.listSecretNames`).
- Admin Studio tab: campaign list, editor, activate/pause, delete, **Run now**
  (manual execution — also the verification path), send log.

### 4.2 Ops (manual intervention)
- **Browse:** circles list (size, last activity, AI usage, mentor) + circle detail
  (pseudonymous members, counts). **Act:** remove member, regenerate invite code,
  purge circle (all rows + voice files), delete a message/event (moderation),
  reset a circle's AI usage today / set per-circle AI cap override.
- **Feature flags** (`flags` table): whisperer on/off, new-circles on/off,
  maintenance banner text — enforced server-side (aiGuard / createCircle) and
  surfaced client-side (banner bar, ✨ hidden when whisperer is off) via public `GET /api/flags`.
- **Audit log:** every admin mutation writes `adminAudit` (when, who, action, target);
  viewable in the dashboard. Everything stays aggregates/pseudonyms — no content browsing
  beyond targeted moderation of a reported message id.

## 5. 8th-grader UX pass

Copy rewritten to short, common words (onboarding, consent, wizard, empty states) while
keeping e2e anchor phrases; a 4-line "How to play" card in More; bigger tap targets
(buttons ≥40px, step checks bigger on phones); slightly larger mobile type. Tone stays
warm, just simpler.

## 6. Explicit scope cuts

Live audio rooms (WebRTC infra), pro mentors + payments (5b/5c), realtime websockets,
email/WhatsApp live sending (seam only until provider keys + contact opt-in exist),
admin e2e coverage (Google sign-in is untestable headlessly — verified via 401/403
gates + Run-now + audit inspection instead).

## 7. Success criteria

Chat text + voice note round-trips between two circle members; mentor replies in
persona and assess returns usable rewrites; a campaign created in Studio delivers a
note via Run-now; flags flip live behavior; every admin mutation lands in the audit
log; node suite green; e2e ≥ 9/10 with anchors updated; all deployed to grove-hpbc3e.
