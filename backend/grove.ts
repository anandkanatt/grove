// Grove backend helpers — pure functions and constants only (no SDK imports),
// so behavior stays reviewable apart from transport code.

export const GROVE_TONE = [
  'You are the Grove Whisperer, a gentle companion inside Grove — a cozy game',
  'where women grow real-life goals into a garden alongside friends.',
  'Voice: warm, capable, encouraging, plain language. Never scolding, never',
  'salesy, no guilt, no "girl boss" clichés, no toxic positivity.',
  'Tiny steps beat big plans: concrete implementation-intention actions that',
  'each fit inside a single ordinary day.',
].join(' ');

export const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: { type: 'string' },
      minItems: 6,
      maxItems: 10,
    },
  },
  required: ['steps'],
};

export const REPLIES_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['replies'],
};

export const EVENT_TYPES = ['step', 'bloom', 'struggle', 'recover', 'cheer', 'join', 'leave'];
export const HISTORY_CAP = 200;       // events kept per circle
export const CIRCLE_AI_CAP = 40;      // AI calls per circle per day
export const COACH_MEMBER_CAP = 5;    // coach (steps) calls per member per day
export const MAX_REAL_MEMBERS = 5;

export function todayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export function clamp(text: unknown, max: number): string {
  return String(text == null ? '' : text).trim().slice(0, max);
}

export interface AiUsageRow {
  count?: number;
  byMember?: Record<string, number>;
}

export function capExceeded(usage: AiUsageRow, memberId: string, isCoach: boolean): boolean {
  if ((usage.count ?? 0) >= CIRCLE_AI_CAP) return true;
  if (isCoach && ((usage.byMember ?? {})[memberId] ?? 0) >= COACH_MEMBER_CAP) return true;
  return false;
}

export function validEvent(e: any): boolean {
  if (!e || typeof e !== 'object') return false;
  if (typeof e.clientKey !== 'string' || !e.clientKey || e.clientKey.length > 64) return false;
  if (EVENT_TYPES.indexOf(e.type) === -1) return false;
  let payloadSize = 0;
  try { payloadSize = JSON.stringify(e.payload ?? {}).length; } catch { return false; }
  return payloadSize <= 2048;
}

