'use strict';
// GroveData — all content: domains, goal templates, circle members, copy.
// No logic here. Browser global + CommonJS.
const GroveData = {};

GroveData.DOMAINS = [
  { id: 'career', name: 'Career', emoji: '💼', color: '#c47b4e' },
  { id: 'fitness', name: 'Health & Fitness', emoji: '🏃‍♀️', color: '#7ba05b' },
  { id: 'learning', name: 'Learning', emoji: '📚', color: '#8e7cc3' },
  { id: 'money', name: 'Money', emoji: '🌻', color: '#d9a441' },
  { id: 'wellbeing', name: 'Wellbeing', emoji: '🧘‍♀️', color: '#6aa3a0' },
  { id: 'creative', name: 'Creative', emoji: '🎨', color: '#c66b8e' },
];

// Tiny steps, written as implementation intentions: concrete, small, doable today.
GroveData.GOAL_TEMPLATES = [
  {
    domain: 'career', name: "Ask for what I'm worth", emoji: '💬',
    steps: [
      'Write down three wins from the last six months',
      'Find salary ranges for my role on two websites',
      "Write one sentence: what I want and why I've earned it",
      'Practice saying it out loud once, alone',
      'Practice it once with a friend or in the mirror',
      'Book the meeting with my manager',
      'Have the conversation — whatever happens, I showed up',
      'Write down what happened and one next move',
    ],
  },
  {
    domain: 'career', name: 'Land a new job', emoji: '🚪',
    steps: [
      'Update one section of my resume',
      "List 10 companies I'd actually like to work for",
      'Rewrite my LinkedIn headline',
      'Message one person in my network',
      'Tailor my resume for one real opening',
      'Submit one application',
      'Prepare answers to three interview questions',
      'Do one practice interview out loud',
      'Send one follow-up or thank-you note',
    ],
  },
  {
    domain: 'career', name: 'Grow my visibility at work', emoji: '🌟',
    steps: [
      'Speak up once in a meeting this week',
      'Share one small win in the team channel',
      'Have coffee or a call with someone outside my team',
      'Volunteer for one small visible task',
      'Write down what I want to be known for',
      'Present or demo something, however small',
    ],
  },
  {
    domain: 'fitness', name: 'Run a 5K', emoji: '👟',
    steps: [
      'Put on shoes and walk-run for 10 minutes',
      'Do a 15-minute walk-run at a gentle pace',
      'Run 3 intervals: 3 minutes on, 2 minutes off',
      'Run 1 km without stopping',
      'Run 2 km — slow is fine',
      'Run 3 km and celebrate with a long stretch',
      'Run 4 km once this week',
      'Run the full 5K — any pace counts',
    ],
  },
  {
    domain: 'fitness', name: 'Get strong', emoji: '💪',
    steps: [
      'Do 10 minutes of bodyweight moves at home',
      'Learn proper squat form from one good video',
      'Do 2 sets of 8 squats and 8 push-ups (knees fine)',
      'Add one plank — hold as long as I can',
      'Complete 3 short sessions in one week',
      'Increase reps or weight a little',
      'Complete week two: 3 more sessions',
      'Do one workout that felt impossible a month ago',
    ],
  },
  {
    domain: 'fitness', name: 'Sleep like it matters', emoji: '🌙',
    steps: [
      'Pick a bedtime and set a nightly alarm for it',
      'Put the phone out of reach 30 minutes before bed, once',
      'Do the phone-free wind-down three nights in one week',
      'Make the bedroom darker or cooler in one small way',
      'Swap late caffeine for something else, three days',
      'String together five nights of my target bedtime',
    ],
  },
  {
    domain: 'learning', name: 'Learn a new language', emoji: '🗣️',
    steps: [
      'Do one 10-minute lesson',
      'Learn 10 everyday words',
      'Do lessons three days in a row',
      'Listen to one song or podcast in the language',
      'Say one full sentence to another human (or a pet)',
      'Finish week one: five practice days',
      'Watch one short scene with subtitles',
      'Have a tiny real conversation — greet, order, or ask',
    ],
  },
  {
    domain: 'learning', name: 'Read 12 books this year', emoji: '📖',
    steps: [
      "Choose the next book and put it where I'll see it",
      'Read 10 pages',
      'Read 3 days in a row, any amount',
      'Finish the first third',
      'Finish the book',
      'Tell someone one idea I loved from it',
    ],
  },
  {
    domain: 'learning', name: 'Learn to code a little', emoji: '💻',
    steps: [
      'Finish one intro lesson from any free course',
      'Write a program that prints my name',
      'Code for 20 minutes, three days this week',
      'Build a tiny thing: a list, a quiz, a calculator',
      "Get stuck and get unstuck once — that's the skill",
      'Show someone what I built',
    ],
  },
  {
    domain: 'money', name: 'Build a starter emergency fund', emoji: '🛟',
    steps: [
      'Pick or open the account where it will live',
      'Move the first $25 (or any amount) today',
      'Set up an automatic weekly transfer, however small',
      "Cancel one subscription I don't love",
      'Add a windfall — refund, gift, side income — any size',
      'Reach a quarter of my target',
      'Reach half of my target',
      'Reach my starter target and take a breath',
    ],
  },
  {
    domain: 'money', name: 'Know where my money goes', emoji: '🔍',
    steps: [
      "Look at last month's statement for 15 minutes, no judgment",
      'Write down my three biggest spending categories',
      'Track spending for three days',
      'Track a full week',
      'Pick one category and set a gentle cap',
      'Do a 15-minute money check-in two weeks running',
    ],
  },
  {
    domain: 'money', name: 'Start investing', emoji: '🌱',
    steps: [
      'Read one beginner article about index funds',
      "Write down why I'm investing — the actual goal",
      'Check if my job matches contributions, and take all of it',
      "Open (or find) the account I'll use",
      'Make my first investment, any amount',
      'Set it to repeat automatically',
      'Ignore the balance for two whole weeks (yes, a real step)',
    ],
  },
  {
    domain: 'wellbeing', name: 'Make peace with my mornings', emoji: '🌅',
    steps: [
      "Write tomorrow's one important thing tonight",
      'Wake up 15 minutes earlier, once',
      'No phone for the first 20 minutes, once',
      'Drink water before coffee, three mornings',
      'Stack it: water, stretch, one deep breath — three mornings',
      'Keep my morning routine five days in one week',
    ],
  },
  {
    domain: 'wellbeing', name: 'A calmer mind', emoji: '🍵',
    steps: [
      'Sit quietly for 3 minutes, one time',
      'Try a 5-minute guided meditation',
      'Meditate three days in one week',
      'Notice one thought spiral and name it ("ah, worrying")',
      'Write one worry down instead of carrying it',
      'Do a 10-minute session',
      'Complete a gentle 7-day run (shields allowed)',
    ],
  },
  {
    domain: 'wellbeing', name: 'Protect my energy', emoji: '🛡️',
    steps: [
      'Say no to one thing this week',
      'Block one hour just for me on the calendar',
      'Actually take the hour — no errands allowed',
      'Mute or unfollow three accounts that drain me',
      'Ask for help with one task I always carry',
      'Take a full evening off and notice how it feels',
    ],
  },
  {
    domain: 'creative', name: 'Write the thing', emoji: '✍️',
    steps: [
      'Write one terrible paragraph (terrible is the assignment)',
      "Write for 15 minutes without rereading",
      'Write three days in one week',
      'Finish a rough outline or shape of it',
      'Reach 1,000 words or the halfway mark',
      'Finish the ugly first draft',
      'Read it once, kindly, with a pen',
      'Share one piece of it with one person',
    ],
  },
  {
    domain: 'creative', name: 'Paint or draw again', emoji: '🖌️',
    steps: [
      'Put supplies somewhere I can see them',
      'Do one 10-minute warm-up with no goal',
      'Copy something I love, just to loosen up',
      'Finish one small piece — postcard-sized counts',
      'Try one new technique or material',
      'Make something for someone and give it away',
    ],
  },
  {
    domain: 'creative', name: 'Start the tiny business', emoji: '🏪',
    steps: [
      'Describe it in two sentences to myself',
      'Tell one person about the idea',
      'Make one example of the thing — photo, sample, or page',
      'Pick a name — good enough beats perfect',
      'Set up the simplest way to take one order',
      'Get my first customer, even a friendly one',
      'Write down what worked and the one next step',
    ],
  },
];

