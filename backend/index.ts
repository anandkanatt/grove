// Grove backend — circles, members, an append-only event log, and the
// Whisperer AI routes. Anonymous identity: creating/joining mints a memberKey
// (returned once, held on-device); every write presents memberId + memberKey.
import {
  router, json, error, db, invites, isInviteError, ai,
  storage, notifications, secrets,
  requireAuth, requireAdminEmailAllowlist,
} from '@appdeploy/sdk';
import {
  GROVE_TONE, STEPS_SCHEMA, REPLIES_SCHEMA, HISTORY_CAP, MAX_REAL_MEMBERS,
  todayKey, clamp, capExceeded, validEvent, oneLine,
  stepsPrompt, cheerPrompt, repliesPrompt, insightsPrompt,
  SENTIMENT_LABELS, DAY_MS, buildOverview, buildInterventions,
  GOAL_DOMAINS, GOAL_IDEAS_SCHEMA, goalIdeasPrompt, transcribePrompt,
  MESSAGE_CAP, MENTOR_ID, MENTOR_TONES, validTextMessage,
  mentorSystem, mentorChatPrompt, ASSESS_SCHEMA, assessPrompt,
  CAMPAIGN_CHANNELS, validCampaign, matchCampaign, renderTemplate,
  DEFAULT_FLAGS, DEFAULT_CAMPAIGNS,
  EVAL_CASES, evalProgChecks, JUDGE_SCHEMA, judgePrompt, summarizeEvalCases,
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
// The keeper can raise or lower a circle's cap via circles.aiCapOverride.
async function aiAllowed(circleId: string, memberId: string, isCoach: boolean) {
  const day = todayKey(Date.now());
  const [circleRow] = await db.get<Record<string, any>>('circles', [circleId]);
  const circleCap = circleRow && Number(circleRow.aiCapOverride) > 0
    ? Number(circleRow.aiCapOverride) : undefined;
  const rows = await listAll('aiUsage', { circleId, day });
  let row = rows[0];
  if (!row) {
    const [id] = await db.add('aiUsage', [{ circleId, day, count: 0, byMember: {} }]);
    if (!id) return false;
    row = { id, circleId, day, count: 0, byMember: {} };
  }
  if (capExceeded(row, memberId, isCoach, circleCap)) return false;
  const byMember = { ...(row.byMember ?? {}) };
  byMember[memberId] = (byMember[memberId] ?? 0) + 1;
  await db.update('aiUsage', [{
    id: row.id,
    record: { circleId, day, count: (row.count ?? 0) + 1, byMember },
  }]);
  return true;
}

// Feature flags: one row in the flags table, defaults when absent.
async function readFlags() {
  const rows = await listAll('flags', {});
  return { ...DEFAULT_FLAGS, ...(rows[0] || {}) };
}
async function writeFlags(next: Record<string, unknown>) {
  const rows = await listAll('flags', {});
  const record = {
    whisperer: next.whisperer !== false,
    newCircles: next.newCircles !== false,
    banner: clamp(next.banner, 160),
  };
  if (rows[0]) await db.update('flags', [{ id: rows[0].id, record }]);
  else await db.add('flags', [record]);
  return record;
}

// Every admin mutation leaves a trace the keeper can read back.
async function audit(email: string | undefined, action: string, target: string, detail?: string) {
  await db.add('adminAudit', [{
    at: Date.now(), email: email || 'unknown',
    action: clamp(action, 60), target: clamp(target, 80), detail: clamp(detail, 200),
  }]);
}

const ADMIN = [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS)];

// Shared guard for AI routes: body carries {circleId, memberId, memberKey}.
async function aiGuard(ctx: any, isCoach: boolean) {
  const b = ctx.body as any;
  const member = await getMember(b?.circleId, b?.memberId, b?.memberKey);
  if (!member) return error('unauthorized', 401);
  const flags = await readFlags();
  if (!flags.whisperer) return error('ai-off', 503);
  if (!(await aiAllowed(b.circleId, b.memberId, isCoach))) return error('ai-rest', 429);
  return null;
}

