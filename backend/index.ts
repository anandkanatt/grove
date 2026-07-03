// Grove backend — circles, members, an append-only event log, and the
// Whisperer AI routes. Anonymous identity: creating/joining mints a memberKey
// (returned once, held on-device); every write presents memberId + memberKey.
import { router, json, error, db, invites, isInviteError, ai } from '@appdeploy/sdk';
import {
  GROVE_TONE, STEPS_SCHEMA, REPLIES_SCHEMA, HISTORY_CAP, MAX_REAL_MEMBERS,
  todayKey, clamp, capExceeded, validEvent, oneLine,
  stepsPrompt, cheerPrompt, repliesPrompt, insightsPrompt,
} from './grove';

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