export function oneLine(text: string, max: number): string {
  return clamp(text, max).split('\n')[0].replace(/^["'“”\s]+|["'“”\s]+$/g, '').slice(0, max);
}

// Prompt builders — every string the AI sees is assembled here.
export function stepsPrompt(goalName: string, domain: string): string {
  return `A player wants to achieve: "${clamp(goalName, 60)}" (life area: ${clamp(domain, 20)}). `
    + 'Draft 6 to 10 tiny steps toward it. Each step: one concrete action that fits in a '
    + 'single day, phrased as a plain instruction (like "Put on your shoes and walk for '
    + '10 minutes"), no numbering, no emojis, under 90 characters.';
}

export function cheerPrompt(kind: string, toName: string, goalTitle: string | null,
  context: { goals?: string[]; streak?: number; blooms?: number }): string {
  if (kind === 'daily') {
    const goals = (context.goals || []).slice(0, 4).join('; ') || 'her quiet goals';
    return `Write ONE short affirmation (under 120 characters) to open her day in the garden. `
      + `She is tending: ${goals}. Streak: ${context.streak ?? 0} days. `
      + `Goals finished so far: ${context.blooms ?? 0}. Speak to her directly. No hashtags.`;
  }
  if (kind === 'struggle') {
    return `Her friend ${clamp(toName, 30)} is having a hard week. Write ONE supportive line `
      + '(under 120 characters) to send her. Kind, steady, no advice, no platitudes.';
  }
  return `Her friend ${clamp(toName, 30)} just took a real step toward `
    + `"${goalTitle ? clamp(goalTitle, 60) : 'a goal she keeps private'}". Write ONE warm, `
    + 'specific cheer (under 120 characters) to send her. No hashtags.';
}

export function repliesPrompt(struggleText: string): string {
  return `A friend in her circle posted that she is struggling: "${clamp(struggleText, 300)}". `
    + 'Write exactly 3 different short replies she could send (each under 140 characters): '
    + 'one steady and reassuring, one gently lightening the mood, one that simply says '
    + 'she is seen. No advice unless asked, no platitudes.';
}

export function insightsPrompt(payload: unknown): string {
  return 'Here is a compact JSON digest of her journal reflections and step-timing stats: '
    + clamp(JSON.stringify(payload ?? {}), 4000)
    + ' — In 3 to 4 warm sentences, reflect back what you notice: patterns in when she '
    + 'shows up, what her reflections say about her, one gentle observation to carry '
    + 'forward. Speak to her directly. No bullet points.';
}

// ---------- phase 4: grove keeper (admin) helpers ----------

export const SENTIMENT_LABELS = ['upbeat', 'steady', 'strained'];
export const STALLED_DAYS = 7;
export const STRUGGLE_UNSUPPORTED_HOURS = 48;
export const NUDGE_COOLDOWN_DAYS = 7;
export const DAY_MS = 86400000;

// Warm, never-guilt nudge copy. {name} = recipient; {friend} = the struggling friend.
export const NUDGE_TEMPLATES: Record<string, string[]> = {
  stalled: [
    'The grove kept your place, {name}. One tiny step is all a garden ever asks. 🌿',
    'No catching up needed, {name} — just one small watering whenever you like. 🌱',
    'Your plants are patient, {name}. A five-minute step still counts. 🌤️',
    'Gardens rest too, {name}. When you are ready, the soil is warm. 🌻',
  ],
  struggle: [
    '{friend} is having a heavy week. A little of your sunshine would mean a lot. ☀️',
    'Your circle-mate {friend} could use a kind word today. 💛',
    '{friend} posted that she is struggling — even one warm line helps. 🌈',
  ],
};

export function pickNudge(kind: string, names: { name?: string; friend?: string }, seed: number): string {
  const pool = NUDGE_TEMPLATES[kind] || NUDGE_TEMPLATES.stalled;
  const line = pool[Math.abs(seed) % pool.length];
  return line
    .split('{name}').join(names.name || 'friend')
    .split('{friend}').join(names.friend || 'a friend');
}

type Row = Record<string, any> & { id: string };

function lastEventByMember(events: Row[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const e of events) {
    if ((last.get(e.memberId) ?? 0) < e.createdAt) last.set(e.memberId, e.createdAt);
  }
  return last;
}

// Activity is derived from the retained event log (joinedAt as fallback) —
// no per-event member writes. History pruning caps each circle at 200 events,
// so "quiet" here means "no retained activity", which is what the keeper
// cares about anyway.
export function memberLastSeen(m: Row, last: Map<string, number>): number {
  return last.get(m.id) ?? m.joinedAt ?? 0;
}

export function buildOverview(input: {
  circles: Row[]; members: Row[]; events: Row[];
  usage: Row[]; senti: Row[]; nudges: Row[]; now: number;
}) {
  const { circles, members, events, usage, senti, nudges, now } = input;
  const today = todayKey(now);
  const last = lastEventByMember(events);

  const days: Array<Record<string, any>> = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = now - i * DAY_MS;
    days.push({ day: todayKey(dayStart), step: 0, bloom: 0, cheer: 0, struggle: 0, recover: 0, join: 0, leave: 0 });
  }
  const byDay = new Map(days.map(d => [d.day, d]));
  const domains: Record<string, { steps: number; blooms: number }> = {};
  for (const e of events) {
    const bucket = byDay.get(todayKey(e.createdAt));
    if (bucket && bucket[e.type] != null) bucket[e.type] += 1;
    if (e.type === 'step' || e.type === 'bloom') {
      const d = (e.payload && e.payload.domain) || 'earlier';
      domains[d] = domains[d] || { steps: 0, blooms: 0 };
      if (e.type === 'step') domains[d].steps += 1; else domains[d].blooms += 1;
    }
  }

  const activeSince = now - 7 * DAY_MS;
  const activeMembers7d = members.filter(m => memberLastSeen(m, last) >= activeSince).length;
  const newMembers7d = members.filter(m => (m.joinedAt ?? 0) >= activeSince).length;

  // Median hours from a struggle to that circle's next recover.
  const supportHours: number[] = [];
  const byCircle = new Map<string, Row[]>();
  for (const e of events) {
    if (!byCircle.has(e.circleId)) byCircle.set(e.circleId, []);
    byCircle.get(e.circleId)!.push(e);
  }
  for (const list of byCircle.values()) {
    const sorted = list.slice().sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].type !== 'struggle') continue;
      const recover = sorted.slice(i + 1).find(x => x.type === 'recover' || x.type === 'cheer');
      if (recover) supportHours.push((recover.createdAt - sorted[i].createdAt) / 3600000);
    }
  }
  supportHours.sort((a, b) => a - b);
  const medianSupportHours = supportHours.length
    ? Math.round(supportHours[Math.floor(supportHours.length / 2)] * 10) / 10 : null;

  const weekAgoKey = todayKey(now - 7 * DAY_MS);
  return {
    generatedAt: now,
    health: {
      circles: circles.length,
      members: members.length,
      activeMembers7d,
      newMembers7d,
      eventsByDay: days,
    },
    goals: { domains },
    community: {
      medianSupportHours,
      circleSizes: circles.map(c => members.filter(m => m.circleId === c.id).length),
    },
    whisperer: {
      callsToday: usage.filter(u => u.day === today).reduce((s, u) => s + (u.count ?? 0), 0),
      calls7d: usage.filter(u => u.day >= weekAgoKey).reduce((s, u) => s + (u.count ?? 0), 0),
    },
    sentiment: senti
      .slice()
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .slice(-14)
      .map(s => ({ day: s.day, upbeat: s.upbeat ?? 0, steady: s.steady ?? 0, strained: s.strained ?? 0, sampled: s.sampled ?? 0 })),
    nudges7d: {
      manual: nudges.filter(n => n.createdAt >= activeSince && n.source === 'manual').length,
      workflow: nudges.filter(n => n.createdAt >= activeSince && n.source === 'workflow').length,
    },
  };
}