// ---------- circle chat (messages live beside, not inside, the event log) ----------

async function circleMessages(circleId: string) {
  const items = await listAll('messages', { circleId });
  return items.sort((a, b) =>
    (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
}

async function addMessage(circle: Record<string, any> & { id: string },
  memberId: string, fields: Record<string, unknown>) {
  const at = Math.max(Date.now(), (circle.lastMsgAt ?? 0) + 1);
  circle.lastMsgAt = at;
  await db.update('circles', [{ id: circle.id, record: { ...circle, id: undefined, lastMsgAt: at } }]);
  const [id] = await db.add('messages', [{ circleId: circle.id, memberId, createdAt: at, ...fields }]);
  return { id, createdAt: at };
}

async function pruneMessages(circleId: string) {
  const all = await circleMessages(circleId);
  if (all.length > MESSAGE_CAP) {
    const drop = all.slice(0, all.length - MESSAGE_CAP);
    const voicePaths = drop.filter(m => m.audioPath).map(m => String(m.audioPath));
    if (voicePaths.length) await storage.delete(voicePaths);
    await db.delete('messages', drop.map(m => m.id));
  }
}

const publicMessage = (m: Record<string, any>) => ({
  id: m.id, memberId: m.memberId, kind: m.kind,
  text: m.text, audioPath: m.audioPath, createdAt: m.createdAt,
});

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
    const flags = await readFlags();
    if (!flags.newCircles) return error('circles-paused', 503);
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
    const [fresh] = await db.get<Record<string, any>>('circles', [circleId]);
    if (fresh) await db.update('circles', [{ id: circleId, record: { ...fresh, id: undefined, inviteCode: created.code } }]);
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

  // ---------- circle chat + voice notes (phase 5) ----------

  'GET /api/circles/:id/messages': [async (ctx) => {
    const member = await getMember(ctx.params.id, ctx.query.memberId, ctx.query.memberKey);
    if (!member) return error('unauthorized', 401);
    const since = Number(ctx.query.since) || 0;
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    const msgs = (await circleMessages(ctx.params.id))
      .filter(m => m.createdAt > since)
      .slice(-100)
      .map(publicMessage);
    return json({ messages: msgs, mentor: (circle && circle.mentor) || null });
  }],

  'POST /api/circles/:id/messages': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    let fields: Record<string, unknown>;
    if (b?.kind === 'voice') {
      const audio = typeof b.audio === 'string' ? b.audio : '';
      const mimeType = clamp(b.mimeType, 40);
      if (!audio || audio.length > 1400000 || mimeType.indexOf('audio/') !== 0) {
        return error('bad-audio', 400);
      }
      const path = `voice/${ctx.params.id}/${crypto.randomUUID()}`;
      const [ok] = await storage.write([{ path, content: audio, contentType: mimeType }]);
      if (!ok) return error('storage-failed', 500);
      fields = { kind: 'voice', audioPath: path };
    } else {
      const text = clamp(b?.text, 500);
      if (!validTextMessage(text)) return error('empty-message', 400);
      fields = { kind: 'text', text };
    }
    const { id, createdAt } = await addMessage({ ...circle, id: ctx.params.id }, member.id, fields);
    await pruneMessages(ctx.params.id);
    return json({ message: { id, memberId: member.id, createdAt, ...fields } });
  }],

  // Signed playback URL for a voice note; path is pinned to this circle.
  'GET /api/circles/:id/voice-url': [async (ctx) => {
    const member = await getMember(ctx.params.id, ctx.query.memberId, ctx.query.memberKey);
    if (!member) return error('unauthorized', 401);
    const path = String(ctx.query.path || '');
    if (path.indexOf(`voice/${ctx.params.id}/`) !== 0) return error('not-found', 404);
    const [{ url }] = await storage.url([path]);
    return json({ url });
  }],

  // ---------- the circle's AI mentor (phase 5a) ----------

  'POST /api/circles/:id/mentor': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    let mentor: Record<string, unknown> | null = null;
    if (!b?.remove) {
      const tone = MENTOR_TONES.indexOf(b?.tone) !== -1 ? b.tone : 'gentle';
      mentor = { name: clamp(b?.name, 30) || 'Sage', avatarId: clamp(b?.avatarId, 4) || '2', tone, enabledAt: Date.now() };
    }
    await db.update('circles', [{ id: ctx.params.id, record: { ...circle, id: undefined, mentor } }]);
    if (mentor) {
      await addMessage({ ...circle, id: ctx.params.id, mentor }, MENTOR_ID,
        { kind: 'text', text: `${mentor.name} settled in as your mentor. Ask me anything about your plans 🌿` });
    }
    return json({ mentor });
  }],

  'POST /api/circles/:id/mentor-chat': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const flags = await readFlags();
    if (!flags.whisperer) return error('ai-off', 503);
    if (!(await aiAllowed(ctx.params.id, member.id, false))) return error('ai-rest', 429);
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle || !circle.mentor) return error('no-mentor', 400);
    const question = clamp(b?.question, 400);
    if (!question) return error('empty-message', 400);
    const asked = await addMessage({ ...circle, id: ctx.params.id }, member.id,
      { kind: 'text', text: question, toMentor: true });
    try {
      const history = (await circleMessages(ctx.params.id))
        .filter(m => m.kind === 'text')
        .slice(-13, -1)
        .map(m => ({ from: m.memberId === MENTOR_ID ? String(circle.mentor.name) : 'member', text: String(m.text || '') }));
      const goals = Array.isArray(b?.goals) ? b.goals.slice(0, 4).map((g: unknown) => clamp(g, 45)) : [];
      const r = await ai.generate({
        system: mentorSystem(circle.mentor),
        prompt: mentorChatPrompt({ history, goals, asker: member.name, question }),
        maxTokens: 220, temperature: 0.7, thinkingMode: 'NONE',
      });
      const replyText = clamp(r.text, 400).replace(/\s+/g, ' ').trim();
      if (!replyText) return error('ai-unavailable', 502);
      const reply = await addMessage({ ...circle, id: ctx.params.id, lastMsgAt: asked.createdAt }, MENTOR_ID,
        { kind: 'text', text: replyText });
      await pruneMessages(ctx.params.id);
      return json({ reply: { id: reply.id, memberId: MENTOR_ID, kind: 'text', text: replyText, createdAt: reply.createdAt } });
    } catch (err) {
      console.error('mentor chat failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  'POST /api/ai/assess': [async (ctx) => {
    const guard = await aiGuard(ctx, true);
    if (guard) return guard;
    const b = ctx.body as any;
    const goalName = clamp(b?.goalName, 45);
    const steps = Array.isArray(b?.steps) ? b.steps.map((s: unknown) => clamp(s, 90)).filter(Boolean) : [];
    if (!goalName || !steps.length) return error('empty-plan', 400);
    try {
      const r = await generate({ prompt: assessPrompt(goalName, steps), schema: ASSESS_SCHEMA });
      const parsed = JSON.parse(r.text);
      const verdict = oneLine(String(parsed.verdict ?? ''), 160);
      const suggestions = (parsed.suggestions || [])
        .map((s: unknown) => oneLine(String(s), 90)).filter(Boolean).slice(0, 3);
      if (!verdict || !suggestions.length) return error('ai-unavailable', 502);
      return json({ verdict, suggestions });
    } catch (err) {
      console.error('ai assess failed', err);
      return error('ai-unavailable', 502);
    }
  }],

  // Public flags: banner + feature availability for every client.
  'GET /api/flags': [async () => json(await readFlags())],

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

  // Her chosen garden-time hour (UTC bucket); null switches the reminder off.
  'POST /api/circles/:id/reminder': [async (ctx) => {
    const b = ctx.body as any;
    const member = await getMember(ctx.params.id, b?.memberId, b?.memberKey);
    if (!member) return error('unauthorized', 401);
    const utcHour = b?.utcHour == null ? null : Math.max(0, Math.min(23, Number(b.utcHour) || 0));
    await db.update('members', [{ id: member.id, record: { ...member, id: undefined, reminderUtcHour: utcHour } }]);
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
    await audit(ctx.user!.email, 'nudge.manual', String(b.memberId), text.slice(0, 60));
    return json({ ok: true });
  }],

  // ---------- keeper's studio: campaign workflows ----------

  'GET /api/admin/campaigns': [...ADMIN, async () => {
    const rows = await listAll('campaigns', {});
    return json({ campaigns: rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) });
  }],

  'POST /api/admin/campaigns': [...ADMIN, async (ctx) => {
    const b = ctx.body as any;
    if (!validCampaign(b)) return error('invalid-campaign', 400);
    const record = {
      name: clamp(b.name, 40), trigger: b.trigger, days: Number(b.days) || 0,
      channels: b.channels.filter((c: string) => CAMPAIGN_CHANNELS.indexOf(c) !== -1),
      template: clamp(b.template, 240), cooldownDays: Number(b.cooldownDays) || 7,
      active: b.active !== false, createdAt: Date.now(), lastRunAt: 0, sentCount: 0,
    };
    const [id] = await db.add('campaigns', [record]);
    if (!id) return error('save-failed', 500);
    await audit(ctx.user!.email, 'campaign.create', record.name, record.trigger);
    return json({ campaign: { ...record, id } });
  }],

  'PUT /api/admin/campaigns/:id': [...ADMIN, async (ctx) => {
    const b = ctx.body as any;
    const [row] = await db.get<Record<string, any>>('campaigns', [ctx.params.id]);
    if (!row) return error('not-found', 404);
    const merged = { ...row, ...b, id: undefined };
    if (!validCampaign(merged)) return error('invalid-campaign', 400);
    await db.update('campaigns', [{ id: ctx.params.id, record: merged }]);
    await audit(ctx.user!.email, 'campaign.update', String(merged.name), merged.active ? 'active' : 'paused');
    return json({ ok: true });
  }],

  'DELETE /api/admin/campaigns/:id': [...ADMIN, async (ctx) => {
    const [row] = await db.get<Record<string, any>>('campaigns', [ctx.params.id]);
    if (!row) return error('not-found', 404);
    await db.delete('campaigns', [ctx.params.id]);
    await audit(ctx.user!.email, 'campaign.delete', String(row.name));
    return json({ ok: true });
  }],

  'POST /api/admin/campaigns/:id/run': [...ADMIN, async (ctx) => {
    const [row] = await db.get<Record<string, any>>('campaigns', [ctx.params.id]);
    if (!row) return error('not-found', 404);
    const result = await executeCampaign({ ...row, id: ctx.params.id }, Date.now());
    await audit(ctx.user!.email, 'campaign.run', String(row.name),
      `matched ${result.matched}, sent ${result.sent}`);
    return json(result);
  }],

  'GET /api/admin/campaigns/:id/log': [...ADMIN, async (ctx) => {
    const rows = await listAll('nudges', { campaignId: ctx.params.id });
    return json({
      log: rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 50)
        .map(n => ({ text: n.text, createdAt: n.createdAt, deliveredAt: n.deliveredAt, channel: n.channel || 'note' })),
    });
  }],

  'GET /api/admin/channels': [...ADMIN, async () => {
    const names = await secrets.listSecretNames();
    return json({
      note: 'ready',
      push: 'ready for claimed accounts',
      email: names.indexOf('RESEND_API_KEY') !== -1 ? 'key present — adapter pending' : 'needs provider key (RESEND_API_KEY)',
      whatsapp: names.indexOf('WHATSAPP_TOKEN') !== -1 ? 'key present — adapter pending' : 'needs provider key (WHATSAPP_TOKEN)',
    });
  }],

  // ---------- keeper ops: browse, moderate, intervene ----------

  'GET /api/admin/circles': [...ADMIN, async () => {
    const [circles, members, events, usage] = await Promise.all([
      listAll('circles', {}), listAll('members', {}), listAll('events', {}), listAll('aiUsage', {}),
    ]);
    const today = todayKey(Date.now());
    const lastByCircle = new Map<string, number>();
    for (const e of events) {
      if ((lastByCircle.get(e.circleId) ?? 0) < e.createdAt) lastByCircle.set(e.circleId, e.createdAt);
    }
    return json({
      circles: circles.map(c => ({
        id: c.id, name: c.name, createdAt: c.createdAt,
        members: members.filter(m => m.circleId === c.id).length,
        lastEventAt: lastByCircle.get(c.id) || c.createdAt,
        mentor: c.mentor ? c.mentor.name : null,
        aiToday: usage.filter(u => u.circleId === c.id && u.day === today)
          .reduce((s, u) => s + (u.count ?? 0), 0),
        aiCapOverride: c.aiCapOverride || null,
      })).sort((a, b) => b.lastEventAt - a.lastEventAt),
    });
  }],

  'GET /api/admin/circles/:id': [...ADMIN, async (ctx) => {
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    const [members, events, msgs] = await Promise.all([
      circleMembers(ctx.params.id), circleEvents(ctx.params.id), circleMessages(ctx.params.id),
    ]);
    const last = new Map<string, number>();
    for (const e of events) {
      if ((last.get(e.memberId) ?? 0) < e.createdAt) last.set(e.memberId, e.createdAt);
    }
    return json({
      circle: {
        id: ctx.params.id, name: circle.name, createdAt: circle.createdAt,
        mentor: circle.mentor || null, inviteCode: circle.inviteCode || null,
        aiCapOverride: circle.aiCapOverride || null,
      },
      members: members.map(m => ({
        id: m.id, name: m.name, avatarId: m.avatarId, quiet: !!m.quiet,
        claimed: !!m.userId, joinedAt: m.joinedAt, lastSeen: last.get(m.id) || m.joinedAt,
      })),
      counts: { events: events.length, messages: msgs.length },
    });
  }],

  'POST /api/admin/circles/:id/regen-invite': [...ADMIN, async (ctx) => {
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    if (circle.inviteCode) {
      try { await invites.revoke({ code: String(circle.inviteCode) }); } catch (err) { /* already gone */ }
    }
    const created = await invites.create({
      resourceType: 'circle', authMode: 'anonymous', context: { circleId: ctx.params.id },
    });
    await db.update('circles', [{ id: ctx.params.id, record: { ...circle, id: undefined, inviteCode: created.code } }]);
    await audit(ctx.user!.email, 'circle.regen-invite', String(circle.name));
    return json({ inviteCode: created.code });
  }],

  'POST /api/admin/members/:id/remove': [...ADMIN, async (ctx) => {
    const [member] = await db.get<Record<string, any>>('members', [ctx.params.id]);
    if (!member) return error('not-found', 404);
    const [circle] = await db.get<Record<string, any>>('circles', [String(member.circleId)]);
    if (circle) {
      await addEvent({ ...circle, id: String(member.circleId) }, ctx.params.id,
        crypto.randomUUID(), 'leave', { name: member.name });
    }
    await db.delete('members', [ctx.params.id]);
    await audit(ctx.user!.email, 'member.remove', String(member.name), String(member.circleId));
    return json({ ok: true });
  }],

  'POST /api/admin/circles/:id/purge': [...ADMIN, async (ctx) => {
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    const [members, events, msgs, nudgeRows] = await Promise.all([
      listAll('members', { circleId: ctx.params.id }), listAll('events', { circleId: ctx.params.id }),
      listAll('messages', { circleId: ctx.params.id }), listAll('nudges', { circleId: ctx.params.id }),
    ]);
    const { paths } = await storage.list({ prefix: `voice/${ctx.params.id}/`, limit: 500 });
    if (paths.length) await storage.delete(paths);
    if (events.length) await db.delete('events', events.map(e => e.id));
    if (msgs.length) await db.delete('messages', msgs.map(m => m.id));
    if (nudgeRows.length) await db.delete('nudges', nudgeRows.map(n => n.id));
    if (members.length) await db.delete('members', members.map(m => m.id));
    await db.delete('circles', [ctx.params.id]);
    await audit(ctx.user!.email, 'circle.purge', String(circle.name),
      `${members.length} members, ${events.length} events, ${msgs.length} messages`);
    return json({ ok: true });
  }],

  'DELETE /api/admin/messages/:id': [...ADMIN, async (ctx) => {
    const [msg] = await db.get<Record<string, any>>('messages', [ctx.params.id]);
    if (!msg) return error('not-found', 404);
    if (msg.audioPath) await storage.delete([String(msg.audioPath)]);
    await db.delete('messages', [ctx.params.id]);
    await audit(ctx.user!.email, 'message.delete', ctx.params.id, String(msg.kind));
    return json({ ok: true });
  }],

  'DELETE /api/admin/events/:id': [...ADMIN, async (ctx) => {
    const [ev] = await db.get<Record<string, any>>('events', [ctx.params.id]);
    if (!ev) return error('not-found', 404);
    await db.delete('events', [ctx.params.id]);
    await audit(ctx.user!.email, 'event.delete', ctx.params.id, String(ev.type));
    return json({ ok: true });
  }],

  'POST /api/admin/circles/:id/ai': [...ADMIN, async (ctx) => {
    const b = ctx.body as any;
    const [circle] = await db.get<Record<string, any>>('circles', [ctx.params.id]);
    if (!circle) return error('not-found', 404);
    if (b?.resetToday) {
      const rows = await listAll('aiUsage', { circleId: ctx.params.id, day: todayKey(Date.now()) });
      for (const r of rows) {
        await db.update('aiUsage', [{ id: r.id, record: { ...r, id: undefined, count: 0, byMember: {} } }]);
      }
    }
    if ('capOverride' in (b || {})) {
      const cap = Number(b.capOverride);
      await db.update('circles', [{
        id: ctx.params.id,
        record: { ...circle, id: undefined, aiCapOverride: cap > 0 ? Math.min(cap, 500) : null },
      }]);
    }
    await audit(ctx.user!.email, 'circle.ai', String(circle.name),
      `${b?.resetToday ? 'reset today; ' : ''}cap ${b?.capOverride ?? 'unchanged'}`);
    return json({ ok: true });
  }],

  // ---------- model evals (golden set, judge-scored, admin-triggered) ----------

  'GET /api/admin/evals/cases': [...ADMIN, async () => json({
    cases: EVAL_CASES.map(c => ({ id: c.id, feature: c.feature })),
  })],

  // One case per call: one generation + one judge, well inside route timeouts.
  'POST /api/admin/evals/run-case': [...ADMIN, async (ctx) => {
    const b = ctx.body as any;
    const evalCase = EVAL_CASES.find(c => c.id === b?.caseId);
    if (!evalCase) return error('not-found', 404);
    const input = evalCase.input as any;
    let output: Record<string, unknown>;
    try {
      if (evalCase.feature === 'steps') {
        const r = await generate({ prompt: stepsPrompt(input.goalName, input.domain), schema: STEPS_SCHEMA });
        const parsed = JSON.parse(r.text);
        output = { steps: (parsed.steps || []).map((s: unknown) => oneLine(String(s), 120)) };
      } else if (evalCase.feature === 'ideas') {
        const r = await generate({ prompt: goalIdeasPrompt(input.seed, input.domain), schema: GOAL_IDEAS_SCHEMA });
        output = { ideas: JSON.parse(r.text).ideas || [] };
      } else if (evalCase.feature === 'mentor') {
        const r = await ai.generate({
          system: mentorSystem({ name: 'Sage', tone: input.tone }),
          prompt: mentorChatPrompt({ history: [], goals: input.goals || [], asker: 'a member', question: input.question }),
          maxTokens: 220, temperature: 0.7, thinkingMode: 'NONE',
        });
        output = { text: clamp(r.text, 600).replace(/\s+/g, ' ').trim() };
      } else if (evalCase.feature === 'cheer') {
        const r = await generate({ prompt: cheerPrompt(input.kind, input.toName, null, {}) });
        output = { text: oneLine(r.text, 200) };
      } else {
        const r = await generate({ prompt: assessPrompt(input.goalName, input.steps), schema: ASSESS_SCHEMA });
        const parsed = JSON.parse(r.text);
        output = {
          verdict: oneLine(String(parsed.verdict ?? ''), 160),
          suggestions: (parsed.suggestions || []).map((s: unknown) => oneLine(String(s), 120)),
        };
      }
    } catch (err) {
      console.error('eval generation failed', evalCase.id, err);
      return json({
        id: evalCase.id, feature: evalCase.feature, pass: false,
        output: { error: 'generation-failed' },
        prog: { pass: false, notes: ['generation failed'] },
        judge: { warmth: 0, concreteness: 0, safe: false, reason: 'generation failed' },
      });
    }
    const prog = evalProgChecks(evalCase.feature, output);
    let judge = { warmth: 0, concreteness: 0, safe: false, reason: 'judge unavailable' };
    try {
      const r = await ai.generate({
        system: 'You are a strict quality auditor. Respond only via the schema.',
        prompt: judgePrompt(evalCase.feature, input, output),
        schema: JUDGE_SCHEMA, temperature: 0, thinkingMode: 'NONE', maxTokens: 220,
      });
      const parsed = JSON.parse(r.text);
      judge = {
        warmth: Math.max(0, Math.min(5, Number(parsed.warmth) || 0)),
        concreteness: Math.max(0, Math.min(5, Number(parsed.concreteness) || 0)),
        safe: parsed.safe === true,
        reason: oneLine(String(parsed.reason ?? ''), 120),
      };
    } catch (err) {
      console.error('eval judge failed', evalCase.id, err);
    }
    const pass = prog.pass && judge.safe && judge.warmth >= 3 && judge.concreteness >= 3;
    return json({ id: evalCase.id, feature: evalCase.feature, input, output, prog, judge, pass });
  }],

  'POST /api/admin/evals/save': [...ADMIN, async (ctx) => {
    const b = ctx.body as any;
    const cases = Array.isArray(b?.cases) ? b.cases.slice(0, 20) : [];
    if (!cases.length) return error('empty-run', 400);
    const summary = summarizeEvalCases(cases);
    const record = {
      at: Date.now(),
      summary,
      cases: cases.map((c: any) => ({
        id: clamp(c.id, 30), feature: clamp(c.feature, 20), pass: !!c.pass,
        notes: (c.prog && c.prog.notes || []).slice(0, 6).map((n: unknown) => clamp(n, 90)),
        judge: c.judge ? {
          warmth: Number(c.judge.warmth) || 0,
          concreteness: Number(c.judge.concreteness) || 0,
          safe: !!c.judge.safe, reason: clamp(c.judge.reason, 120),
        } : null,
        output: clamp(JSON.stringify(c.output ?? {}), 700),
      })),
    };
    const [id] = await db.add('evalRuns', [record]);
    if (!id) return error('save-failed', 500);
    await audit(ctx.user!.email, 'evals.run', `${summary.passed}/${summary.total} passed`);
    return json({ run: { ...record, id } });
  }],

  'GET /api/admin/evals/runs': [...ADMIN, async () => {
    const rows = await listAll('evalRuns', {});
    const sorted = rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return json({
      runs: sorted.slice(0, 12).map(r => ({ id: r.id, at: r.at, summary: r.summary })),
      latest: sorted[0] || null,
    });
  }],

  'GET /api/admin/flags': [...ADMIN, async () => json(await readFlags())],

  'PUT /api/admin/flags': [...ADMIN, async (ctx) => {
    const next = await writeFlags(ctx.body as Record<string, unknown>);
    await audit(ctx.user!.email, 'flags.update', '',
      `whisperer=${next.whisperer} newCircles=${next.newCircles} banner=${next.banner ? 'set' : 'clear'}`);
    return json(next);
  }],

  'GET /api/admin/audit': [...ADMIN, async () => {
    const rows = await listAll('adminAudit', {});
    return json({
      audit: rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 100),
    });
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

  // -- campaign workflows (the built-in nudges are just the two seeded defaults) --
  await ensureDefaultCampaigns();
  const campaigns = await listAll('campaigns', {});
  let sent = 0;
  for (const c of campaigns) {
    if (!c.active) continue;
    const result = await executeCampaign(c, now);
    sent += result.sent;
  }

  console.log(`grove keeper round: ${sent} note(s), ${circles.length} circle(s), ${campaigns.length} campaign(s)`);
  return { statusCode: 200 };
};