GroveData.MEMBERS = [
  {
    id: 'maya', name: 'Maya', palette: { petal: '#e8927c', center: '#8a4b3b' },
    bio: 'Project manager, mother of a giant dog, believer in slow mornings and long runs.',
    pace: 0.85, struggleProne: 0.1,
    goals: [
      { name: 'Run a half marathon', domain: 'fitness' },
      { name: 'Ask for a promotion', domain: 'career' },
    ],
    feedVerbs: ['laced up for', 'took a steady step toward', 'kept her promise to', 'made quiet progress on'],
    cheers: [
      'Look at you go. Steady wins this.',
      'That step counted double in my book.',
      "You showed up. That's the whole game.",
      'Watering my own garden felt easier after seeing yours grow.',
      'Quietly cheering very loudly over here.',
      'One more brick in the path. Proud of you.',
    ],
    struggles: [
      'Long week. My runs keep losing to my calendar.',
      "I skipped three sessions and I'm being weird about it.",
      'Anyone else mid-project slump? Asking for me.',
    ],
    recoveries: [
      'Back on the trail this morning. {name}, your note got me out the door.',
      'Thanks {name} — I needed exactly that. Slow lap done.',
      "Went for the short run anyway. {name}, you were right, it's about showing up.",
    ],
  },
  {
    id: 'priya', name: 'Priya', palette: { petal: '#a58fd4', center: '#5b4a8a' },
    bio: 'Designer by day, animation student by night. Powered by chai and deadlines.',
    pace: 0.6, struggleProne: 0.35,
    goals: [
      { name: 'Finish my portfolio site', domain: 'creative' },
      { name: 'Learn Japanese basics', domain: 'learning' },
    ],
    feedVerbs: ['pulled a late-night step on', 'sketched her way through', 'chipped away at', 'leveled up'],
    cheers: [
      'Petals well earned, friend.',
      'You did the thing!! Screenshot it for future you.',
      'This is your sign that consistency looks great on you.',
      'Adding your win to my motivation moodboard.',
      'Tiny step, big deal. I see it.',
      'Okay but the way you keep showing up?? Inspiring.',
    ],
    struggles: [
      'Portfolio paralysis is real. Every layout looks wrong at 1am.',
      'Missed my study streak and my brain wants to quit everything.',
      'A deadline ate my week. Zero steps. Being honest about it.',
    ],
    recoveries: [
      'Shipped one page. ONE. And {name} cheering me on made it feel like ten.',
      'Back at my desk. Thanks {name}, I owe you a chai.',
      'Did ten minutes of practice. {name}, your sunshine worked.',
    ],
  },
  {
    id: 'sofia', name: 'Sofia', palette: { petal: '#f0b660', center: '#9a6b1f' },
    bio: 'ER nurse on rotating shifts. Learning that rest is productive too.',
    pace: 0.45, struggleProne: 0.6,
    goals: [
      { name: 'Build my emergency fund', domain: 'money' },
      { name: 'Meditate most days', domain: 'wellbeing' },
    ],
    feedVerbs: ['tucked away another step of', 'found five minutes for', 'came back to', 'held her ground on'],
    cheers: [
      'You kept going. That matters more than perfect.',
      'Saw your step and smiled on my break.',
      'Your garden is looking so alive lately.',
      'Proof that small things add up. Thank you for that.',
      'Cheering you on from the night shift.',
      'You make it look doable. That helps more than you know.',
    ],
    struggles: [
      'Night shifts broke my routine again. Starting over feels heavy.',
      "Dipped into my savings this week and I'm disappointed with me.",
      "Haven't meditated in days. My mind is a browser with 40 tabs.",
    ],
    recoveries: [
      'Moved $10 back into savings. {name}, your kindness carried me today.',
      'Three minutes of quiet, done. Thank you {name} — the restart counted.',
      'Back to it. {name}, I reread your cheer twice. It helped.',
    ],
  },
  {
    id: 'amara', name: 'Amara', palette: { petal: '#e77f9d', center: '#93365a' },
    bio: 'Ex-teacher, future developer. Loud believer in asking questions early.',
    pace: 0.75, struggleProne: 0.2,
    goals: [
      { name: 'Land a developer job', domain: 'career' },
      { name: 'Ship my first app', domain: 'learning' },
    ],
    feedVerbs: ['powered through a step of', 'debugged her way toward', 'stacked momentum on', 'crossed off a piece of'],
    cheers: [
      "THAT'S what I'm talking about!",
      'Momentum looks good on you. Keep stacking.',
      'You just made the rest of us braver.',
      'Noted: showing up works. Thanks for the demo.',
      'Big respect. Small steps are the real flex.',
      'Your streak is giving main character energy.',
    ],
    struggles: [
      'Rejection email #7. Letting myself be annoyed for exactly one evening.',
      'My app broke in a way I do not understand. Brain fried.',
      'Imposter syndrome is loud today.',
    ],
    recoveries: [
      'Applied to two more roles. {name}, your cheer landed right when I needed it.',
      'Bug fixed (it was a typo, obviously). Thanks for the boost, {name}.',
      'Back in the arena. {name}, thank you for the reminder that I belong here.',
    ],
  },
  {
    id: 'jen', name: 'Jen', palette: { petal: '#8fbf9f', center: '#3e6b4f' },
    bio: 'New mom. Wins are measured in chapters read and naps synchronized.',
    pace: 0.35, struggleProne: 0.3,
    goals: [
      { name: 'Walk 20 minutes a day', domain: 'fitness' },
      { name: 'Read 12 books this year', domain: 'learning' },
    ],
    feedVerbs: ['snuck in a step of', 'kept gently at', 'found a pocket of time for', 'inched forward on'],
    cheers: [
      'Saw this during the 3am feed. Made my night.',
      'You are growing something lovely here.',
      'Slow and steady is still moving. Proud of you.',
      'Your consistency is my favorite thing on this feed.',
      'Small steps club, founding member. Welcome.',
      'This cheered me up more than coffee. Almost.',
    ],
    struggles: [
      'Baby cold week. Every routine dissolved.',
      'Read zero pages. The book is now decorative.',
      'Too tired to walk today. Being kind to myself about it (trying).',
    ],
    recoveries: [
      'Stroller walk done, tiny co-pilot asleep. {name}, thanks for the nudge.',
      'Ten pages while the laundry waited. Priorities. Thanks {name}.',
      'Back on my feet, literally. {name}, your sunshine reached me.',
    ],
  },
];

