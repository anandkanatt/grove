'use strict';
// GroveUI — rendering + interaction. Depends on GroveData/Logic/Sim/State/Garden globals.
const GroveUI = {};

(function () {
  const D = window.GroveData, L = window.GroveLogic, Sim = window.GroveSim,
    S = window.GroveState, G = window.GroveGarden;

  let ctx = null;          // { state, save(), replaceState(newState) }
  let currentView = 'today';
  let ob = null;           // onboarding / new-goal wizard scratch
  let goalSeq = 0;
  let pendingJoin = null;  // invite code parked until onboarding finishes
  let pendingConsentAction = null;   // AI action awaiting the consent modal
  let dictation = null;              // active speech-recognition session
  let dailyWhisperTried = false;     // one fetch attempt per session

  const Social = () => window.GroveSocial;
  const Whisper = () => window.GroveWhisper;
  // Any real-circle backend: the App Deploy bridge, or self-hosted Supabase config.
  const netConfigured = () => !!window.GrovePlatform || !!(window.GroveConfig
    && window.GroveConfig.SUPABASE_URL && window.GroveConfig.SUPABASE_ANON_KEY);
  const realCircle = () => (ctx.state.net && ctx.state.net.circle) || null;
  const flows = () => (window.Grove && window.Grove.net) || null;
  const syncer = () => (window.Grove && window.Grove.sync) || null;
  // Implementation-intention anchors: "when will you do it?" — optional, warm.
  const ANCHORS = {
    morning: { emoji: '☀️', label: 'morning' },
    midday: { emoji: '🌤️', label: 'midday' },
    evening: { emoji: '🌙', label: 'evening' },
  };

  const whispererOn = () => !(window.Grove && window.Grove.flags && window.Grove.flags.whisperer === false);
  const ai = () => (flows() && realCircle() && whispererOn() ? flows().ai : null);

  // ---------- circle chat state (ephemeral — refetched per visit) ----------
  let chatLog = [];
  let chatSince = 0;
  let chatTimer = null;
  let chatToMentor = false;
  let mentorInfo = null;
  const chatReady = () => !!(window.GrovePlatform && flows() && realCircle());

  function avatarPaletteFor(avatarId) {
    const a = D.PLAYER_AVATARS[Number(avatarId) % D.PLAYER_AVATARS.length] || D.PLAYER_AVATARS[0];
    return { petal: a.petal, center: a.center };
  }

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const domainById = (id) => D.DOMAINS.find(d => d.id === id) || D.DOMAINS[0];
  const memberDef = (id) => D.MEMBERS.find(m => m.id === id);
  const playerPalette = () => {
    const a = D.PLAYER_AVATARS[ctx.state.player.avatarId] || D.PLAYER_AVATARS[0];
    return { petal: a.petal, center: a.center };
  };

  function uid(prefix) {
    goalSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${goalSeq}`;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 90 * 1000) return 'just now';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
  }

  // ---------- toasts ----------
  const toastQueue = [];
  let toastTimer = null;
  function toast(msg, cls) {
    toastQueue.push({ msg, cls });
    if (!toastTimer) drainToast();
  }
  function drainToast() {
    const next = toastQueue.shift();
    if (!next) { toastTimer = null; return; }
    const node = document.createElement('div');
    node.className = 'toast' + (next.cls ? ' ' + next.cls : '');
    node.innerHTML = next.msg;
    $('#toasts').appendChild(node);
    setTimeout(() => node.classList.add('leaving'), 2900);
    setTimeout(() => node.remove(), 3400);
    toastTimer = setTimeout(drainToast, 700);
  }

  // ---------- modal ----------
  function showModal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal">${html}</div>`;
    root.classList.remove('hidden');
  }
  function closeModal() {
    $('#modal-root').classList.add('hidden');
    $('#modal-root').innerHTML = '';
  }

  // ---------- HUD ----------
  function renderHud() {
    const st = ctx.state;
    const lv = L.levelForXp(st.xp);
    const C = 2 * Math.PI * 10;
    const dash = (lv.progress * C).toFixed(1);
    const shields = st.streak.shields > 0 ? ` <span title="Dew Shields protect your streak">💧×${st.streak.shields}</span>` : '';
    $('#hud').innerHTML = `
      <span class="chip" title="${lv.nextAt === null ? 'Highest level' : `${st.xp} xp — next level at ${lv.nextAt}`}">
        <svg class="levelring" viewBox="0 0 26 26">
          <circle cx="13" cy="13" r="10" fill="none" stroke="var(--soft)" stroke-width="3.5"/>
          <circle cx="13" cy="13" r="10" fill="none" stroke="var(--accent)" stroke-width="3.5"
            stroke-linecap="round" stroke-dasharray="${dash} ${C.toFixed(1)}"
            transform="rotate(-90 13 13)"/>
          <text x="13" y="16.5" text-anchor="middle" font-size="9" fill="var(--ink)" font-weight="700">${lv.level}</text>
        </svg>
        <strong>${esc(lv.title)}</strong>
      </span>
      <span class="chip" title="Petals — spend them in the Shop">🌸 <strong>${st.petals}</strong></span>
      <span class="chip" title="Days in a row with at least one step">🔥 <strong>${st.streak.count}</strong>${shields}</span>`;
  }

  // ---------- view switching ----------
  function switchView(name) {
    currentView = name;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${name}`).classList.remove('hidden');
    renderView(name);
    if (name === 'circle') startChatLoop();
    else stopChatLoop();
  }

  function renderView(name) {
    if (name === 'today') renderToday();
    else if (name === 'garden') renderGarden();
    else if (name === 'circle') renderCircle();
    else if (name === 'challenge') renderChallenge();
    else if (name === 'shop') renderShop();
    else if (name === 'more') renderMore();
  }

  function renderAll() {
    renderHud();
    renderView(currentView);
  }

  // ---------- Today ----------
  function affirmationOfTheDay() {
    const st = ctx.state;
    const key = L.dayKey(Date.now());
    if (st.dailyWhisper && st.dailyWhisper.day === key && st.dailyWhisper.text) {
      return st.dailyWhisper.text;   // today's personalized whisper
    }
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return D.AFFIRMATIONS[h % D.AFFIRMATIONS.length];
  }

  function todaysRows() {
    const active = L.activeGoals(ctx.state);
    const rows = [];
    for (const g of active) {
      const next = g.steps.find(s => !s.done);
      if (next) rows.push({ goal: g, step: next });
    }
    if (rows.length < 3) {
      for (const g of active) {
        const undone = g.steps.filter(s => !s.done);
        if (undone[1]) rows.push({ goal: g, step: undone[1] });
        if (rows.length >= 5) break;
      }
    }
    return rows.slice(0, 5);
  }

  function renderToday() {
    const st = ctx.state;
    const view = $('#view-today');
    const doneToday = st.goals.reduce((n, g) =>
      n + g.steps.filter(s => s.done && s.doneAt && L.dayKey(s.doneAt) === L.dayKey(Date.now())).length, 0);
    const rows = todaysRows();
    const name = st.player.name ? `, ${esc(st.player.name)}` : '';

    let stepsHtml;
    if (!st.goals.length) {
      stepsHtml = `<div class="empty-note">Your garden is waiting for its first seed.<br><br>
        <button class="btn accent" data-action="new-goal">🌱 Plant your first goal</button></div>`;
    } else if (!rows.length) {
      stepsHtml = `<div class="empty-note">Every step is done — your plants are humming.<br><br>
        <button class="btn accent" data-action="new-goal">🌱 Plant another goal</button></div>`;
    } else {
      stepsHtml = rows.map(({ goal, step }) => {
        const dom = domainById(goal.domain);
        return `
        <div class="step-row">
          <button class="step-check" data-action="check-step" data-goal="${goal.id}" data-step="${step.id}"
            aria-label="Mark done: ${esc(step.text)}">✓</button>
          <div style="flex:1">
            <div class="step-text">${esc(step.text)}</div>
            <div class="step-meta"><span class="goal-tag" style="background:${dom.color}">${esc(goal.name)}</span>${ANCHORS[goal.anchor]
              ? `<span>${ANCHORS[goal.anchor].emoji} ${ANCHORS[goal.anchor].label}</span>` : ''}</div>
          </div>
        </div>`;
      }).join('');
    }

    // A gentle, dismissible ask at moments of real investment — platform only.
    const claimTrigger = window.GrovePlatform ? L.claimTrigger(st) : null;
    const claimCard = claimTrigger ? `
      <div class="card claim-card">
        <div class="section-title"><h2>Your grove is growing 🌿</h2></div>
        <p class="sub" style="margin:6px 0 12px">Claim it, so it can follow you to any device —
          and stay safe if this browser ever forgets.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn accent" data-action="account-claim" data-trigger="${esc(claimTrigger)}">Claim my grove ✨</button>
          <button class="btn secondary" data-action="account-later" data-trigger="${esc(claimTrigger)}">not now</button>
        </div>
      </div>` : '';

    // The week at a glance: soft dots, shields implied, never a red mark.
    const week = L.weekActivity(st, Date.now());
    const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const weekStrip = st.goals.length ? `
      <div class="week-strip" title="Days you tended the garden this week">
        ${week.map((d, i) => `
          <span class="week-dot ${d.active ? 'active' : ''} ${d.isToday ? 'today' : ''} ${d.future ? 'future' : ''}">
            ${d.active ? '🌸' : dayLetters[i]}</span>`).join('')}
      </div>` : '';

    const notes = (st.keeperNotes || []);
    const notesCard = notes.length ? `
      <div class="card keeper-notes-card">
        <div class="section-title"><h2>Notes left for you 🌿</h2></div>
        ${notes.map(n => `<p class="sub keeper-note">“${esc(n.text)}”</p>`).join('')}
        <button class="btn small secondary" data-action="keeper-notes-clear" style="margin-top:8px">Thanks, keeper 💛</button>
      </div>` : '';

    maybeFetchDailyWhisper();
    view.innerHTML = `
      <div class="affirmation">“${esc(affirmationOfTheDay())}”${Whisper().speakAvailable()
        ? ` <button class="voice-btn" data-action="voice-speak" title="Hear it" aria-label="Read the affirmation aloud">🔈</button>` : ''}</div>
      ${weekStrip}
      ${notesCard}
      ${claimCard}
      <div class="card">
        <div class="section-title">
          <h2>Hello${name} 🌤️</h2>
          <span class="sub">${doneToday ? `${doneToday} step${doneToday > 1 ? 's' : ''} today 🌱` : 'small steps, big garden'}</span>
        </div>
        ${stepsHtml}
      </div>
      ${st.goals.length ? `<div style="text-align:center">
        <button class="btn secondary" data-action="new-goal">🌱 Plant a new goal</button>
      </div>` : ''}`;
  }

  // ---------- Garden ----------
  function stageName(stage) {
    return ['seed', 'sprout', 'bud', 'bloom', 'radiant bloom'][stage];
  }

  function renderGarden() {
    const st = ctx.state;
    const view = $('#view-garden');
    const active = L.activeGoals(st);
    const bloomed = st.goals.filter(g => g.bloomedAt);

    const plants = active.map(g => {
      const dom = domainById(g.domain);
      const stage = L.goalStage(g);
      const done = g.steps.filter(s => s.done).length;
      const pct = Math.round((done / g.steps.length) * 100);
      const moon = realCircle() ? `
        <button class="moon-toggle ${g.private ? 'on' : ''}" data-action="toggle-private" data-goal="${g.id}"
          title="${g.private ? 'Private — your circle sees progress only' : 'Shared with your circle'}"
          aria-label="Toggle goal privacy">${g.private ? '🌙' : '🌤️'}</button>` : '';
      return `
      <div class="plant-card" id="plant-${g.id}">
        ${moon}
        ${G.plantSvg(stage, dom.color)}
        <div class="pname">${esc(g.emoji)} ${esc(g.name)}</div>
        <div class="pstage">${stageName(stage)} · ${done}/${g.steps.length} steps</div>
        <div class="pbar"><i style="width:${pct}%;background:${dom.color}"></i></div>
      </div>`;
    }).join('');

    const decor = st.decor.map(d => {
      const item = D.SHOP_ITEMS.find(i => i.id === d.itemId);
      return item ? `<span title="${esc(item.name)}">${G.decorSvg(item.kind)}</span>` : '';
    }).join('');

    const meadow = bloomed.map(g => {
      const dom = domainById(g.domain);
      return `<div class="meadow-item">${G.plantSvg(4, dom.color)}${esc(g.name)}</div>`;
    }).join('');

    view.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>My Garden 🌿</h2>
          <span class="sub">${active.length} growing · ${bloomed.length} bloomed</span></div>
        ${active.length
          ? `<div class="garden-grid" style="margin-top:12px">${plants}</div>`
          : `<div class="empty-note">Nothing growing yet — plant a goal from Today.</div>`}
        ${decor ? `<div class="decor-strip" style="margin-top:14px">${decor}</div>` : ''}
      </div>
      ${bloomed.length ? `
      <div class="card">
        <div class="section-title"><h2>The Meadow 🌸</h2><span class="sub">every finished goal lives here forever</span></div>
        <div class="meadow-strip" style="margin-top:10px">${meadow}</div>
      </div>` : ''}`;
  }

  // ---------- Circle ----------
  function feedIcon(type) {
    return { step: '🌱', bloom: '🌸', struggle: '🌧️', recovery: '🌈', cheer_player: '☀️', digest: '🍃', welcome: '👋', leave: '🍂' }[type] || '🌿';
  }

  function syncStatusChip() {
    const s = syncer() ? syncer().status() : 'idle';
    const label = { synced: 'synced ✓', syncing: 'syncing…', offline: 'offline — will retry', idle: 'ready' }[s] || s;
    return `<span class="sync-chip ${s === 'offline' ? 'offline' : ''}">${label}</span>`;
  }

  function realCircleHeader() {
    const st = ctx.state;
    const rc = realCircle();
    if (rc) {
      return `
      <div class="card">
        <div class="section-title"><h2>${esc(rc.name)} 💛</h2>${syncStatusChip()}</div>
        <div class="invite-row">
          <span class="invite-chip">Invite code: <b>${esc(rc.inviteCode)}</b></span>
          <button class="btn small secondary" data-action="rc-copy-code">Copy invite link</button>
          <button class="btn small accent" data-action="rc-boost-open">Ask for a boost 💛</button>
        </div>
        <p class="sub" style="margin-top:8px">${esc(D.REAL_CIRCLE.spiritHint)}</p>
      </div>`;
    }
    if (netConfigured()) {
      return `
      <div class="card">
        <div class="section-title"><h2>${esc(D.REAL_CIRCLE.makeRealTitle)}</h2></div>
        <p class="sub" style="margin:6px 0 10px">${esc(D.REAL_CIRCLE.makeRealBody)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn accent" data-action="rc-create-open">Start a circle</button>
          <button class="btn secondary" data-action="rc-join-open">Join with a code</button>
        </div>
      </div>`;
    }
    return `
      <div class="card">
        <div class="section-title"><h2>${esc(D.REAL_CIRCLE.makeRealTitle)}</h2></div>
        <p class="sub" style="margin-top:6px">${esc(D.REAL_CIRCLE.setupBody)}</p>
      </div>`;
  }

  function memberCardHtml(entry) {
    if (entry.kind === 'real') {
      const m = entry.member;
      return `
      <div class="member-card">
        <span class="ribbon-real">real</span>
        ${G.avatarSvg(avatarPaletteFor(m.avatarId))}
        <div class="mname">${esc(m.name)}</div>
        <div class="mbio">Growing right beside you — cheer her on.</div>
        <button class="btn small accent" data-action="cheer-real" data-member="${esc(m.id)}">Send sunshine ☀️</button>
      </div>`;
    }
    const def = entry.member;
    const tags = def.goals.map(g => {
      const dom = domainById(g.domain);
      return `<span class="goal-tag" style="background:${dom.color}">${esc(g.name)}</span>`;
    }).join(' ');
    return `
      <div class="member-card">
        ${G.avatarSvg(def.palette)}
        <div class="mname">${esc(def.name)}</div>
        ${realCircle() ? `<div class="spirit-tag">${esc(D.REAL_CIRCLE.spiritTag)}</div>` : ''}
        <div class="mbio">${esc(def.bio)}</div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:center;margin:6px 0">${tags}</div>
        <button class="btn small accent" data-action="cheer" data-member="${def.id}">Send sunshine ☀️</button>
      </div>`;
  }

  function feedItemHtml(e) {
    const st = ctx.state;
    if (e.real) {
      const own = realCircle() && e.memberId === st.net.circle.memberId;
      const canCheer = !own && !e.cheered
        && e.type !== 'cheer_player' && e.type !== 'welcome' && e.type !== 'leave';
      let btn = canCheer
        ? `<button class="btn small ${e.type === 'struggle' ? 'accent' : 'secondary'}" data-action="cheer-real" data-member="${esc(e.memberId)}" data-event="${esc(e.id)}">
            ${e.type === 'struggle' ? 'Send encouragement 💛' : 'Send sunshine ☀️'}</button>`
        : (e.cheered ? `<button class="btn small cheered" disabled>Sunshine sent ✓</button>` : '');
      if (canCheer && ai()) {
        btn += e.type === 'struggle'
          ? ` <button class="btn small secondary whisper-btn" data-action="whisper-replies" data-member="${esc(e.memberId)}" data-event="${esc(e.id)}">✨ suggest a reply</button>`
          : ` <button class="btn small secondary whisper-btn" data-action="whisper-personal" data-member="${esc(e.memberId)}" data-event="${esc(e.id)}" data-name="${esc(e.name)}" title="Make it personal">✨</button>`;
      }
      return `
      <div class="feed-item ${e.type}">
        <div class="fava">${G.avatarSvg(avatarPaletteFor(e.avatarId))}</div>
        <div style="flex:1">
          <div class="ftext">${feedIcon(e.type)} ${esc(e.text)}</div>
          <div class="ftime">${own ? 'you' : esc(e.name)} · ${timeAgo(e.ts)}</div>
          ${btn ? `<div style="margin-top:6px">${btn}</div>` : ''}
        </div>
      </div>`;
    }
    const def = memberDef(e.memberId);
    if (!def) return '';
    const canCheer = !e.cheered && e.type !== 'cheer_player';
    const btn = canCheer
      ? `<button class="btn small ${e.type === 'struggle' ? 'accent' : 'secondary'}" data-action="cheer" data-member="${e.memberId}" data-event="${e.id}">
          ${e.type === 'struggle' ? 'Send encouragement 💛' : 'Send sunshine ☀️'}</button>`
      : (e.cheered ? `<button class="btn small cheered" disabled>Sunshine sent ✓</button>` : '');
    return `
      <div class="feed-item ${e.type}">
        <div class="fava">${G.avatarSvg(def.palette)}</div>
        <div style="flex:1">
          <div class="ftext">${feedIcon(e.type)} ${esc(e.text)}</div>
          <div class="ftime">${esc(def.name)} · ${timeAgo(e.ts)}</div>
          ${btn ? `<div style="margin-top:6px">${btn}</div>` : ''}
        </div>
      </div>`;
  }

  function chatName(memberId) {
    const st = ctx.state;
    if (memberId === '@mentor') return (mentorInfo && mentorInfo.name) || 'Mentor';
    if (st.net.circle && memberId === st.net.circle.memberId) return 'you';
    const m = (st.net.members || []).find(x => x.id === memberId);
    return m ? m.name : 'a friend';
  }

  function chatCardHtml() {
    if (!chatReady()) return '';
    const rows = chatLog.slice(-30).map(m => {
      const who = chatName(m.memberId);
      const mine = who === 'you';
      const isMentor = m.memberId === '@mentor';
      const body = m.kind === 'voice'
        ? `<button class="btn small secondary" data-action="chat-play" data-path="${esc(m.audioPath)}">▶ voice note</button>`
        : `${esc(m.text)}${Whisper().speakAvailable() && !mine
            ? ` <button class="voice-btn" data-action="chat-speak" data-text="${esc(m.text)}" aria-label="Read aloud">🔈</button>` : ''}`;
      return `<div class="chat-row ${mine ? 'mine' : ''} ${isMentor ? 'mentor' : ''}">
        <span class="chat-who">${esc(who)}${isMentor ? ' <span class="spirit-tag">mentor · AI</span>' : ''}</span>
        <span class="chat-body">${body}</span>
      </div>`;
    }).join('');
    const mentorToggle = mentorInfo
      ? `<button class="btn small ${chatToMentor ? 'accent' : 'secondary'}" data-action="chat-mentor-toggle"
          title="Send this to the mentor">🧭 ${chatToMentor ? 'asking ' + esc(mentorInfo.name) : 'ask the mentor'}</button>` : '';
    return `
      <div class="card" id="chat-card">
        <div class="section-title"><h2>Circle chat 💬</h2>
          <span class="sub">just your circle — no one else</span></div>
        <div class="chat-scroll" id="chat-scroll">${rows || '<div class="empty-note">Say hello — your circle will see it here.</div>'}</div>
        <div class="chat-input-row">
          <input class="text-input" id="chat-input" maxlength="500" placeholder="${chatToMentor ? 'Ask your mentor…' : 'Write to your circle…'}">
          ${Whisper().recorderAvailable() ? `<button class="btn small secondary mic-btn" data-action="chat-voice" title="Send a voice note">🎙️</button>` : ''}
          <button class="btn small accent" data-action="chat-send">Send</button>
        </div>
        ${mentorToggle ? `<div style="margin-top:8px">${mentorToggle}</div>` : ''}
      </div>`;
  }

  function mentorCardHtml() {
    if (!chatReady()) return '';
    if (mentorInfo) {
      return `
      <div class="member-card">
        <span class="ribbon-real" style="background:var(--gold)">mentor · AI</span>
        ${G.avatarSvg(avatarPaletteFor(mentorInfo.avatarId))}
        <div class="mname">${esc(mentorInfo.name)}</div>
        <div class="mbio">${mentorInfo.tone === 'direct' ? 'Direct and practical.' : 'Gentle and kind.'} Here to help with plans.</div>
        <button class="btn small secondary" data-action="mentor-remove">Say goodbye</button>
      </div>`;
    }
    return `
      <div class="member-card" style="border-style:dashed">
        <div style="font-size:1.6rem;padding:8px 0">🧭</div>
        <div class="mname">Invite a mentor</div>
        <div class="mbio">An AI coach for your whole circle. Always labeled. Easy to remove.</div>
        <button class="btn small accent" data-action="mentor-invite">Invite</button>
      </div>`;
  }

  function renderCircle() {
    const st = ctx.state;
    const view = $('#view-circle');
    const roster = Social().roster(st, D);
    const members = roster.map(memberCardHtml).join('') + mentorCardHtml();
    const feed = st.circle.feed.slice().sort((a, b) => b.ts - a.ts).slice(0, 25)
      .map(feedItemHtml).join('');

    view.innerHTML = `
      ${realCircleHeader()}
      <div class="sunshine-banner">☀️ <div><strong>${st.sunshineSent}</strong> sunshine sent —
        cheering others counts as much as your own steps here.</div></div>
      <div class="card">
        <div class="section-title"><h2>Your Circle 💛</h2>
          <span class="sub">${realCircle() ? 'real friends and garden spirits' : 'five women, real goals, no judgment'}</span></div>
        <div class="member-scroll" style="margin-top:10px">${members}</div>
      </div>
      ${chatCardHtml()}
      <div class="card">
        <div class="section-title"><h2>Grove Feed</h2></div>
        ${feed || '<div class="empty-note">The grove is quiet… check back after your next step.</div>'}
      </div>`;
  }

  // ---------- chat plumbing ----------
  function refreshChatCard() {
    const card = $('#chat-card');
    if (!card) return;
    const html = chatCardHtml();
    if (!html) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    card.replaceWith(wrap.firstElementChild);
    const scroll = $('#chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  async function pollChat() {
    if (!chatReady()) return;
    const rc = realCircle();
    const r = await flows().pullMessages(rc.id, chatSince);
    if (!r.ok) return;
    mentorInfo = r.mentor || null;
    const seen = new Set(chatLog.map(m => m.id));
    let grew = false;
    for (const m of r.messages) {
      if (seen.has(m.id)) continue;
      chatLog.push(m);
      grew = true;
      if (m.createdAt > chatSince) chatSince = m.createdAt;
    }
    if (chatLog.length > 60) chatLog = chatLog.slice(-60);
    if (grew || !$('#chat-card')) refreshChatCard();
  }

  function startChatLoop() {
    stopChatLoop();
    if (!chatReady()) return;
    chatLog = []; chatSince = 0;
    pollChat();
    chatTimer = setInterval(() => {
      if (currentView === 'circle') pollChat();
      else stopChatLoop();
    }, 8000);
  }
  function stopChatLoop() {
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  }

  async function handleChatSend() {
    const input = $('#chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const rc = realCircle();
    if (chatToMentor && mentorInfo) {
      toast('🧭 Asking your mentor…');
      const goals = L.activeGoals(ctx.state).filter(g => !g.private).map(g => g.name);
      const r = await flows().mentorChat(rc.id, rc.memberId, text, goals);
      if (!r.ok) {
        toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest
          : r.error === 'ai-off' ? 'The whisperer is off right now 🌙' : D.REAL_CIRCLE.aiQuiet));
      }
      await pollChat();
      return;
    }
    const r = await flows().sendMessage(rc.id, rc.memberId, { kind: 'text', text });
    if (!r.ok) toast('Message did not reach the grove — try again 🌿');
    await pollChat();
  }

  function handleChatVoice(btn) {
    if (dictation) { dictation.stop(); return; }
    const rc = realCircle();
    const session = Whisper().makeRecorder({
      onStart() {
        btn.classList.add('listening');
        toast('Recording your note — tap 🎙️ again to send');
      },
      onBlob(base64, mimeType) {
        toast('Sending your voice note…');
        flows().sendMessage(rc.id, rc.memberId, { kind: 'voice', audio: base64, mimeType })
          .then((r) => {
            if (!r.ok) toast('Voice note did not send — try again 🌿');
            return pollChat();
          });
      },
      onError(kind) {
        const note = (kind in DICTATE_NOTES) ? DICTATE_NOTES[kind] : DICTATE_FALLBACK_NOTE;
        if (note) toast(note);
      },
      onEnd() { dictation = null; btn.classList.remove('listening'); },
    }, { maxMs: 60000 });
    if (!session) { toast(DICTATE_FALLBACK_NOTE); return; }
    dictation = session;
    session.start();
  }

  async function handleChatPlay(path) {
    const rc = realCircle();
    const r = await flows().voiceUrl(rc.id, path);
    if (!r.ok) { toast('Could not fetch that voice note 🌿'); return; }
    try { new Audio(r.url).play(); } catch (e) { toast('Playback hiccuped — try again.'); }
  }

  function openMentorModal() {
    showModal(`
      <h2>Invite a mentor 🧭</h2>
      <p class="sub">An AI coach joins your circle chat. It is always labeled as AI,
        it never pretends to be a person, and any member can say goodbye to it.</p>
      <label class="sub" style="font-weight:600">Mentor name</label>
      <input class="text-input" id="mentor-name" maxlength="30" value="Sage" style="margin:6px 0 12px">
      <div class="sub" style="font-weight:600">Style</div>
      <div style="display:flex;gap:10px;margin:8px 0 16px">
        <label class="privacy-row"><input type="radio" name="mentor-tone" value="gentle" checked> gentle</label>
        <label class="privacy-row"><input type="radio" name="mentor-tone" value="direct"> direct</label>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" data-action="close-modal">Not now</button>
        <button class="btn accent" data-action="mentor-save">Invite 🌿</button>
      </div>`);
  }

  async function handleMentorSave() {
    const rc = realCircle();
    const name = ($('#mentor-name') && $('#mentor-name').value.trim()) || 'Sage';
    const toneEl = document.querySelector('input[name="mentor-tone"]:checked');
    const tone = toneEl ? toneEl.value : 'gentle';
    closeModal();
    const r = await flows().setMentor(rc.id, rc.memberId, { name, tone, avatarId: '2' });
    if (r.ok) {
      mentorInfo = r.mentor;
      toast(`🧭 ${esc(name)} joined your circle`, 'rose');
      renderView('circle');
      startChatLoop();
    } else {
      toast('Could not invite the mentor — try again 🌿');
    }
  }

  async function handleMentorRemove() {
    if (!window.confirm('Say goodbye to your mentor? You can invite one again any time.')) return;
    const rc = realCircle();
    const r = await flows().setMentor(rc.id, rc.memberId, { remove: true });
    if (r.ok) {
      mentorInfo = null;
      chatToMentor = false;
      toast('🧭 Your mentor waved goodbye 🌿');
      renderView('circle');
    }
  }

  async function handleAssess() {
    collectWizardInputs();
    if (!ob || !ob.goalName || !ai()) return;
    const steps = ob.steps.map(s => s.trim()).filter(Boolean);
    if (!steps.length) { toast('Write a step or two first 🌱'); return; }
    const out = $('#assess-out');
    if (out) out.innerHTML = '<div class="whisper-card">🧭 checking your plan…</div>';
    const r = await ai().assess({ goalName: ob.goalName, steps });
    if (!ob) return;
    if (r.ok) {
      const chips = r.suggestions.map((s, i) =>
        `<button class="reply-chip" data-action="assess-add" data-text="${esc(s)}">+ ${esc(s)}</button>`).join('');
      if (out) out.innerHTML = `<div class="whisper-card">🧭 ${esc(r.verdict)}<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${chips}</div></div>`;
    } else if (out) {
      out.innerHTML = '';
      toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
    }
  }

  // ---------- Challenge ----------
  function renderChallenge() {
    const st = ctx.state;
    const ch = st.circle.challenge;
    const view = $('#view-challenge');
    const frac = ch.target ? Math.min(1, ch.progress / ch.target) : 0;
    const circleSteps = Math.max(0, ch.progress - ch.playerSteps);

    view.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Weekly Bloom Challenge 🌼</h2>
          <span class="sub">resets every Monday</span></div>
        <p class="sub" style="margin:6px 0 12px">Together, take <strong>${ch.target}</strong> steps this week.
          Everyone's steps water the community garden — when it blooms, everyone earns
          <strong>+${L.XP.CHALLENGE} xp</strong> and <strong>+${L.PETALS.CHALLENGE} petals</strong>.</p>
        <div class="challenge-svg">${G.communityGardenSvg(frac)}</div>
        <div class="progress-track" style="margin-top:10px"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
        <div style="text-align:center;margin-top:6px" class="sub">
          <strong>${ch.progress}</strong> / ${ch.target} steps
          ${ch.rewarded ? ' — bloomed! 🎉 Rewards delivered.' : ''}
        </div>
        <div class="challenge-stats">
          <div class="stat-block"><b>${ch.playerSteps}</b><span>your steps this week</span></div>
          <div class="stat-block"><b>${circleSteps}</b><span>circle steps this week</span></div>
          <div class="stat-block"><b>${st.challengesWon}</b><span>challenges won together</span></div>
        </div>
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">How it works</h2>
        <p class="sub" style="margin-top:6px">No leaderboards, no losers. The grove grows when anyone grows —
          your steps count, Maya's count, Jen's count. Show up, cheer loudly, bloom together.</p>
      </div>`;
  }

  // ---------- Shop ----------
  function renderShop() {
    const st = ctx.state;
    const view = $('#view-shop');
    const items = D.SHOP_ITEMS.map(it => {
      const owned = st.shopOwned.includes(it.id);
      const afford = st.petals >= it.price;
      return `
      <div class="shop-item">
        ${G.decorSvg(it.kind)}
        <div class="sname">${esc(it.name)}</div>
        ${owned
          ? `<button class="btn small cheered" disabled>In your garden ✓</button>`
          : `<button class="btn small ${afford ? 'accent' : ''}" data-action="buy" data-item="${it.id}" ${afford ? '' : 'disabled'}>
              🌸 ${it.price}</button>`}
      </div>`;
    }).join('');

    view.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Petal Shop 🌸</h2>
          <span class="sub">you have <strong>${st.petals}</strong> petals</span></div>
        <p class="sub" style="margin:4px 0 12px">Decorate your garden. Nothing here is required — it's all celebration.</p>
        <div class="shop-grid">${items}</div>
      </div>`;
  }

  // ---------- More (badges, journal, settings) ----------
  function renderMore() {
    const st = ctx.state;
    const view = $('#view-more');

    const badges = Object.keys(D.BADGES).map(id => {
      const b = D.BADGES[id];
      const earned = !!st.badges[id];
      return `
      <div class="badge-card ${earned ? '' : 'locked'}" title="${esc(b.desc)}">
        <div class="bicon">${b.icon}</div>
        <div class="bname">${esc(b.name)}</div>
        <div class="bdesc">${esc(b.desc)}</div>
      </div>`;
    }).join('');

    const journal = st.journal.slice().reverse().map(j => {
      const goal = st.goals.find(g => g.id === j.goalId);
      return `
      <div class="journal-entry">
        <div class="jday">${esc(j.day)}${goal ? ` · ${esc(goal.name)} 🌸` : ''}</div>
        <div class="jtext">“${esc(j.text)}”</div>
      </div>`;
    }).join('');

    view.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>How to play 🌱</h2></div>
        <p class="sub" style="margin-top:6px">
          1. Plant a goal — pick one or write your own.<br>
          2. Do one small step in real life.<br>
          3. Tap the circle next to the step. Your plant grows!<br>
          4. Cheer your friends. Growing together feels better.</p>
      </div>
      <div class="card">
        <div class="section-title"><h2>Badges 🏵️</h2>
          <span class="sub">${Object.keys(st.badges).length}/${Object.keys(D.BADGES).length} earned</span></div>
        <div class="badge-grid" style="margin-top:10px">${badges}</div>
      </div>
      <div class="card">
        <div class="section-title"><h2>Growth Rings 📖</h2><span class="sub">your reflections</span></div>
        ${ai() ? `<div style="margin:8px 0"><button class="btn secondary small whisper-btn" data-action="whisper-insights">✨ what do my rings say?</button></div><div id="whisper-insights-out"></div>` : ''}
        ${journal || '<div class="empty-note">When a goal blooms, your reflection is kept here.</div>'}
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">Your data, yours</h2>
        <div class="settings-row">
          <button class="btn secondary small" data-action="export">⬇️ Export save</button>
          <button class="btn secondary small" data-action="import-trigger">⬆️ Import save</button>
          <input type="file" id="import-file" accept=".json,application/json" class="hidden">
          <button class="btn small" style="background:var(--danger)" data-action="reset">Start over</button>
        </div>
        <p class="sub" style="margin-top:6px">Everything lives in this browser only. Export a backup any time
          ${realCircle() ? '— it includes your circle membership.' : '.'}</p>
        ${realCircle() ? `
        <div class="settings-row" style="margin-top:10px">
          <span class="invite-chip">Circle: <b>${esc(realCircle().name)}</b></span>
          <button class="btn small" style="background:var(--danger)" data-action="rc-leave">Leave circle</button>
        </div>` : ''}
        ${ai() ? `
        <div class="settings-row">
          <span class="sub">Whisperer (AI): <b>${Whisper().consentGranted(st) ? 'listening ✨' : 'off'}</b></span>
          ${Whisper().consentGranted(st)
            ? `<button class="btn small secondary" data-action="whisper-consent-revoke">Turn off</button>` : ''}
        </div>` : ''}
        ${Whisper().speakAvailable() ? `
        <div class="settings-row" style="margin-top:10px">
          <span class="sub">Whisper voice:</span>
          <select id="voice-select" class="text-input" style="max-width:250px;padding:6px 10px">
            <option value="">Auto — warm female voice</option>
            ${Whisper().listVoices().map(v => `<option value="${esc(v.name)}"${(st.voice || {}).name === v.name ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
          </select>
          <button class="btn small secondary" data-action="voice-try">🔈 try</button>
        </div>` : ''}
        ${window.GrovePlatform ? `
        <div class="settings-row" style="margin-top:10px">
          ${st.account && st.account.userId
            ? `<span class="sub">Grove claimed ✨ <b>${esc(st.account.email || 'signed in')}</b>${st.account.lastBackupDay ? ` · backed up ${esc(st.account.lastBackupDay)}` : ''}</span>
               <button class="btn small secondary" data-action="account-backup-now">Back up now</button>
               <button class="btn small secondary" data-action="account-restore">Restore</button>`
            : `<span class="sub">Your grove lives only in this browser.</span>
               <button class="btn small accent" data-action="account-claim" data-trigger="settings">Claim my grove ✨</button>`}
        </div>
        ${st.account && st.account.userId ? `
        <label class="privacy-row"><input type="checkbox" id="backup-private" ${st.account.backupPrivateGoals ? 'checked' : ''}>
          🌙 include private goals in backups</label>
        ${window.GrovePlatform && window.GrovePlatform.notifications ? `
        <div class="settings-row"><button class="btn small secondary" data-action="push-subscribe">🔔 Keeper notes on this device</button></div>
        ${realCircle() ? `<div class="settings-row">
          <span class="sub">🌅 Garden time reminder:</span>
          <select id="reminder-select" class="text-input" style="max-width:150px;padding:6px 10px">
            <option value="">off</option>
            ${[6, 7, 8, 9, 10, 12, 14, 16, 17, 18, 19, 20, 21].map(h =>
              `<option value="${h}" ${st.reminderHour === h ? 'selected' : ''}>${h}:00</option>`).join('')}
          </select>
        </div>` : ''}` : ''}` : ''}
        ${realCircle() ? `
        <label class="privacy-row"><input type="checkbox" id="quiet-toggle" ${st.quiet ? 'checked' : ''}>
          🤫 quiet mode — no notes from the grove keeper</label>` : ''}` : ''}
      </div>`;
  }

  // ---------- goal wizard (onboarding + new goals) ----------
  function startWizard(isOnboarding) {
    ob = {
      onboarding: isOnboarding, stage: isOnboarding ? 'welcome' : 'template',
      name: ctx.state.player.name || '', avatarId: ctx.state.player.avatarId || 0,
      accentId: ctx.state.player.accentId || 0,
      domain: 'career', goalName: '', goalEmoji: '🌱', steps: [], private: false,
      seed: '', ideas: null, ideasLoading: false, anchor: '',
    };
    renderWizard();
  }

  function renderWizard() {
    if (!ob) return;
    if (ob.stage === 'welcome') {
      const avatars = D.PLAYER_AVATARS.map(a => `
        <button class="avatar-pick ${a.id === ob.avatarId ? 'selected' : ''}" data-action="pick-avatar" data-id="${a.id}">
          ${G.avatarSvg({ petal: a.petal, center: a.center })}${a.name}
        </button>`).join('');
      const accents = D.ACCENTS.map(a => `
        <button class="accent-dot ${a.id === ob.accentId ? 'selected' : ''}" style="background:${a.color}"
          data-action="pick-accent" data-id="${a.id}" title="${a.name}" aria-label="${a.name}"></button>`).join('');
      showModal(`
        <h2>Welcome to Grove 🌿</h2>
        <p class="sub">Grove turns your real goals into a garden. Do a small step in real
          life and your plant grows. Friends grow right beside you.</p>
        <label class="sub" style="font-weight:600">What should we call you?</label>
        <input class="text-input" id="ob-name" maxlength="24" placeholder="Your name" value="${esc(ob.name)}" style="margin:6px 0 14px">
        <div class="sub" style="font-weight:600">Pick your flower</div>
        <div class="avatar-row">${avatars}</div>
        <div class="sub" style="font-weight:600">Pick your accent</div>
        <div class="accent-row">${accents}</div>
        <div class="modal-actions">
          <button class="btn accent" data-action="ob-to-template">Next: plant a goal →</button>
        </div>`);
    } else if (ob.stage === 'template') {
      const domTabs = D.DOMAINS.map(d => `
        <button class="domain-tab ${d.id === ob.domain ? 'active' : ''}" data-action="pick-domain" data-id="${d.id}">
          ${d.emoji} ${d.name}</button>`).join('');
      const templates = D.GOAL_TEMPLATES.filter(t => t.domain === ob.domain).map((t, i) => `
        <button class="template-pick" data-action="pick-template" data-idx="${i}">
          <span class="temoji">${t.emoji}</span>
          <span><span class="tname">${esc(t.name)}</span><br>
          <span class="tsteps">${t.steps.length} tiny steps</span></span>
        </button>`).join('');
      showModal(`
        <h2>${ob.onboarding ? 'Plant your first goal 🌱' : 'Plant a new goal 🌱'}</h2>
        <p class="sub">Pick a path — or grow your own. Every goal becomes a plant; every step waters it.</p>
        <div class="domain-tabs">${domTabs}</div>
        <div class="template-list">${templates}
          ${ai() ? `<button class="template-pick whisper-btn" data-action="ob-ideas-open">
            <span class="temoji">✨</span>
            <span><span class="tname">Help me find a goal</span><br><span class="tsteps">tell the whisperer what’s on your mind</span></span>
          </button>` : ''}
          <button class="template-pick" data-action="pick-custom">
            <span class="temoji">🌱</span>
            <span><span class="tname">My own goal</span><br><span class="tsteps">write your own tiny steps</span></span>
          </button>
        </div>
        ${ob.onboarding ? '' : `<div class="modal-actions"><button class="btn secondary" data-action="close-modal">Cancel</button></div>`}`);
    } else if (ob.stage === 'ideas') {
      const ideas = (ob.ideas || []).map((idea, idx) => {
        const dom = domainById(idea.domain);
        return `
        <button class="template-pick" data-action="ob-idea-pick" data-idx="${idx}">
          <span class="temoji">${dom.emoji}</span>
          <span><span class="tname">${esc(idea.name)}</span><br>
          <span class="tsteps">${esc(idea.why)}</span></span>
        </button>`;
      }).join('');
      showModal(`
        <h2>What’s been on your mind? ✨</h2>
        <p class="sub">Say it any way it comes — the whisperer will shape it into goals you could plant.</p>
        <textarea id="ob-seed" class="text-input" rows="3" maxlength="240"
          placeholder="e.g. I feel stuck at work and I miss making things with my hands"
          style="margin:10px 0;resize:vertical">${esc(ob.seed || '')}</textarea>
        <div class="modal-actions" style="justify-content:flex-start;margin-top:0">
          <button class="btn accent" data-action="ob-ideas-get">✨ Suggest goals</button>
          ${(Whisper().speechAvailable() || serverDictationReady())
            ? `<button class="btn small secondary mic-btn" data-action="voice-dictate" data-target="ob-seed">🎙️ dictate</button>` : ''}
        </div>
        ${ob.ideasLoading ? '<div class="empty-note">✨ listening to the grove…</div>' : ''}
        ${ideas ? `<div class="template-list" style="margin-top:12px">${ideas}</div>` : ''}
        <div class="modal-actions">
          <button class="btn secondary" data-action="ob-back">← Back</button>
        </div>`);
    } else if (ob.stage === 'steps') {
      const stepRows = ob.steps.map((s, i) => `
        <div class="se-row">
          <input class="text-input ob-step" data-idx="${i}" value="${esc(s)}" maxlength="90">
          <button class="se-remove" data-action="ob-remove-step" data-idx="${i}" aria-label="Remove step">✕</button>
        </div>`).join('');
      showModal(`
        <h2>Make it yours ✍️</h2>
        <p class="sub">Small steps win. Each step should fit in one day. You can change anything.</p>
        <label class="sub" style="font-weight:600">Goal name</label>
        <input class="text-input" id="ob-goal-name" maxlength="48" value="${esc(ob.goalName)}" style="margin:6px 0 12px">
        <div class="sub" style="font-weight:600">When will you work on it? <span style="font-weight:400">(optional — a time helps it stick)</span></div>
        <div class="domain-tabs" style="margin:6px 0 12px">
          ${Object.keys(ANCHORS).map(id => `
            <button class="domain-tab ${ob.anchor === id ? 'active' : ''}" data-action="ob-anchor" data-id="${id}">
              ${ANCHORS[id].emoji} ${ANCHORS[id].label}</button>`).join('')}
          <button class="domain-tab ${!ob.anchor ? 'active' : ''}" data-action="ob-anchor" data-id="">🤍 whenever</button>
        </div>
        <div class="sub" style="font-weight:600;margin-bottom:4px">Tiny steps (${ob.steps.length})</div>
        <div class="steps-editor">${stepRows}</div>
        <button class="btn secondary small" data-action="ob-add-step">+ add a step</button>
        ${ai() ? `<button class="btn secondary small whisper-btn" data-action="whisper-steps">🪄 draft my tiny steps</button>
        <button class="btn secondary small whisper-btn" data-action="assess-plan">🧭 mentor check</button>
        <div id="assess-out"></div>` : ''}
        ${netConfigured() ? `<label class="privacy-row">
          <input type="checkbox" id="ob-private" ${ob.private ? 'checked' : ''}>
          🌙 keep this goal private to me</label>` : ''}
        <div class="modal-actions">
          <button class="btn secondary" data-action="ob-back">← Back</button>
          <button class="btn accent" data-action="ob-finish">🌱 Plant this goal</button>
        </div>`);
    }
  }

  function collectWizardInputs() {
    const nameEl = $('#ob-name');
    if (nameEl) ob.name = nameEl.value.trim();
    const seedEl = $('#ob-seed');
    if (seedEl) ob.seed = seedEl.value;
    const goalEl = $('#ob-goal-name');
    if (goalEl) ob.goalName = goalEl.value.trim();
    const privEl = $('#ob-private');
    if (privEl) ob.private = privEl.checked;
    document.querySelectorAll('.ob-step').forEach(inp => {
      ob.steps[Number(inp.dataset.idx)] = inp.value;
    });
  }

  function finishWizard() {
    collectWizardInputs();
    const steps = ob.steps.map(s => s.trim()).filter(Boolean);
    if (!ob.goalName) { toast('Give your goal a name 🌱'); return; }
    if (steps.length < 2) { toast('Add at least two tiny steps'); return; }
    const st = ctx.state;
    const goal = {
      id: uid('g'), name: ob.goalName, domain: ob.domain, emoji: ob.goalEmoji,
      steps: steps.map(text => ({ id: uid('s'), text, done: false, doneAt: null })),
      createdAt: Date.now(), bloomedAt: null, reflection: null, private: !!ob.private,
      anchor: ob.anchor || null,
    };
    st.goals.push(goal);

    if (ob.onboarding) {
      st.player.name = ob.name;
      st.player.avatarId = ob.avatarId;
      st.player.accentId = ob.accentId;
      st.onboarded = true;
      L.rolloverChallengeIfNeeded(st, Date.now()); // arm this week's collective target
      applyAccent();
      const maya = memberDef('maya');
      st.circle.feedSeq = (st.circle.feedSeq || 0) + 1;
      st.circle.feed.push({
        id: 'e' + st.circle.feedSeq, ts: Date.now(), memberId: 'maya', type: 'welcome',
        text: `Welcome to the grove, ${st.player.name || 'friend'}! We grow at our own pace here. — ${maya.name}`,
        cheered: false,
      });
      toast(`Welcome, ${esc(st.player.name || 'friend')} 🌿 Your garden begins today.`, 'rose');
    } else {
      toast(`“${esc(goal.name)}” planted 🌱`, 'rose');
    }
    const newBadges = L.evaluateBadges(st, Date.now());
    announceBadges(newBadges);
    const wasOnboarding = ob.onboarding;
    ob = null;
    closeModal();
    ctx.save();
    renderAll();
    if (wasOnboarding && pendingJoin && netConfigured()) {
      const code = pendingJoin;
      pendingJoin = null;
      setTimeout(() => { switchView('circle'); openJoinModal(code); }, 700);
    }
  }

  function applyAccent() {
    const accent = D.ACCENTS[ctx.state.player.accentId] || D.ACCENTS[0];
    document.documentElement.style.setProperty('--accent', accent.color);
    document.documentElement.style.setProperty('--accent-soft', G.shade(accent.color, 0.85));
  }

  // ---------- action handlers ----------
  function announceBadges(ids) {
    for (const id of ids) {
      const b = D.BADGES[id];
      if (b) toast(`${b.icon} Badge earned: <strong>${esc(b.name)}</strong>`, 'gold');
    }
  }

  // A half-second petal fall at the tapped checkbox — celebration wires habits.
  function spawnPetals(el) {
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const p = document.createElement('span');
      p.className = 'petal-bit';
      p.textContent = ['🌸', '🌼', '🌺'][i % 3];
      p.style.left = (r.left + r.width / 2 + (Math.random() * 40 - 20)) + 'px';
      p.style.top = (r.top + window.scrollY) + 'px';
      p.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
      p.style.animationDelay = (Math.random() * 0.15) + 's';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1000);
    }
  }

  function handleCompleteStep(goalId, stepId, btn) {
    const st = ctx.state;
    const levelBefore = L.levelForXp(st.xp).level;
    const events = L.completeStep(st, goalId, stepId, Date.now(), Math.random);
    if (!events.length) return;

    spawnPetals(btn);
    const goal = st.goals.find(g => g.id === goalId);
    toast(`+${L.XP.STEP} xp · +${L.PETALS.STEP} petals 🌸`);

    for (const e of events) {
      if (e.type === 'lucky') {
        toast(e.kind === 'golden'
          ? `✨ A golden seed! +${e.petals} bonus petals`
          : `🍀 A lucky petal drifted down — +${e.petals} bonus petals`, 'gold');
      }
      if (e.type === 'streak') {
        if (e.earnedShield) toast('💧 You earned a Dew Shield — one missed day, forgiven.', 'gold');
        else if (e.usedShield) toast('💧 A Dew Shield kept your streak alive. Welcome back.');
        if (e.count > 1 && !e.usedShield && !e.reset) toast(`🔥 ${e.count} days in a row`);
      }
      if (e.type === 'stage-up') toast(`🌿 “${esc(goal.name)}” grew to its ${stageName(e.stage)} stage`);
      if (e.type === 'challenge-complete') toast(`🌼 Weekly challenge bloomed! +${L.XP.CHALLENGE} xp for the whole grove`, 'gold');
      if (e.type === 'bloom') showBloomModal(goal);
    }

    const levelAfter = L.levelForXp(st.xp);
    if (levelAfter.level > levelBefore) toast(`✨ Level up — you're a <strong>${esc(levelAfter.title)}</strong> now`, 'gold');

    // Real circle: share the step (title-level only), and if a boost was out,
    // this step is the comeback — credit everyone who cheered.
    if (realCircle() && syncer()) {
      syncer().queue(Social().buildStepEvent(goal, L.goalStage(goal)));
      if (events.some(e => e.type === 'bloom')) syncer().queue(Social().buildBloomEvent(goal));
      if (st.net.playerStruggle) {
        syncer().queue(Social().buildRecoverEvent(st.net.playerStruggle.supporters));
        st.net.playerStruggle = null;
        toast('🌈 That step was your comeback — your circle saw it.', 'rose');
      }
    }

    announceBadges(L.evaluateBadges(st, Date.now()));
    ctx.save();
    renderAll();

    // The circle notices, a moment later.
    setTimeout(() => {
      const rng = Sim.makeRng((Date.now() % 100000) + st.xp);
      const cheers = Sim.reactions(st, rng, Date.now());
      for (const c of cheers.slice(0, 1)) {
        const def = memberDef(c.memberId);
        toast(`☀️ ${esc(def.name)}: “${esc(c.text)}”`, 'rose');
      }
      ctx.save();
      if (currentView === 'circle') renderView('circle');
    }, 1400);
  }

  function showBloomModal(goal) {
    const dom = domainById(goal.domain);
    showModal(`
      <div class="bloom-celebrate">
        ${G.plantSvg(4, dom.color)}
        <h2>“${esc(goal.name)}” bloomed 🌸</h2>
        <p class="sub">You did this — step by tiny step. It lives in your Meadow forever.</p>
        <p class="sub" style="margin-top:10px;font-weight:600">One line for your Growth Rings: what did this teach you?</p>
        <input class="text-input" id="reflection-input" maxlength="140"
          placeholder="e.g. Starting badly beats not starting" style="margin:8px 0 4px">
        ${Whisper().speechAvailable() ? `<button class="btn small secondary mic-btn" data-action="voice-dictate" data-target="reflection-input">🎙️ dictate</button>` : ''}
        <div class="modal-actions" style="justify-content:center">
          <button class="btn secondary" data-action="skip-reflection" data-goal="${goal.id}">Skip</button>
          <button class="btn accent" data-action="save-reflection" data-goal="${goal.id}">Keep it 📖</button>
        </div>
      </div>`);
  }

  function saveReflection(goalId, skip) {
    const st = ctx.state;
    const goal = st.goals.find(g => g.id === goalId);
    if (!skip) {
      const input = $('#reflection-input');
      const text = input ? input.value.trim() : '';
      if (text) {
        goal.reflection = text;
        st.journal.push({ day: L.dayKey(Date.now()), text, goalId });
        toast('Kept in your Growth Rings 📖');
      }
    }
    closeModal();
    ctx.save();
    renderAll();
    // Investment loop: the moment one garden bed empties, offer the next seed.
    if (L.activeGoals(st).length === 0) {
      setTimeout(() => {
        toast('Plant your next seed? 🌱', 'rose');
        startWizard(false);
      }, 900);
    }
  }

  function handleCheer(memberId) {
    const st = ctx.state;
    const def = memberDef(memberId);
    const events = Sim.supportMember(st, memberId, Date.now());
    toast(`☀️ Sunshine sent to ${esc(def.name)} · +${L.XP.CHEER} xp`);
    if (events.some(e => e.type === 'recovery')) {
      setTimeout(() => {
        toast(`🌈 ${esc(def.name)} is back on her feet — your words helped.`, 'rose');
        if (currentView === 'circle') renderView('circle');
      }, 1600);
    }
    announceBadges(L.evaluateBadges(st, Date.now()));
    ctx.save();
    renderAll();
  }

  // ---------- real circle actions ----------
  function openCreateModal() {
    showModal(`
      <h2>Start a circle 💛</h2>
      <p class="sub">Name it, then share the invite code with up to four women you trust.</p>
      <label class="sub" style="font-weight:600">Circle name</label>
      <input class="text-input" id="rc-name" maxlength="40" placeholder="e.g. The Tuesday Bloomers" style="margin:6px 0 4px">
      <div class="modal-actions">
        <button class="btn secondary" data-action="close-modal">Cancel</button>
        <button class="btn accent" data-action="rc-create">Create circle</button>
      </div>`);
  }

  function openJoinModal(code) {
    showModal(`
      <h2>Join a circle 🌱</h2>
      <p class="sub">Enter the six-letter code your friend shared.</p>
      <input class="text-input" id="rc-code" maxlength="6" placeholder="ABC234" value="${esc(code || '')}"
        style="margin:10px 0 4px;text-transform:uppercase;letter-spacing:.2em;font-weight:700">
      <div class="modal-actions">
        <button class="btn secondary" data-action="close-modal">Cancel</button>
        <button class="btn accent" data-action="rc-join">Join</button>
      </div>`);
  }

  function openBoostModal() {
    showModal(`
      <h2>Ask for a boost 💛</h2>
      <p class="sub">${esc(D.REAL_CIRCLE.boostHint)}</p>
      <textarea class="text-input boost-composer" id="boost-text" maxlength="280"
        placeholder="${esc(D.REAL_CIRCLE.boostPlaceholder)}"></textarea>
      ${Whisper().speechAvailable() ? `<button class="btn small secondary mic-btn" data-action="voice-dictate" data-target="boost-text">🎙️ dictate</button>` : ''}
      <div class="modal-actions">
        <button class="btn secondary" data-action="close-modal">Not now</button>
        <button class="btn accent" data-action="rc-boost-send">Send to my circle</button>
      </div>`);
  }

  async function handleCreateCircle() {
    const name = ($('#rc-name') ? $('#rc-name').value.trim() : '') || 'Our Grove';
    if (!flows()) return;
    closeModal();
    toast('Planting your circle…');
    const r = await flows().createCircleFlow(name);
    if (r.ok) toast(`Circle “${esc(name)}” is live — share the code! 💛`, 'rose');
    else toast(esc(D.REAL_CIRCLE.joinErrors[r.error] || D.REAL_CIRCLE.joinErrors.offline));
    renderAll();
  }

  async function handleJoinCircle() {
    const code = ($('#rc-code') ? $('#rc-code').value.trim().toUpperCase() : '');
    if (code.length !== 6) { toast('The code has six characters 🌱'); return; }
    if (!flows()) return;
    closeModal();
    toast('Finding your circle…');
    const r = await flows().joinCircleFlow(code);
    if (r.ok) toast(`Welcome to “${esc(r.circleName)}” 💛`, 'rose');
    else toast(esc(D.REAL_CIRCLE.joinErrors[r.error] || D.REAL_CIRCLE.joinErrors.offline));
    renderAll();
  }

  function copyInviteLink() {
    const rc = realCircle();
    if (!rc) return;
    const link = flows() ? flows().buildInviteLink(rc.inviteCode) : rc.inviteCode;
    const fallback = () => window.prompt('Copy this invite link:', link);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link)
        .then(() => toast('Invite link copied — send it to a friend 💌', 'rose'), fallback);
    } else {
      fallback();
    }
  }

  function handleBoostSend() {
    const text = ($('#boost-text') ? $('#boost-text').value.trim() : '');
    if (!text) { toast('Say a little about what’s heavy 💛'); return; }
    const st = ctx.state;
    if (!realCircle() || !syncer()) return;
    const ev = Social().buildStruggleEvent(text);
    st.net.playerStruggle = { eventKey: ev.client_key, postedAt: Date.now(), supporters: [] };
    st.circle.feed.push({
      id: 'r-' + ev.client_key, ts: Date.now(), type: 'struggle',
      text: `${st.player.name || 'You'}: “${ev.payload.text}”`,
      real: true, memberId: st.net.circle.memberId, name: st.player.name || 'You',
      avatarId: String(st.player.avatarId), cheered: false,
    });
    syncer().queue(ev);
    closeModal();
    toast('Your circle will see it — asking is a strength 💛', 'rose');
    ctx.save();
    renderAll();
  }

  function handleCheerReal(memberId, eventId) {
    const st = ctx.state;
    if (!realCircle() || !syncer()) return;
    const phrase = D.CHEER_PHRASES[Math.floor(Math.random() * D.CHEER_PHRASES.length)];
    if (eventId) {
      const item = st.circle.feed.find(e => e.id === eventId);
      if (item) item.cheered = true;
    }
    L.cheer(st, Date.now());
    syncer().queue(Social().buildCheerEvent(memberId, phrase.id));
    const m = st.net.members.find(x => x.id === memberId);
    toast(`☀️ “${esc(phrase.text)}” → ${esc(m ? m.name : 'your friend')} · +${L.XP.CHEER} xp`);
    announceBadges(L.evaluateBadges(st, Date.now()));
    ctx.save();
    renderAll();
  }

  async function handleLeaveCircle() {
    if (!window.confirm('Leave this circle? Your garden stays with you; your seat opens up.')) return;
    if (!flows()) return;
    const r = await flows().leaveCircleFlow();
    toast(r.ok ? 'You stepped out of the circle 🍂' : esc(D.REAL_CIRCLE.joinErrors.offline));
    renderAll();
  }

  function handleTogglePrivate(goalId) {
    const g = ctx.state.goals.find(x => x.id === goalId);
    if (!g) return;
    g.private = !g.private;
    toast(g.private
      ? 'Kept as a quiet goal 🌙 — your circle sees progress only'
      : 'Shared with your circle 🌤️');
    ctx.save();
    renderAll();
  }

  // ---------- claiming the grove (progressive accounts) ----------
  async function handleClaim(trigger) {
    const auth = flows() && flows().auth;
    if (!auth) { toast('Accounts live on the platform version 🌿'); return; }
    try {
      const r = await auth.signIn();
      const st = ctx.state;
      st.account.userId = r.user.userId;
      st.account.email = r.user.email || null;
      st.account.linkedAt = Date.now();
      st.accountPrompt.claimed = true;
      if (realCircle()) await flows().linkAccount();
      const push = await flows().backupPush(S.backupBlob(st, !!st.account.backupPrivateGoals));
      if (push.ok) st.account.lastBackupDay = L.dayKey(Date.now());
      ctx.save();
      toast('Your grove is claimed — it can follow you anywhere now ✨', 'rose');
      renderAll();
    } catch (e) {
      if (e && e.code === 'popup_blocked') toast('Your browser blocked the sign-in window — allow popups and try again.');
      else if (e && e.code === 'popup_closed') toast('No rush — claim your grove any time from More 🌿');
      else toast('Sign-in hiccuped — try again in a moment 🌿');
    }
  }

  function handleClaimLater(trigger) {
    const st = ctx.state;
    if (!st.accountPrompt.shown) st.accountPrompt.shown = {};
    st.accountPrompt.shown[trigger] = true;
    ctx.save();
    renderView('today');
  }

  async function handleBackupNow() {
    const auth = flows() && flows().auth;
    const st = ctx.state;
    if (!auth || !auth.isSignedIn()) { toast('Sign in first — tap “Claim my grove” 🌿'); return; }
    const r = await flows().backupPush(S.backupBlob(st, !!st.account.backupPrivateGoals));
    if (r.ok) {
      st.account.lastBackupDay = L.dayKey(Date.now());
      ctx.save();
      toast('Backed up — your garden is safe ⬆️🌿', 'rose');
      renderView('more');
    } else {
      toast('Backup could not reach the grove — try again soon.');
    }
  }

  async function handleRestore() {
    const auth = flows() && flows().auth;
    if (!auth || !auth.isSignedIn()) { toast('Sign in first — tap “Claim my grove” 🌿'); return; }
    if (!window.confirm('Replace this browser’s garden with your cloud backup?')) return;
    const r = await flows().backupPull();
    if (!r.ok) {
      toast(r.error === 'not-found' || r.error === 'http-404'
        ? 'No backup found yet — make one with “Back up now”.'
        : 'Could not reach your backup — try again soon.');
      return;
    }
    try {
      const restored = S.importJson(r.blob);
      ctx.replaceState(restored);
      applyAccent();
      toast('Garden restored from your account 🌿', 'rose');
      renderAll();
    } catch (e) {
      toast('That backup could not be read, sorry.');
    }
  }

  // ---------- the whisperer (AI, consent-gated) ----------
  function withConsent(fn) {
    if (Whisper().consentGranted(ctx.state)) { fn(); return; }
    pendingConsentAction = fn;
    showModal(`
      <h2>The Grove Whisperer ✨</h2>
      <p class="sub">A little AI lives in real groves. When you tap a whisperer button,
        only the words involved — a goal name you're drafting steps for, a dream you
        describe, a voice note it transcribes for you, or the journal lines you ask it
        to read — are sent to the platform's AI to write something back.
        Nothing is ever sent until you tap.</p>
      <p class="sub consent-note">🌙 Private goals are never included. You can turn the
        whisperer off any time in More → your data.</p>
      <div class="modal-actions">
        <button class="btn secondary" data-action="whisper-consent-decline">Not now</button>
        <button class="btn accent" data-action="whisper-consent-accept">Let it whisper ✨</button>
      </div>`);
  }

  // The consent dialog may have replaced the goal wizard's modal — bring the
  // wizard (and every typed input, held in ob) back before anything else, so
  // neither accepting nor declining ever costs her the plan she wrote.
  function restoreWizardIfOpen() {
    if (ob) renderWizard();
  }

  function handleConsentAccept() {
    Whisper().grantConsent(ctx.state, Date.now());
    ctx.save();
    closeModal();
    restoreWizardIfOpen();
    const fn = pendingConsentAction;
    pendingConsentAction = null;
    if (fn) fn();
  }

  function handleConsentDecline() {
    pendingConsentAction = null;
    closeModal();
    restoreWizardIfOpen();
  }

  function handleConsentRevoke() {
    Whisper().revokeConsent(ctx.state);
    ctx.save();
    toast('The whisperer sleeps. Your grove is yours alone 🌙');
    renderAll();
  }

  // Goal discovery: whatever is on her mind becomes three plantable ideas.
  function handleGoalIdeas() {
    collectWizardInputs(); // seed must survive the consent modal swap
    withConsent(async () => {
      if (!ob) return;
      const seed = String(ob.seed || '').trim();
      if (seed.length < 4) { toast('Tell the grove a little more first 🌱'); return; }
      if (!ai()) { toast(esc(D.REAL_CIRCLE.aiQuiet)); return; }
      ob.ideasLoading = true;
      ob.ideas = null;
      renderWizard();
      const r = await ai().goalIdeas({ seed, domain: ob.domain });
      if (!ob) return; // wizard closed while we waited
      ob.ideasLoading = false;
      if (r.ok && Array.isArray(r.ideas) && r.ideas.length) {
        ob.ideas = r.ideas;
        renderWizard();
      } else {
        renderWizard();
        toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
      }
    });
  }

  function handleIdeaPick(idx) {
    const idea = ob && ob.ideas && ob.ideas[idx];
    if (!idea) return;
    ob.goalName = idea.name;
    ob.domain = idea.domain;
    ob.goalEmoji = '✨';
    ob.steps = ['My first tiny step', 'My second tiny step', 'My third tiny step'];
    ob.stage = 'steps';
    renderWizard();
    // Consent was granted to get here — draft her tiny steps in the same breath.
    handleWhisperSteps();
  }

  function handleWhisperSteps() {
    // Collect BEFORE the consent modal replaces the wizard DOM, or the typed
    // goal name is lost when the continuation finally runs.
    collectWizardInputs();
    withConsent(async () => {
      if (!ob) return;
      if (!ob.goalName) { toast('Name your goal first 🌱'); return; }
      if (!ai()) { toast(esc(D.REAL_CIRCLE.aiQuiet)); return; }
      toast('🪄 The whisperer is thinking…');
      const r = await ai().steps({ goalName: ob.goalName, domain: ob.domain });
      if (!ob) return;   // wizard closed while we waited
      if (r.ok && Array.isArray(r.steps) && r.steps.length >= 2) {
        ob.steps = r.steps.slice(0, 10).map(s => String(s));
        renderWizard();
        toast('Steps drafted — edit anything ✨', 'rose');
      } else {
        toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
      }
    });
  }

  function sendCheerWithText(memberId, eventId, text) {
    const st = ctx.state;
    if (!realCircle() || !syncer()) return;
    if (eventId) {
      const item = st.circle.feed.find(e => e.id === eventId);
      if (item) item.cheered = true;
    }
    L.cheer(st, Date.now());
    syncer().queue(Social().buildCheerEvent(memberId, 'ai', text));
    closeModal();
    toast(`☀️ Sent: “${esc(text)}”`);
    announceBadges(L.evaluateBadges(st, Date.now()));
    ctx.save();
    renderAll();
  }

  function handleWhisperReplies(memberId, eventId) {
    withConsent(async () => {
      const item = ctx.state.circle.feed.find(e => e.id === eventId);
      if (!item || !ai()) return;
      toast('✨ Listening for the right words…');
      const r = await ai().boostReplies({ struggleText: item.text });
      if (r.ok && Array.isArray(r.replies) && r.replies.length) {
        showModal(`
          <h2>Reply with warmth 💛</h2>
          <p class="sub">Pick one — it sends as your sunshine, in your name.</p>
          ${r.replies.slice(0, 3).map(t => `
            <button class="reply-chip" data-action="whisper-reply-send"
              data-member="${esc(memberId)}" data-event="${esc(eventId)}"
              data-text="${esc(t)}">${esc(t)}</button>`).join('')}
          <div class="modal-actions">
            <button class="btn secondary" data-action="close-modal">I'll write my own</button>
          </div>`);
      } else {
        toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
      }
    });
  }

  function handleWhisperPersonal(memberId, eventId, name) {
    withConsent(async () => {
      const item = ctx.state.circle.feed.find(e => e.id === eventId);
      if (!ai()) return;
      toast('✨ Finding the right words…');
      const r = await ai().cheer({
        toName: name, goalTitle: item ? (item.goalTitle || null) : null, kind: 'step',
      });
      if (r.ok && r.line) sendCheerWithText(memberId, eventId, String(r.line));
      else toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
    });
  }

  function handleWhisperInsights() {
    withConsent(async () => {
      if (!ai()) return;
      const out = $('#whisper-insights-out');
      if (out) out.innerHTML = '<div class="whisper-card">✨ reading your rings…</div>';
      const r = await ai().insights(Whisper().insightsPayload(ctx.state));
      if (r.ok && r.text) {
        if (out) out.innerHTML = `<div class="whisper-card">✨ ${esc(r.text)}</div>`;
      } else {
        if (out) out.innerHTML = '';
        toast(esc(r.error === 'ai-rest' ? D.REAL_CIRCLE.aiRest : D.REAL_CIRCLE.aiQuiet));
      }
    });
  }

  function maybeFetchDailyWhisper() {
    const st = ctx.state;
    if (dailyWhisperTried || !ai() || !Whisper().consentGranted(st)) return;
    if (!Whisper().dailyWhisperDue(st, Date.now())) return;
    dailyWhisperTried = true;
    ai().cheer(Object.assign({ kind: 'daily' }, Whisper().whisperContext(st))).then(r => {
      if (r.ok && r.line) {
        Whisper().rememberWhisper(st, String(r.line), Date.now());
        ctx.save();
        if (currentView === 'today') renderView('today');
      }
    });
  }

  // Every way the mic can fail gets a warm, specific note — silence is how
  // a button earns the reputation of "not working".
  const DICTATE_NOTES = {
    'not-allowed': 'The microphone is blocked — allow mic access for this site, then try again 🎙️',
    'service-not-allowed': 'The microphone is blocked — allow mic access for this site, then try again 🎙️',
    'audio-capture': 'No microphone found — typing works just as well 🌿',
    'no-speech': 'Didn’t catch anything — try again, a little closer 🌱',
    'network': 'The speech service couldn’t be reached — typing works too 🌿',
    'no-response': 'Voice input isn’t responding in this browser — typing works too 🌿',
    'aborted': null, // she stopped it herself — stay quiet
  };
  const DICTATE_FALLBACK_NOTE = 'Voice input hiccuped — typing works too 🌿';

  // Errors that mean "this browser's speech service is a zombie" — Opera and
  // friends expose the API but nothing answers. The grove's own transcriber
  // takes over when it can.
  const SERVER_DICTATE_ERRORS = ['no-response', 'network', 'service-not-allowed', 'language-not-supported'];

  function serverDictationReady() {
    return !!(ai() && Whisper().consentGranted(ctx.state) && Whisper().recorderAvailable());
  }

  function serverDictate(el, btn) {
    const session = Whisper().makeRecorder({
      onStart() {
        btn.classList.add('listening');
        toast('Recording — tap the mic again to finish 🎙️');
      },
      onBlob(base64, mimeType) {
        toast('The whisperer is listening back… ✨');
        ai().transcribe({ audio: base64, mimeType }).then((r) => {
          if (r.ok && r.text) {
            el.value = (el.value ? el.value + ' ' : '') + r.text;
            el.focus();
          } else if (r.error === 'ai-rest') {
            toast(esc(D.REAL_CIRCLE.aiRest));
          } else if (r.error === 'http-422') {
            toast(DICTATE_NOTES['no-speech']);
          } else {
            toast('The transcriber hiccuped — typing works too 🌿');
          }
        });
      },
      onError(kind) {
        const note = (kind in DICTATE_NOTES) ? DICTATE_NOTES[kind] : DICTATE_FALLBACK_NOTE;
        if (note) toast(note);
      },
      onEnd() {
        dictation = null;
        btn.classList.remove('listening');
      },
    });
    if (!session) { toast(DICTATE_FALLBACK_NOTE); return; }
    dictation = session;
    btn.classList.add('listening');
    session.start();
  }

  function handleDictate(targetId, btn) {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (dictation) {
      dictation.stop(); // onEnd resets the button and clears the session
      return;
    }
    // A device that proved its native recognition dead goes straight to the
    // grove's transcriber on every later tap.
    if ((ctx.state.voice || {}).dictate === 'server' && serverDictationReady()) {
      serverDictate(el, btn);
      return;
    }
    const session = Whisper().makeDictation({
      onStart() { btn.classList.add('listening'); },
      onText(text) {
        el.value = (el.value ? el.value + ' ' : '') + text;
        el.focus();
      },
      onError(kind) {
        if (SERVER_DICTATE_ERRORS.indexOf(kind) !== -1) {
          if (serverDictationReady()) {
            if (!ctx.state.voice) ctx.state.voice = { name: null };
            ctx.state.voice.dictate = 'server';
            ctx.save();
            toast('Native voice input is asleep in this browser — the grove will listen instead 🌿');
            setTimeout(() => { if (!dictation) serverDictate(el, btn); }, 400);
            return;
          }
          if (ai() && !Whisper().consentGranted(ctx.state)) {
            toast('This browser needs the Whisperer to hear you — tap any ✨ button once to turn it on, then try the mic again.');
            return;
          }
        }
        const note = (kind in DICTATE_NOTES) ? DICTATE_NOTES[kind] : DICTATE_FALLBACK_NOTE;
        if (note) toast(note);
      },
      onEnd() {
        dictation = null;
        btn.classList.remove('listening');
      },
    });
    if (!session) {
      if (serverDictationReady()) { serverDictate(el, btn); return; }
      toast('Voice input isn’t available in this browser — typing works great too 🌿');
      return;
    }
    dictation = session;
    btn.classList.add('listening'); // immediate feedback; onStart confirms it
    session.start();
  }

  function handleBuy(itemId) {
    const st = ctx.state;
    const item = D.SHOP_ITEMS.find(i => i.id === itemId);
    if (!item || st.shopOwned.includes(itemId) || st.petals < item.price) return;
    st.petals -= item.price;
    st.shopOwned.push(itemId);
    st.decor.push({ itemId, x: st.decor.length });
    toast(`${item.name} added to your garden 🌿`, 'rose');
    ctx.save();
    renderAll();
  }

  function handleExport() {
    const blob = new Blob([S.exportJson(ctx.state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grove-save-${L.dayKey(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Save exported ⬇️');
  }

  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const st = S.importJson(String(reader.result));
        ctx.replaceState(st);
        applyAccent();
        toast('Garden restored 🌿', 'rose');
        renderAll();
      } catch (e) {
        toast('That file is not a Grove save, sorry.');
      }
    };
    reader.readAsText(file);
  }

  // ---------- delegation ----------
  function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;

    if (a === 'nav') switchView(btn.dataset.view);
    else if (a === 'check-step') handleCompleteStep(btn.dataset.goal, btn.dataset.step, btn);
    else if (a === 'cheer') handleCheer(btn.dataset.member);
    else if (a === 'buy') handleBuy(btn.dataset.item);
    else if (a === 'new-goal') startWizard(false);
    else if (a === 'pick-avatar') { collectWizardInputs(); ob.avatarId = Number(btn.dataset.id); renderWizard(); }
    else if (a === 'pick-accent') { collectWizardInputs(); ob.accentId = Number(btn.dataset.id); renderWizard(); }
    else if (a === 'ob-to-template') { collectWizardInputs(); ob.stage = 'template'; renderWizard(); }
    else if (a === 'pick-domain') { ob.domain = btn.dataset.id; renderWizard(); }
    else if (a === 'pick-template') {
      const t = D.GOAL_TEMPLATES.filter(x => x.domain === ob.domain)[Number(btn.dataset.idx)];
      ob.goalName = t.name; ob.goalEmoji = t.emoji; ob.steps = t.steps.slice();
      ob.stage = 'steps'; renderWizard();
    }
    else if (a === 'ob-ideas-open') { collectWizardInputs(); ob.stage = 'ideas'; ob.ideas = null; renderWizard(); }
    else if (a === 'ob-anchor') { collectWizardInputs(); ob.anchor = btn.dataset.id || ''; renderWizard(); }
    else if (a === 'keeper-notes-clear') {
      ctx.state.keeperNotes = [];
      ctx.save();
      renderView('today');
    }
    else if (a === 'ob-ideas-get') handleGoalIdeas();
    else if (a === 'ob-idea-pick') handleIdeaPick(Number(btn.dataset.idx));
    else if (a === 'pick-custom') {
      ob.goalName = ''; ob.goalEmoji = '✨';
      ob.steps = ['My first tiny step', 'My second tiny step', 'My third tiny step'];
      ob.stage = 'steps'; renderWizard();
    }
    else if (a === 'ob-add-step') { collectWizardInputs(); ob.steps.push(''); renderWizard(); }
    else if (a === 'ob-remove-step') { collectWizardInputs(); ob.steps.splice(Number(btn.dataset.idx), 1); renderWizard(); }
    else if (a === 'ob-back') { collectWizardInputs(); ob.stage = 'template'; renderWizard(); }
    else if (a === 'ob-finish') finishWizard();
    else if (a === 'save-reflection') saveReflection(btn.dataset.goal, false);
    else if (a === 'skip-reflection') saveReflection(btn.dataset.goal, true);
    else if (a === 'rc-create-open') openCreateModal();
    else if (a === 'rc-join-open') openJoinModal('');
    else if (a === 'rc-create') handleCreateCircle();
    else if (a === 'rc-join') handleJoinCircle();
    else if (a === 'rc-copy-code') copyInviteLink();
    else if (a === 'rc-boost-open') openBoostModal();
    else if (a === 'rc-boost-send') handleBoostSend();
    else if (a === 'rc-leave') handleLeaveCircle();
    else if (a === 'cheer-real') handleCheerReal(btn.dataset.member, btn.dataset.event);
    else if (a === 'toggle-private') handleTogglePrivate(btn.dataset.goal);
    else if (a === 'whisper-consent-accept') handleConsentAccept();
    else if (a === 'whisper-consent-decline') handleConsentDecline();
    else if (a === 'whisper-consent-revoke') handleConsentRevoke();
    else if (a === 'whisper-steps') handleWhisperSteps();
    else if (a === 'whisper-replies') handleWhisperReplies(btn.dataset.member, btn.dataset.event);
    else if (a === 'whisper-reply-send') sendCheerWithText(btn.dataset.member, btn.dataset.event, btn.dataset.text);
    else if (a === 'whisper-personal') handleWhisperPersonal(btn.dataset.member, btn.dataset.event, btn.dataset.name);
    else if (a === 'whisper-insights') handleWhisperInsights();
    else if (a === 'account-claim') handleClaim(btn.dataset.trigger || 'settings');
    else if (a === 'account-later') handleClaimLater(btn.dataset.trigger || 'settings');
    else if (a === 'account-backup-now') handleBackupNow();
    else if (a === 'account-restore') handleRestore();
    else if (a === 'voice-speak') Whisper().speak(affirmationOfTheDay(), (ctx.state.voice || {}).name);
    else if (a === 'voice-try') Whisper().speak('Hello! Your garden is glad you are here.', (ctx.state.voice || {}).name);
    else if (a === 'voice-dictate') handleDictate(btn.dataset.target, btn);
    else if (a === 'chat-send') handleChatSend();
    else if (a === 'chat-voice') handleChatVoice(btn);
    else if (a === 'chat-play') handleChatPlay(btn.dataset.path);
    else if (a === 'chat-speak') Whisper().speak(btn.dataset.text, (ctx.state.voice || {}).name);
    else if (a === 'chat-mentor-toggle') { chatToMentor = !chatToMentor; refreshChatCard(); }
    else if (a === 'mentor-invite') openMentorModal();
    else if (a === 'mentor-save') handleMentorSave();
    else if (a === 'mentor-remove') handleMentorRemove();
    else if (a === 'assess-plan') handleAssess();
    else if (a === 'assess-add') { collectWizardInputs(); ob.steps.push(btn.dataset.text); renderWizard(); }
    else if (a === 'push-subscribe') {
      window.GrovePlatform.notifications.subscribe()
        .then(() => toast('🔔 Keeper notes will reach this device', 'rose'))
        .catch(() => toast('Notifications are not available here.'));
    }
    else if (a === 'close-modal') { ob = null; closeModal(); }
    else if (a === 'export') handleExport();
    else if (a === 'import-trigger') $('#import-file').click();
    else if (a === 'reset') {
      if (window.confirm('Start completely over? Your garden, goals, and journal will be gone.')) {
        S.reset();
        window.location.reload();
      }
    }
  }

  function onChange(ev) {
    if (ev.target.id === 'import-file' && ev.target.files && ev.target.files[0]) {
      handleImportFile(ev.target.files[0]);
      ev.target.value = '';
    }
    if (ev.target.id === 'voice-select') {
      if (!ctx.state.voice) ctx.state.voice = { name: null };
      ctx.state.voice.name = ev.target.value || null;
      ctx.save();
      Whisper().speak('Like this.', ctx.state.voice.name);
    }
    if (ev.target.id === 'backup-private') {
      ctx.state.account.backupPrivateGoals = ev.target.checked;
      ctx.save();
      toast(ev.target.checked
        ? '🌙 Private goals will ride along in your backups.'
        : '🌙 Private goals stay on this device only.');
    }
    if (ev.target.id === 'reminder-select') {
      const val = ev.target.value === '' ? null : Number(ev.target.value);
      ctx.state.reminderHour = val;
      ctx.save();
      // Convert her local hour to a UTC hour bucket (handles half-hour zones).
      const utcHour = val == null ? null
        : new Date(new Date().setHours(val, 0, 0, 0)).getUTCHours();
      if (flows() && flows().setReminder) flows().setReminder(utcHour);
      toast(val == null
        ? 'Reminder off — the garden waits quietly 🌿'
        : `🌅 Garden time set for ${val}:00 — a gentle nudge if you haven’t visited.`);
    }
    if (ev.target.id === 'quiet-toggle') {
      ctx.state.quiet = ev.target.checked;
      ctx.save();
      if (flows()) flows().setQuiet(ev.target.checked);
      toast(ev.target.checked
        ? '🤫 Quiet mode on — the keeper will not write.'
        : '🌿 The keeper may leave you a note again.');
    }
  }

  // ---------- public API ----------
  GroveUI.init = function (context) {
    ctx = context;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    Whisper().warmVoices(); // Chrome loads voices async — poke early
    applyAccent();
  };
  GroveUI.renderAll = renderAll;
  GroveUI.switchView = switchView;
  GroveUI.toast = toast;
  GroveUI.applyFlags = function (flags) {
    let bar = document.getElementById('flag-banner');
    if (flags && flags.banner) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'flag-banner';
        bar.className = 'flag-banner';
        document.body.insertBefore(bar, document.body.firstChild);
      }
      bar.textContent = flags.banner;
    } else if (bar) {
      bar.remove();
    }
    if (ctx) renderAll();
  };
  GroveUI.startOnboarding = function () { startWizard(true); };
  GroveUI.openJoinModal = openJoinModal;
  GroveUI.setPendingJoin = function (code) { pendingJoin = code; };
  GroveUI.comebackLine = function () {
    const lines = D.COMEBACK_LINES;
    return lines[Math.floor(Math.random() * lines.length)];
  };
})();

if (typeof window !== 'undefined') window.GroveUI = GroveUI;