// Garden-time reminders: her chosen hour, only if she has not tended today,
// never in quiet mode, once per day, push-only (claimed accounts).
export const groveReminderHourly = async (_event: unknown) => {
  const now = Date.now();
  const hour = new Date(now).getUTCHours();
  const today = todayKey(now);
  const [members, events, nudges] = await Promise.all([
    listAll('members', {}), listAll('events', {}), listAll('nudges', {}),
  ]);
  const activeToday = new Set(
    events.filter(e => todayKey(e.createdAt) === today).map(e => e.memberId));
  let sent = 0;
  for (const m of members) {
    if (m.quiet || !m.userId) continue;
    if (m.reminderUtcHour == null || Number(m.reminderUtcHour) !== hour) continue;
    if (activeToday.has(m.id)) continue;
    const already = nudges.some(n =>
      n.memberId === m.id && n.source === 'reminder' && n.day === today);
    if (already) continue;
    try {
      await notifications.send({
        userIds: [String(m.userId)],
        notification: { title: 'Garden time 🌿', body: 'Your plants are waiting for one tiny step.' },
        data: { kind: 'garden-time' },
      });
      await db.add('nudges', [{
        circleId: m.circleId, memberId: m.id, text: 'Garden time 🌿',
        source: 'reminder', channel: 'push', day: today, createdAt: now, deliveredAt: now,
      }]);
      sent += 1;
    } catch (err) {
      console.warn('reminder send failed', err);
    }
  }
  console.log(`garden-time reminders: ${sent} at UTC hour ${hour}`);
  return { statusCode: 200 };
};