GroveData.AFFIRMATIONS = [
  'Small steps, taken often, beat big plans.',
  "You don't need to feel ready. You need ten minutes.",
  'Progress hides in ordinary days like this one.',
  'Done gently still counts as done.',
  'Your pace is a valid pace.',
  'Watering days matter more than harvest days.',
  "You've restarted before. That's a skill, not a flaw.",
  'Ambition looks like this: one unglamorous step.',
  "The garden doesn't rush, and it doesn't stop.",
  'Effort compounds quietly. Keep going.',
  "Today's step is invisible to everyone but future you. She notices.",
  'You are allowed to take up room and time for this.',
  'Consistency is self-respect in slow motion.',
  'A short session still moves the roots.',
  "What you tend, grows. You're here, tending.",
  'Rest when you need to. Return because you want to.',
];

GroveData.COMEBACK_LINES = [
  'Welcome back. The garden kept your place.',
  'Good to see you. Everything here is still yours.',
  "You came back — that's the strongest move in the game.",
  'The grove missed you. No catch-up required, just one small step.',
  'Restarts are how gardens survive winters. Glad you are here.',
];

GroveData.BADGES = {
  'first-step': { name: 'First Step', icon: '🌱', desc: 'You began. The hardest part.' },
  'first-bloom': { name: 'First Bloom', icon: '🌸', desc: 'A goal, finished. Look at it.' },
  'three-blooms': { name: 'Bouquet', icon: '💐', desc: 'Three goals bloomed.' },
  'variety-bloom': { name: 'Wild Meadow', icon: '🌼', desc: 'Blooms in three different areas of life.' },
  'streak-7': { name: 'One Green Week', icon: '🍃', desc: 'Seven days of showing up.' },
  'streak-30': { name: 'Deep Roots', icon: '🌳', desc: 'Thirty days of showing up.' },
  'sunshine-10': { name: 'Warm Front', icon: '☀️', desc: 'Ten cheers sent to your circle.' },
  'sunshine-50': { name: 'Golden Hour', icon: '🌅', desc: 'Fifty cheers. You lift this whole grove.' },
  'comeback': { name: 'The Return', icon: '🌦️', desc: 'Came back after days away. Champions restart.' },
  'challenge-1': { name: 'Better Together', icon: '🤝', desc: 'Helped win a weekly challenge.' },
  'challenge-5': { name: 'Grove Force', icon: '🏵️', desc: 'Five weekly challenges won together.' },
  'five-goals': { name: 'Big Dreamer', icon: '✨', desc: 'Five goals planted.' },
  'level-5': { name: 'Grove Keeper', icon: '🗝️', desc: 'Reached level five.' },
};

