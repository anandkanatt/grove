// Grove backend — circles, members, an append-only event log, and the
// Whisperer AI routes. Anonymous identity: creating/joining mints a memberKey
// (returned once, held on-device); every write presents memberId + memberKey.
import {
  router, json, error, db, invites, isInviteError, ai,
  requireAuth, requireAdminEmailAllowlist,
} from '@appdeploy/sdk';
import {
  GROVE_TONE, STEPS_SCHEMA, REPLIES_SCHEMA, HISTORY_CAP, MAX_REAL_MEMBERS,
  todayKey, clamp, capExceeded, validEvent, oneLine,
  stepsPrompt, cheerPrompt, repliesPrompt, insightsPrompt,
  SENTIMENT_LABELS, STALLED_DAYS, STRUGGLE_UNSUPPORTED_HOURS, NUDGE_COOLDOWN_DAYS,
  DAY_MS, pickNudge, memberLastSeen, buildOverview, buildInterventions,
  GOAL_DOMAINS, GOAL_IDEAS_SCHEMA, goalIdeasPrompt, transcribePrompt,
} from './grove';

// The grove keeper's gate — explicit, real admin emails only.
const ADMIN_EMAILS = ['anandkanatt@gmail.com'];

// ---------- data access ----------

async function getMember(circleId: string, memberId: string, memberKey: string):
  Promise<(Record<string, any> & { id: string }) | null> {
  if (!circleId || !memberId || !memberKey) return null;
  const [m] = await db.get<Record<string, any>>('members', [memberId]);
  if (!m || m.circleId !== circleId || m.memberKey !== memberKey) return null;
  // db.get returns the stored record without its id (unlike db.list) — attach
  // it, or every event written with member.id loses its author.
  return { ...m, id: memberId };
}