// Seed the two classic keeper behaviors as editable campaigns, exactly once.
async function ensureDefaultCampaigns() {
  const existing = await listAll('campaigns', {});
  if (existing.length) return;
  for (const c of DEFAULT_CAMPAIGNS) {
    await db.add('campaigns', [{ ...c, createdAt: Date.now(), lastRunAt: 0, sentCount: 0 }]);
  }
}

// Run one campaign now: match members, deliver on each channel, log every send.
async function executeCampaign(campaign: Record<string, any>, now: number) {
  const [members, events, nudges] = await Promise.all([
    listAll('members', {}), listAll('events', {}), listAll('nudges', {}),
  ]);
  const targets = matchCampaign(campaign, { members, events, nudges, now });
  const channels: string[] = Array.isArray(campaign.channels) ? campaign.channels : ['note'];
  let sent = 0, pushSkipped = 0;
  for (const t of targets) {
    const text = renderTemplate(String(campaign.template),
      { name: t.member.name, friend: t.friendName });
    if (channels.indexOf('note') !== -1) {
      await db.add('nudges', [{
        circleId: t.member.circleId, memberId: t.member.id, text,
        source: 'workflow', campaignId: campaign.id, channel: 'note',
        day: todayKey(now), createdAt: now, deliveredAt: 0,
      }]);
      sent += 1;
    }
    if (channels.indexOf('push') !== -1) {
      if (t.member.userId) {
        try {
          await notifications.send({
            userIds: [String(t.member.userId)],
            notification: { title: 'A note from your grove 🌿', body: text },
            data: { kind: 'keeper-note' },
          });
          await db.add('nudges', [{
            circleId: t.member.circleId, memberId: t.member.id, text,
            source: 'workflow', campaignId: campaign.id, channel: 'push',
            day: todayKey(now), createdAt: now, deliveredAt: now,
          }]);
          sent += 1;
        } catch (err) {
          console.warn('push send failed', err);
        }
      } else {
        pushSkipped += 1;
      }
    }
  }
  await db.update('campaigns', [{
    id: campaign.id,
    record: {
      ...campaign, id: undefined,
      lastRunAt: now, sentCount: (campaign.sentCount ?? 0) + sent,
    },
  }]);
  return { matched: targets.length, sent, pushSkipped };
}