export function buildInterventions(input: {
  circles: Row[]; members: Row[]; events: Row[]; usage: Row[]; now: number;
}) {
  const { circles, members, events, usage, now } = input;
  const last = lastEventByMember(events);
  const circleName = (id: string) => (circles.find(c => c.id === id) || {}).name || 'a circle';

  const stalled = members
    .map(m => ({ m, seen: memberLastSeen(m, last) }))
    .filter(x => now - x.seen >= STALLED_DAYS * DAY_MS)
    .map(x => ({
      memberId: x.m.id, circleId: x.m.circleId,
      name: x.m.name, avatarId: x.m.avatarId, quiet: !!x.m.quiet,
      circleName: circleName(x.m.circleId),
      daysQuiet: Math.floor((now - x.seen) / DAY_MS),
    }))
    .sort((a, b) => b.daysQuiet - a.daysQuiet);

  const struggles: Array<Record<string, any>> = [];
  for (const e of events) {
    if (e.type !== 'struggle') continue;
    const ageHours = (now - e.createdAt) / 3600000;
    if (ageHours < STRUGGLE_UNSUPPORTED_HOURS) continue;
    const supported = events.some(x => x.circleId === e.circleId && x.createdAt > e.createdAt
      && (x.type === 'recover'
        || (x.type === 'cheer' && x.payload && x.payload.toMemberId === e.memberId)));
    if (supported) continue;
    const m = members.find(x => x.id === e.memberId);
    struggles.push({
      memberId: e.memberId, circleId: e.circleId,
      name: m ? m.name : 'a member', avatarId: m ? m.avatarId : '0',
      circleName: circleName(e.circleId),
      hoursAgo: Math.floor(ageHours),
    });
  }

  const today = todayKey(now);
  const aiCapped = usage
    .filter(u => u.day === today && (u.count ?? 0) >= CIRCLE_AI_CAP)
    .map(u => ({ circleName: circleName(u.circleId), count: u.count }));

  return { stalled, struggles, aiCapped };
}