async function listAll(table: string, filter: Record<string, unknown>) {
  // Full paginated scan — tables are small by design (history capped, tiny circles).
  let items: Array<Record<string, any> & { id: string }> = [];
  let nextToken: string | undefined;
  do {
    const page = await db.list(table, { filter, nextToken });
    items = items.concat(page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

async function circleEvents(circleId: string) {
  const items = await listAll('events', { circleId });
  return items.sort((a, b) =>
    (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
}

async function circleMembers(circleId: string) {
  const items = await listAll('members', { circleId });
  return items.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
}

const publicMember = (m: Record<string, any>) => ({
  id: m.id, name: m.name, avatarId: m.avatarId, accentId: m.accentId, joinedAt: m.joinedAt,
});

// Monotonic per-circle timestamps: equal-millisecond events get nudged so a
// createdAt cursor never skips one of two same-ms events.
async function addEvent(circle: Record<string, any> & { id: string },
  memberId: string, clientKey: string, type: string, payload: unknown) {
  const at = Math.max(Date.now(), (circle.lastEventAt ?? 0) + 1);
  circle.lastEventAt = at;
  await db.update('circles', [{ id: circle.id, record: { ...circle, id: undefined, lastEventAt: at } }]);
  await db.add('events', [{ circleId: circle.id, memberId, clientKey, type, payload: payload ?? {}, createdAt: at }]);
  return at;
}

async function pruneHistory(circleId: string) {
  const events = await circleEvents(circleId);
  if (events.length > HISTORY_CAP) {
    const drop = events.slice(0, events.length - HISTORY_CAP).map(e => e.id);
    await db.delete('events', drop);
  }
}

async function makeMember(circleId: string, body: any) {
  const memberKey = crypto.randomUUID();
  const record = {
    circleId, memberKey,
    name: clamp(body?.name, 30) || 'friend',
    avatarId: clamp(body?.avatarId, 4) || '0',
    accentId: clamp(body?.accentId, 4) || '0',
    joinedAt: Date.now(),
  };
  const [id] = await db.add('members', [record]);
  if (!id) throw new Error('member insert failed');
  return { ...record, id };
}

// Per-circle daily AI budget; the coach additionally caps per member.
async function aiAllowed(circleId: string, memberId: string, isCoach: boolean) {
  const day = todayKey(Date.now());
  const rows = await listAll('aiUsage', { circleId, day });
  let row = rows[0];
  if (!row) {
    const [id] = await db.add('aiUsage', [{ circleId, day, count: 0, byMember: {} }]);
    if (!id) return false;
    row = { id, circleId, day, count: 0, byMember: {} };
  }
  if (capExceeded(row, memberId, isCoach)) return false;
  const byMember = { ...(row.byMember ?? {}) };
  byMember[memberId] = (byMember[memberId] ?? 0) + 1;
  await db.update('aiUsage', [{
    id: row.id,
    record: { circleId, day, count: (row.count ?? 0) + 1, byMember },
  }]);
  return true;
}

// Shared guard for AI routes: body carries {circleId, memberId, memberKey}.
async function aiGuard(ctx: any, isCoach: boolean) {
  const b = ctx.body as any;
  const member = await getMember(b?.circleId, b?.memberId, b?.memberKey);
  if (!member) return error('unauthorized', 401);
  if (!(await aiAllowed(b.circleId, b.memberId, isCoach))) return error('ai-rest', 429);
  return null;
}

async function generate(opts: Record<string, unknown>) {
  return ai.generate({
    system: GROVE_TONE,
    maxTokens: 500,
    temperature: 0.7,
    thinkingMode: 'NONE',
    ...opts,
  });
}

// ---------- routes ----------

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'POST /api/circles': [async (ctx) => {
    const b = ctx.body as any;
    const name = clamp(b?.name, 40) || 'Our Grove';
    const [circleId] = await db.add('circles', [{ name, createdAt: Date.now(), lastEventAt: 0 }]);
    if (!circleId) return error('circle insert failed', 500);
    const member = await makeMember(circleId, b?.member);
    const [circle] = await db.get('circles', [circleId]);
    await addEvent({ ...circle, id: circleId }, member.id, crypto.randomUUID(), 'join', { name: member.name });
    const created = await invites.create({
      resourceType: 'circle', authMode: 'anonymous', context: { circleId },
    });
    return json({
      circleId, circleName: name, inviteCode: created.code,
      memberId: member.id, memberKey: member.memberKey,
    });
  }],

  'POST /api/circles/join': [async (ctx) => {
    const b = ctx.body as any;
    let joined;
    try {
      joined = await invites.join({ code: clamp(b?.code, 12).toUpperCase() });
    } catch (err) {
      if (isInviteError(err)) return error('not-found', 400);
      throw err;
    }
    const circleId = (joined.context as any)?.circleId as string;
    const [circle] = await db.get('circles', [circleId]);
    if (!circle) return error('not-found', 400);
    const members = await circleMembers(circleId);
    if (members.length >= MAX_REAL_MEMBERS) return error('full', 400);
    const member = await makeMember(circleId, b?.member);
    await addEvent({ ...circle, id: circleId }, member.id, crypto.randomUUID(), 'join', { name: member.name });
    const after = await circleMembers(circleId);
    return json({
      circleId, circleName: circle.name, inviteCode: joined.code,
      memberId: member.id, memberKey: member.memberKey,
      members: after.map(publicMember),
    });
  }],

  'GET /api/circles/:id/members': [async (ctx) => {
    const member = await getMember(ctx.params.id, ctx.query.memberId, ctx.query.memberKey);
    if (!member) return error('unauthorized', 401);
    const members = await circleMembers(ctx.params.id);
    return json({ members: members.map(publicMember) });
  }],

  'GET /api/circles/:id/events': [async (ctx) => {
    const member = await getMember(ctx.params.id, ctx.query.memberId, ctx.query.memberKey);
    if (!member) return error('unauthorized', 401);
    const since = Number(ctx.query.since) || 0;
    const events = (await circleEvents(ctx.params.id))
      .filter(e => e.createdAt > since)
      .slice(0, 200)
      .map(e => ({ id: e.id, memberId: e.memberId, clientKey: e.clientKey,
        type: e.type, payload: e.payload, createdAt: e.createdAt }));
    return json({ events });
  }],

  'POST /api/circles/:id/events': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const incoming = Array.isArray(b?.events) ? b.events : [];
    const existing = await circleEvents(ctx.params.id);
    const seen = new Set(existing.map(e => e.clientKey));
    const [circle] = await db.get('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 400);
    let pushed = 0;
    for (const e of incoming) {
      if (!validEvent(e) || seen.has(e.clientKey)) continue;
      seen.add(e.clientKey);
      await addEvent({ ...circle, id: ctx.params.id }, member.id, e.clientKey, e.type, e.payload);
      pushed += 1;
    }
    if (pushed > 0) await pruneHistory(ctx.params.id);
    return json({ pushed });
  }],

  'POST /api/circles/:id/leave': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const [circle] = await db.get('circles', [ctx.params.id]);
    if (circle) {
      await addEvent({ ...circle, id: ctx.params.id }, member.id, crypto.randomUUID(), 'leave', { name: member.name });
    }
    await db.delete('members', [member.id]);
    return json({ ok: true });
  }],

  // ---------- the whisperer ----------

  // ---------- accounts & backups (phase 4) ----------

  'POST /api/account/link': [requireAuth(), async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(b?.circleId, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    await db.update('members', [{ id: member.id, record: { ...member, id: undefined, userId: ctx.user!.userId } }]);
    return json({ ok: true });
  }],

  'POST /api/account/backup': [requireAuth(), async (ctx) => {
    const b = ctx.body as any;
    const blob = typeof b?.blob === 'string' ? b.blob : '';
    if (!blob || blob.length > 200000) return error('bad-backup', 400);
    const rows = await listAll('backups', { userId: ctx.user!.userId });
    const record = { userId: ctx.user!.userId, blob, updatedAt: Date.now() };
    if (rows[0]) await db.update('backups', [{ id: rows[0].id, record }]);
    else await db.add('backups', [record]);
    return json({ ok: true, updatedAt: record.updatedAt });
  }],

  'GET /api/account/backup': [requireAuth(), async (ctx) => {
    const rows = await listAll('backups', { userId: ctx.user!.userId });
    if (!rows[0]) return error('not-found', 404);
    return json({ blob: rows[0].blob, updatedAt: rows[0].updatedAt });
  }],

  'POST /api/circles/:id/quiet': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    await db.update('members', [{ id: member.id, record: { ...member, id: undefined, quiet: !!b?.quiet } }]);
    return json({ ok: true });
  }],

  // Undelivered keeper notes for this member; delivery is marked immediately.
  'GET /api/circles/:id/nudges': [async (ctx) => {
    const member = await getMember(ctx.params.id, ctx.query.memberId, ctx.query.memberKey);
    if (!member) return error('unauthorized', 401);
    const rows = await listAll('nudges', { memberId: member.id });
    const mine = rows.filter(n => !n.deliveredAt);
    for (const n of mine) {
      await db.update('nudges', [{ id: n.id, record: { ...n, id: undefined, deliveredAt: Date.now() } }]);
    }
    return json({ notes: mine.map(n => ({ id: n.id, text: n.text, createdAt: n.createdAt })) });
  }],

  // ---------- the grove keeper's dashboard (admin, aggregates only) ----------

  'GET /api/admin/overview': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => {
    // Full scans are fine at grove scale: events are capped per circle and
    // circles are tiny. Revisit with counters if this ever exceeds ~1k circles.
    const [circles, members, events, usage, senti, nudges] = await Promise.all([
      listAll('circles', {}), listAll('members', {}), listAll('events', {}),
      listAll('aiUsage', {}), listAll('sentimentDaily', {}), listAll('nudges', {}),
    ]);
    return json(buildOverview({ circles, members, events, usage, senti, nudges, now: Date.now() }));
  }],

  'GET /api/admin/interventions': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => {
    const [circles, members, events, usage] = await Promise.all([
      listAll('circles', {}), listAll('members', {}), listAll('events', {}), listAll('aiUsage', {}),
    ]);
    return json(buildInterventions({ circles, members, events, usage, now: Date.now() }));
  }],

  'POST /api/admin/nudge': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async (ctx) => {
    const b = ctx.body as any;
    const text = oneLine(String(b?.text || ''), 240);
    if (!text) return error('empty-note', 400);
    const [member] = await db.get<Record<string, any>>('members', [String(b?.memberId || '')]);
    if (!member) return error('not-found', 404);
    await db.add('nudges', [{
      circleId: member.circleId, memberId: String(b.memberId), text,
      source: 'manual', day: todayKey(Date.now()), createdAt: Date.now(), deliveredAt: 0,
    }]);
    return json({ ok: true });
  }],

  'POST /api/ai/steps': [async (ctx) => {
    const guard = await aiGuard(ctx, true);
    if (guard) return guard;
    const b = ctx.body as any;
    try {
      const r = await generate({
        prompt: stepsPrompt(b.goalName, b.domain),
        schema: STEPS_SCHEMA,
      });
      const parsed = JSON.parse(r.text);
      const steps = (parsed.steps || []).map((s: unknown) => oneLine(String(s), 90)).filter(Boolean);
      if (steps.length < 2) return error('ai-unavailable', 502);
      return json({ steps: steps.slice(0, 10) });
    } catch (err) {
      console.error('ai steps failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  // Goal discovery — three plantable ideas from whatever is on her mind.
  // Counts against the per-member coach budget, like step drafting.
  'POST /api/ai/goal-ideas': [async (ctx) => {
    const guard = await aiGuard(ctx, true);
    if (guard) return guard;
    const b = ctx.body as any;
    const seed = clamp(b?.seed, 240);
    if (!seed) return error('empty-seed', 400);
    try {
      const r = await generate({
        prompt: goalIdeasPrompt(seed, clamp(b?.domain, 20)),
        schema: GOAL_IDEAS_SCHEMA,
      });
      const parsed = JSON.parse(r.text);
      const ideas = (parsed.ideas || [])
        .map((i: any) => ({
          name: oneLine(String(i?.name ?? ''), 45),
          domain: GOAL_DOMAINS.indexOf(i?.domain) !== -1 ? i.domain : 'wellbeing',
          why: oneLine(String(i?.why ?? ''), 90),
        }))
        .filter((i: any) => i.name);
      if (ideas.length < 3) return error('ai-unavailable', 502);
      return json({ ideas: ideas.slice(0, 3) });
    } catch (err) {
      console.error('ai goal-ideas failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  // Voice-note transcription for browsers whose speech recognition is a
  // zombie (Opera). Audio goes to the platform AI and only text returns;
  // nothing is stored.
  'POST /api/ai/transcribe': [async (ctx) => {
    const guard = await aiGuard(ctx, false);
    if (guard) return guard;
    const b = ctx.body as any;
    const audio = typeof b?.audio === 'string' ? b.audio : '';
    const mimeType = clamp(b?.mimeType, 40);
    // ~2MB decoded is the platform's per-audio cap; base64 is 4/3 of that.
    if (!audio || audio.length > 2800000) return error('bad-audio', 400);
    if (mimeType.indexOf('audio/') !== 0) return error('bad-audio', 400);
    try {
      const r = await ai.generate({
        system: 'You are a precise transcription engine.',
        prompt: transcribePrompt(),
        audios: [{ data: audio, mimeType }],
        maxTokens: 400,
        temperature: 0,
        thinkingMode: 'NONE',
      });
      const text = clamp(r.text, 600).replace(/\s+/g, ' ').trim();
      if (!text) return error('no-speech', 422);
      return json({ text });
    } catch (err) {
      console.error('ai transcribe failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  'POST /api/ai/cheer': [async (ctx) => {
    const guard = await aiGuard(ctx, false);
    if (guard) return guard;
    const b = ctx.body as any;
    try {
      const r = await generate({
        prompt: cheerPrompt(clamp(b.kind, 12), b.toName, b.goalTitle ?? null,
          { goals: b.goals, streak: b.streak, blooms: b.blooms }),
      });
      const line = oneLine(r.text, 140);
      if (!line) return error('ai-unavailable', 502);
      return json({ line });
    } catch (err) {
      console.error('ai cheer failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  'POST /api/ai/boost-replies': [async (ctx) => {
    const guard = await aiGuard(ctx, false);
    if (guard) return guard;
    const b = ctx.body as any;
    try {
      const r = await generate({
        prompt: repliesPrompt(b.struggleText),
        schema: REPLIES_SCHEMA,
      });
      const parsed = JSON.parse(r.text);
      const replies = (parsed.replies || []).map((s: unknown) => oneLine(String(s), 140)).filter(Boolean);
      if (replies.length < 3) return error('ai-unavailable', 502);
      return json({ replies: replies.slice(0, 3) });
    } catch (err) {
      console.error('ai replies failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  'POST /api/ai/insights': [async (ctx) => {
    const guard = await aiGuard(ctx, false);
    if (guard) return guard;
    const b = ctx.body as any;
    try {
      const r = await generate({
        prompt: insightsPrompt({ reflections: b.reflections, stats: b.stats }),
        maxTokens: 400,
      });
      const text = clamp(r.text, 700);
      if (!text) return error('ai-unavailable', 502);
      return json({ text });
    } catch (err) {
      console.error('ai insights failed', err);
      return error('ai-unavailable', 502);
    }
  }],
});

// ---------- the grove keeper's daily round (cron) ----------
// 1. Sentiment: classify the last two days' struggle posts into a small
//    aggregate (labels only — raw text never reaches the dashboard).
// 2. Workflow nudges: one warm note to stalled members (≥7 quiet days), and
//    one to a circle-mate when a struggle has sat unsupported ≥48h.
// Quiet-mode members are never nudged; everyone is capped to one workflow
// note per week; every note lands as a logged nudges row.
export const groveKeeperDaily = async (_event: unknown) => {
  const now = Date.now();
  const today = todayKey(now);
  const [circles, members, events, nudges] = await Promise.all([
    listAll('circles', {}), listAll('members', {}), listAll('events', {}), listAll('nudges', {}),
  ]);

  // -- sentiment --
  try {
    const existing = await listAll('sentimentDaily', { day: today });
    if (!existing[0]) {
      const since = now - 2 * DAY_MS;
      const texts = events
        .filter(e => e.type === 'struggle' && e.createdAt >= since && e.payload && e.payload.text)
        .map(e => String(e.payload.text))
        .slice(0, 20);
      if (texts.length > 0) {
        const counts: Record<string, number> = { upbeat: 0, steady: 0, strained: 0 };
        let sampled = 0;
        for (const t of texts) {
          const r = await ai.classify({
            prompt: 'Classify the emotional tone of this short post from a goals-support circle.',
            content: t, labels: SENTIMENT_LABELS, thinkingMode: 'NONE', maxRetries: 1,
          });
          if (counts[r.label] != null) { counts[r.label] += 1; sampled += 1; }
        }
        if (sampled > 0) await db.add('sentimentDaily', [{ day: today, ...counts, sampled }]);
      }
    }
  } catch (err) {
    // AI resting (429) or hiccuping must never break the keeper's round.
    console.warn('sentiment pass skipped', err);
  }

  // -- workflow nudges --
  const lastSeen = new Map<string, number>();
  for (const e of events) {
    if ((lastSeen.get(e.memberId) ?? 0) < e.createdAt) lastSeen.set(e.memberId, e.createdAt);
  }
  const recentlyNudged = (memberId: string) => nudges.some(n =>
    n.memberId === memberId && n.source === 'workflow'
    && now - (n.createdAt ?? 0) < NUDGE_COOLDOWN_DAYS * DAY_MS);
  const addNudge = async (memberId: string, circleId: string, text: string) => {
    await db.add('nudges', [{
      circleId, memberId, text, source: 'workflow',
      day: today, createdAt: now, deliveredAt: 0,
    }]);
  };

  let sent = 0;
  for (const m of members) {
    if (m.quiet) continue;
    const seen = lastSeen.get(m.id) ?? m.joinedAt ?? 0;
    if (now - seen < STALLED_DAYS * DAY_MS) continue;
    if (recentlyNudged(m.id)) continue;
    await addNudge(m.id, m.circleId, pickNudge('stalled', { name: m.name }, seen + m.id.length));
    sent += 1;
  }

  for (const e of events) {
    if (e.type !== 'struggle') continue;
    const ageHours = (now - e.createdAt) / 3600000;
    if (ageHours < STRUGGLE_UNSUPPORTED_HOURS || ageHours > 7 * 24) continue;
    const supported = events.some(x => x.circleId === e.circleId && x.createdAt > e.createdAt
      && (x.type === 'recover'
        || (x.type === 'cheer' && x.payload && x.payload.toMemberId === e.memberId)));
    if (supported) continue;
    const struggler = members.find(x => x.id === e.memberId);
    const mates = members.filter(x => x.circleId === e.circleId && x.id !== e.memberId
      && !x.quiet && !recentlyNudged(x.id));
    const mate = mates[0];
    if (!mate || !struggler) continue;
    await addNudge(mate.id, e.circleId,
      pickNudge('struggle', { friend: struggler.name }, e.createdAt));
    sent += 1;
  }

  console.log(`grove keeper round: ${sent} nudge(s), ${circles.length} circle(s)`);
  return { statusCode: 200 };
};