GroveData.SHOP_ITEMS = [
  { id: 'butterfly', name: 'Monarch Butterfly', price: 30, kind: 'butterfly' },
  { id: 'lantern', name: 'Paper Lantern', price: 35, kind: 'lantern' },
  { id: 'birdbath', name: 'Stone Birdbath', price: 40, kind: 'birdbath' },
  { id: 'windchime', name: 'Bamboo Windchime', price: 45, kind: 'windchime' },
  { id: 'gnome', name: 'Garden Gnome (her name is Beatrix)', price: 55, kind: 'gnome' },
  { id: 'bench', name: 'Reading Bench', price: 60, kind: 'bench' },
  { id: 'fairylights', name: 'Fairy Lights', price: 70, kind: 'fairylights' },
  { id: 'fountain', name: 'Mosaic Fountain', price: 80, kind: 'fountain' },
  { id: 'arch', name: 'Rose Arch', price: 90, kind: 'arch' },
];

GroveData.PLAYER_AVATARS = [
  { id: 0, name: 'Poppy', petal: '#e8654f', center: '#7a2e1f' },
  { id: 1, name: 'Lotus', petal: '#f2a2c0', center: '#a04c72' },
  { id: 2, name: 'Dahlia', petal: '#c66b8e', center: '#6e2f4b' },
  { id: 3, name: 'Sunflower', petal: '#f0c04a', center: '#8a611a' },
  { id: 4, name: 'Iris', petal: '#8e7cc3', center: '#4a3d78' },
  { id: 5, name: 'Protea', petal: '#e09a86', center: '#8a4b3b' },
];

GroveData.ACCENTS = [
  { id: 0, name: 'Rose', color: '#c66b8e' },
  { id: 1, name: 'Terracotta', color: '#c47b4e' },
  { id: 2, name: 'Wisteria', color: '#8e7cc3' },
  { id: 3, name: 'Eucalyptus', color: '#6aa3a0' },
  { id: 4, name: 'Marigold', color: '#d9a441' },
];

if (typeof module !== 'undefined' && module.exports) module.exports = GroveData;
if (typeof window !== 'undefined') window.GroveData = GroveData;
