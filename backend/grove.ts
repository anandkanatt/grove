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
