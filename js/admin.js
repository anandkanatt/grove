'use strict';
// GroveAdmin — the Grove Keeper's dashboard (#admin) on platform hosts.
// Four rooms: Overview (aggregates), Studio (campaign workflows), Ops
// (browse/moderate/intervene), Audit (every admin action, forever visible).
// Aggregates and pseudonyms only — no goal text, no boost text, no emails.
const GroveAdmin = {};

(function () {
  let client = null;
  let tab = 'overview';
  let campaigns = [];
  let channels = null;
  let editing = null;   // campaign being edited (null = closed, {} = new)

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (msg) => window.GroveUI && window.GroveUI.toast(msg);
  const when = (ts) => ts ? new Date(ts).toLocaleString() : '—';

  function shell(inner) {
    const tabs = document.querySelector('.tabs');
    if (tabs) tabs.classList.add('hidden');
    const hud = $('#hud');
    if (hud) hud.innerHTML = '<span class="chip">🗝️ <strong>Grove Keeper</strong></span>';
    $('#app').innerHTML = `<section class="view">${inner}</section>`;
  }

  function nav() {
    const T = [['overview', 'Overview'], ['studio', 'Studio'], ['ops', 'Ops'], ['evals', 'Evals'], ['audit', 'Audit']];
    return `<div class="domain-tabs" style="margin-bottom:4px">${T.map(([id, label]) =>
      `<button class="domain-tab ${tab === id ? 'active' : ''}" data-action="admin-tab" data-tab="${id}">${label}</button>`
    ).join('')}</div>`;
  }

  function gate() {
    shell(`
      <div class="card" style="text-align:center;padding:34px 20px">
        <div style="font-size:2rem">🗝️</div>
        <h2>The Grove Keeper’s Gate</h2>
        <p class="sub" style="margin:10px auto 18px;max-width:420px">
          This dashboard shows aggregated garden health only — no personal
          content lives here. Keepers sign in to enter.</p>
        <button class="btn accent" data-action="admin-signin">Sign in</button>
      </div>`);
  }

  function locked() {
    shell(`
      <div class="card" style="text-align:center;padding:34px 20px">
        <div style="font-size:2rem">🌳</div>
        <h2>This gate is locked</h2>
        <p class="sub" style="margin-top:10px">Your account is signed in, but it does not
          hold the keeper’s key.</p>
      </div>`);
  }

  function guard(r) {
    if (r.ok) return false;
    const err = String(r.error || '');
    if (err.indexOf('403') !== -1 || err === 'unauthorized') locked();
    else shell(nav() + '<div class="empty-note">Could not reach the grove — try again.</div>');
    return true;
  }

  // ---------- overview (unchanged panels) ----------
  function eventsChart(days) {
    const W = 560, H = 110, bw = Math.floor(W / days.length) - 6;
    const totals = days.map(d => d.step + d.bloom + d.cheer + d.struggle + d.recover);
    const max = Math.max(1, ...totals);
    let bars = '';
    days.forEach((d, i) => {
      const total = totals[i];
      const x = i * (bw + 6) + 3;
      const h = Math.round((total / max) * (H - 26));
      const stepH = total ? Math.round((d.step / total) * h) : 0;
      bars += `
        <rect x="${x}" y="${H - 14 - h}" width="${bw}" height="${Math.max(1, h - stepH)}" rx="3" fill="#e8dfd0"/>
        <rect x="${x}" y="${H - 14 - stepH}" width="${bw}" height="${stepH}" rx="3" fill="#7ba05b"/>
        <text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="8" fill="#7d8a78">${d.day.slice(8)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}</svg>`;
  }

  function sentimentChart(rows) {
    if (!rows.length) return '<div class="empty-note">No sentiment samples yet — the keeper’s round runs nightly.</div>';
    const W = 560, H = 90, bw = Math.floor(W / Math.max(rows.length, 7)) - 6;
    let bars = '';
    rows.forEach((r, i) => {
      const total = Math.max(1, r.upbeat + r.steady + r.strained);
      const x = i * (bw + 6) + 3;
      const hAll = H - 24;
      const hUp = Math.round((r.upbeat / total) * hAll);
      const hSt = Math.round((r.steady / total) * hAll);
      const hSr = hAll - hUp - hSt;
      bars += `
        <rect x="${x}" y="${8}" width="${bw}" height="${hSr}" fill="#c66b8e" rx="2"/>
        <rect x="${x}" y="${8 + hSr}" width="${bw}" height="${hSt}" fill="#d9a441"/>
        <rect x="${x}" y="${8 + hSr + hSt}" width="${bw}" height="${hUp}" fill="#7ba05b" rx="2"/>
        <text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="8" fill="#7d8a78">${String(r.day).slice(8)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}</svg>
      <div class="sub" style="font-size:0.75rem">🟢 upbeat · 🟡 steady · 🌺 strained</div>`;
  }

  function interventionRow(kind, item) {
    const detail = kind === 'stalled'
      ? `${item.daysQuiet} quiet day${item.daysQuiet === 1 ? '' : 's'}${item.quiet ? ' · 🤫 quiet mode' : ''}`
      : `struggling, unsupported for ${item.hoursAgo}h`;
    return `
      <div class="admin-row">
        <span class="admin-who">🌸 <b>${esc(item.name)}</b> <span class="sub">in ${esc(item.circleName)} · ${esc(detail)}</span></span>
        ${item.quiet ? '' : `<button class="btn small secondary" data-action="admin-nudge"
          data-member="${esc(item.memberId)}" data-name="${esc(item.name)}" data-kind="${kind}">Send note 🌿</button>`}
      </div>`;
  }

  async function renderOverview() {
    shell(nav() + '<div class="empty-note">Reading the rings… 🌳</div>');
    const [ov, iv] = await Promise.all([client.admin.overview(), client.admin.interventions()]);
    if (guard(ov) || guard(iv)) return;
    const o = ov.data, i = iv.data;
    const domains = Object.keys(o.goals.domains).map(d => {
      const v = o.goals.domains[d];
      return `<div class="stat-block"><b>${v.steps}</b><span>${esc(d)} steps · ${v.blooms} bloom${v.blooms === 1 ? '' : 's'}</span></div>`;
    }).join('') || '<div class="empty-note">No goal activity yet.</div>';
    shell(`${nav()}
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Health</h2>
          <button class="btn small secondary" data-action="admin-refresh">↻</button></div>
        <div class="challenge-stats">
          <div class="stat-block"><b>${o.health.circles}</b><span>circles</span></div>
          <div class="stat-block"><b>${o.health.members}</b><span>members</span></div>
          <div class="stat-block"><b>${o.health.activeMembers7d}</b><span>active · 7d</span></div>
          <div class="stat-block"><b>${o.health.newMembers7d}</b><span>new · 7d</span></div>
          <div class="stat-block"><b>${o.whisperer.callsToday}</b><span>AI calls today</span></div>
          <div class="stat-block"><b>${o.nudges7d.manual + o.nudges7d.workflow}</b><span>notes sent · 7d</span></div>
        </div>
        <div style="margin-top:14px">${eventsChart(o.health.eventsByDay)}</div>
        <div class="sub" style="font-size:0.75rem">🟩 steps · ⬜ other activity, last 14 days</div>
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">Goals by life area</h2>
        <div class="challenge-stats" style="margin-top:8px">${domains}</div>
        <p class="sub" style="margin-top:8px">Median time from a struggle to first support:
          <b>${o.community.medianSupportHours == null ? '—' : o.community.medianSupportHours + 'h'}</b></p>
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">Sentiment (nightly, labels only)</h2>
        <div style="margin-top:10px">${sentimentChart(o.sentiment)}</div>
      </div>
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Where to step in</h2>
          <span class="sub">${i.stalled.length + i.struggles.length} to look at</span></div>
        ${i.struggles.length ? `<h3 class="admin-h3">🌧️ Unsupported struggles (48h+)</h3>`
          + i.struggles.map(x => interventionRow('struggle', x)).join('') : ''}
        ${i.stalled.length ? `<h3 class="admin-h3">🍂 Quiet gardens (7d+)</h3>`
          + i.stalled.map(x => interventionRow('stalled', x)).join('') : ''}
        ${!i.stalled.length && !i.struggles.length
          ? '<div class="empty-note">Every garden is humming. Nothing needs you today 🌤️</div>' : ''}
        ${i.aiCapped.length ? `<h3 class="admin-h3">✨ Whisperer at capacity</h3>`
          + i.aiCapped.map(x => `<div class="admin-row"><span class="admin-who">${esc(x.circleName)} — ${x.count} calls today</span></div>`).join('') : ''}
      </div>`);
  }

  // ---------- studio (campaign workflows) ----------
  const TRIGGER_LABELS = {
    'stalled': 'Quiet for N days', 'new-member': 'Joined in last N days',
    'first-bloom': 'First bloom in last N days', 'struggle-unsupported': 'Struggle unsupported N days',
    'everyone': 'Everyone (respects quiet mode)',
  };

  function campaignForm(c) {
    const isNew = !c.id;
    const triggers = Object.keys(TRIGGER_LABELS).map(t =>
      `<option value="${t}" ${c.trigger === t ? 'selected' : ''}>${TRIGGER_LABELS[t]}</option>`).join('');
    const ch = c.channels || ['note'];
    const chBox = (id, label, ready) => `
      <label class="privacy-row" ${ready ? '' : 'style="opacity:0.5"'}>
        <input type="checkbox" class="camp-channel" value="${id}" ${ch.indexOf(id) !== -1 ? 'checked' : ''} ${ready ? '' : 'disabled'}>
        ${label}</label>`;
    return `
      <div class="card" id="campaign-form">
        <h2 style="font-size:1.05rem">${isNew ? 'New workflow' : 'Edit workflow'}</h2>
        <label class="sub" style="font-weight:600">Name</label>
        <input class="text-input" id="camp-name" maxlength="40" value="${esc(c.name || '')}" style="margin:4px 0 10px">
        <label class="sub" style="font-weight:600">Who should get it (trigger)</label>
        <select class="text-input" id="camp-trigger" style="margin:4px 0 10px">${triggers}</select>
        <div class="settings-row">
          <label class="sub">N days: <input class="text-input" id="camp-days" type="number" min="0" max="90"
            value="${c.days != null ? c.days : 7}" style="width:80px;padding:6px 10px"></label>
          <label class="sub">Cooldown days: <input class="text-input" id="camp-cooldown" type="number" min="1" max="90"
            value="${c.cooldownDays != null ? c.cooldownDays : 7}" style="width:80px;padding:6px 10px"></label>
        </div>
        <label class="sub" style="font-weight:600">Message ({name} and {friend} fill in automatically)</label>
        <textarea class="text-input" id="camp-template" rows="2" maxlength="240"
          style="margin:4px 0 10px;resize:vertical">${esc(c.template || '')}</textarea>
        <div class="sub" style="font-weight:600;margin-bottom:4px">Channels</div>
        ${chBox('note', '🌿 In-app keeper note', true)}
        ${chBox('push', `🔔 Push notification — ${esc((channels && channels.push) || 'claimed accounts')}`, true)}
        ${chBox('email', `✉️ Email — ${esc((channels && channels.email) || 'needs provider key')}`, false)}
        ${chBox('whatsapp', `💬 WhatsApp — ${esc((channels && channels.whatsapp) || 'needs provider key')}`, false)}
        <label class="privacy-row"><input type="checkbox" id="camp-active" ${c.active !== false ? 'checked' : ''}> active</label>
        <div class="modal-actions">
          <button class="btn secondary" data-action="studio-cancel">Cancel</button>
          <button class="btn accent" data-action="studio-save" ${c.id ? `data-id="${esc(c.id)}"` : ''}>Save workflow</button>
        </div>
      </div>`;
  }

  async function renderStudio() {
    shell(nav() + '<div class="empty-note">Opening the studio… 🌿</div>');
    const [cr, chr] = await Promise.all([client.admin.campaigns(), client.admin.channels()]);
    if (guard(cr)) return;
    campaigns = cr.campaigns || [];
    channels = chr.ok ? chr.channels : null;
    const rows = campaigns.map(c => `
      <div class="admin-row">
        <span class="admin-who">${c.active ? '🟢' : '⏸️'} <b>${esc(c.name)}</b>
          <span class="sub">${esc(TRIGGER_LABELS[c.trigger] || c.trigger)} · ${(c.channels || []).join(' + ')}
          · sent ${c.sentCount || 0} · last run ${when(c.lastRunAt)}</span></span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small secondary" data-action="studio-run" data-id="${esc(c.id)}">▶ Run now</button>
          <button class="btn small secondary" data-action="studio-edit" data-id="${esc(c.id)}">Edit</button>
          <button class="btn small secondary" data-action="studio-toggle" data-id="${esc(c.id)}">${c.active ? 'Pause' : 'Activate'}</button>
          <button class="btn small" style="background:var(--danger)" data-action="studio-delete" data-id="${esc(c.id)}">Delete</button>
        </span>
      </div>`).join('');
    shell(`${nav()}
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Workflows</h2>
          <button class="btn small accent" data-action="studio-new">+ New workflow</button></div>
        ${rows || '<div class="empty-note">No workflows yet — the nightly round seeds two defaults.</div>'}
      </div>
      ${editing ? campaignForm(editing) : ''}
      <div class="card">
        <h2 style="font-size:1.05rem">Channel status</h2>
        <p class="sub" style="margin-top:6px">
          🌿 In-app note: <b>${esc((channels && channels.note) || 'ready')}</b><br>
          🔔 Push: <b>${esc((channels && channels.push) || '—')}</b><br>
          ✉️ Email: <b>${esc((channels && channels.email) || 'needs provider key')}</b><br>
          💬 WhatsApp: <b>${esc((channels && channels.whatsapp) || 'needs provider key')}</b></p>
        <p class="sub">Email and WhatsApp also need players to share contact details —
          Grove keeps everyone anonymous by default, so those channels stay dormant
          until both a provider key and an opt-in flow exist.</p>
      </div>`);
  }

  function collectCampaign(id) {
    const chs = [...document.querySelectorAll('.camp-channel:checked')].map(x => x.value);
    return {
      id: id || undefined,
      name: $('#camp-name').value.trim(),
      trigger: $('#camp-trigger').value,
      days: Number($('#camp-days').value) || 0,
      cooldownDays: Number($('#camp-cooldown').value) || 7,
      template: $('#camp-template').value.trim(),
      channels: chs.length ? chs : ['note'],
      active: $('#camp-active').checked,
    };
  }

  // ---------- ops ----------
  async function renderOps(detailId) {
    shell(nav() + '<div class="empty-note">Walking the rows… 🌿</div>');
    if (detailId) return renderCircleDetail(detailId);
    const [cr, fr] = await Promise.all([client.admin.circles(), client.admin.flags()]);
    if (guard(cr)) return;
    const flags = fr.ok ? fr.flags : { whisperer: true, newCircles: true, banner: '' };
    const rows = (cr.circles || []).map(c => `
      <div class="admin-row">
        <span class="admin-who">💛 <b>${esc(c.name)}</b>
          <span class="sub">${c.members} member${c.members === 1 ? '' : 's'}
          ${c.mentor ? `· 🧭 ${esc(c.mentor)}` : ''} · AI today ${c.aiToday}${c.aiCapOverride ? `/${c.aiCapOverride}` : ''}
          · last activity ${when(c.lastEventAt)}</span></span>
        <button class="btn small secondary" data-action="ops-detail" data-id="${esc(c.id)}">Open</button>
      </div>`).join('');
    shell(`${nav()}
      <div class="card">
        <h2 style="font-size:1.05rem">Switches</h2>
        <label class="privacy-row"><input type="checkbox" id="flag-whisperer" ${flags.whisperer ? 'checked' : ''}>
          ✨ Whisperer (all AI features)</label>
        <label class="privacy-row"><input type="checkbox" id="flag-circles" ${flags.newCircles ? 'checked' : ''}>
          💛 New circles can be created</label>
        <label class="sub" style="font-weight:600;display:block;margin-top:8px">Maintenance banner (empty = hidden)</label>
        <input class="text-input" id="flag-banner" maxlength="160" value="${esc(flags.banner || '')}" style="margin:4px 0 10px">
        <button class="btn small accent" data-action="ops-save-flags">Save switches</button>
      </div>
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Circles</h2>
          <button class="btn small secondary" data-action="admin-refresh">↻</button></div>
        ${rows || '<div class="empty-note">No circles yet.</div>'}
      </div>`);
  }

  async function renderCircleDetail(id) {
    const r = await client.admin.circleDetail(id);
    if (guard(r)) return;
    const d = r.data;
    const members = d.members.map(m => `
      <div class="admin-row">
        <span class="admin-who">🌸 <b>${esc(m.name)}</b>
          <span class="sub">${m.claimed ? 'claimed ✨' : 'anonymous'}${m.quiet ? ' · 🤫 quiet' : ''}
          · last seen ${when(m.lastSeen)}</span></span>
        <span style="display:flex;gap:6px">
          <button class="btn small secondary" data-action="admin-nudge" data-member="${esc(m.id)}" data-name="${esc(m.name)}">Send note 🌿</button>
          <button class="btn small" style="background:var(--danger)" data-action="ops-remove-member" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>
        </span>
      </div>`).join('');
    shell(`${nav()}
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">💛 ${esc(d.circle.name)}</h2>
          <button class="btn small secondary" data-action="admin-tabops">← All circles</button></div>
        <p class="sub" style="margin-top:4px">created ${when(d.circle.createdAt)} ·
          ${d.counts.events} events · ${d.counts.messages} chat messages
          ${d.circle.mentor ? `· mentor 🧭 ${esc(d.circle.mentor.name)}` : ''}
          ${d.circle.inviteCode ? `· invite <b>${esc(d.circle.inviteCode)}</b>` : ''}</p>
        <div class="settings-row" style="margin-top:8px">
          <button class="btn small secondary" data-action="ops-regen" data-id="${esc(id)}">♻ New invite code</button>
          <button class="btn small secondary" data-action="ops-ai-reset" data-id="${esc(id)}">✨ Reset AI budget today</button>
          <label class="sub">AI cap: <input class="text-input" id="ops-cap" type="number" min="0" max="500"
            value="${d.circle.aiCapOverride || ''}" placeholder="40" style="width:80px;padding:6px 10px"></label>
          <button class="btn small secondary" data-action="ops-ai-cap" data-id="${esc(id)}">Set cap</button>
          <button class="btn small" style="background:var(--danger)" data-action="ops-purge" data-id="${esc(id)}" data-name="${esc(d.circle.name)}">Purge circle</button>
        </div>
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">Members</h2>
        ${members || '<div class="empty-note">Empty circle.</div>'}
      </div>
      <div class="card">
        <h2 style="font-size:1.05rem">Moderation</h2>
        <p class="sub" style="margin-top:4px">Remove a reported message or feed event by its id
          (ids arrive with reports; content is never browsed here).</p>
        <div class="settings-row">
          <input class="text-input" id="mod-id" placeholder="message or event id" style="max-width:280px">
          <button class="btn small secondary" data-action="ops-del-message">Delete message</button>
          <button class="btn small secondary" data-action="ops-del-event">Delete event</button>
        </div>
      </div>`);
  }

  // ---------- model evals ----------
  let evalRunning = false;

  function runsChart(runs) {
    if (!runs.length) return '';
    const W = 560, H = 70, bw = Math.floor(W / Math.max(runs.length, 8)) - 6;
    const ordered = runs.slice().reverse();
    let bars = '';
    ordered.forEach((r, i) => {
      const rate = r.summary && r.summary.total ? r.summary.passed / r.summary.total : 0;
      const x = i * (bw + 6) + 3;
      const h = Math.max(3, Math.round(rate * (H - 22)));
      bars += `
        <rect x="${x}" y="${H - 14 - h}" width="${bw}" height="${h}" rx="3"
          fill="${rate >= 0.9 ? '#7ba05b' : rate >= 0.7 ? '#d9a441' : '#c66b8e'}"/>
        <text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="8" fill="#7d8a78">${Math.round(rate * 100)}%</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}</svg>`;
  }

  function evalCaseRow(c) {
    const judge = c.judge || {};
    const badge = c.pass ? '🟢' : '🔴';
    return `
      <div class="admin-row" style="align-items:flex-start">
        <span class="admin-who">${badge} <b>${esc(c.id)}</b>
          <span class="sub">warmth ${judge.warmth ?? '—'}/5 · concrete ${judge.concreteness ?? '—'}/5
          · ${judge.safe ? 'safe' : '⚠ safety'}${judge.reason ? ' · ' + esc(judge.reason) : ''}
          ${(c.notes || []).length ? '<br>checks: ' + esc((c.notes || []).join('; ')) : ''}
          ${!c.pass && c.output ? `<br><span style="font-family:var(--font-mono, monospace);font-size:0.72rem">${esc(String(c.output).slice(0, 260))}</span>` : ''}</span></span>
      </div>`;
  }

  async function renderEvals() {
    shell(nav() + '<div class="empty-note">Fetching the report card… 🧪</div>');
    const r = await client.admin.evalRuns();
    if (guard(r)) return;
    const latest = r.latest;
    const features = latest && latest.summary ? latest.summary.features : {};
    const featBlocks = Object.keys(features).map(f => {
      const v = features[f];
      return `<div class="stat-block"><b>${v.passed}/${v.total}</b>
        <span>${esc(f)} · warmth ${v.warmth} · concrete ${v.concreteness}</span></div>`;
    }).join('');
    shell(`${nav()}
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Whisperer report card 🧪</h2>
          <button class="btn small accent" data-action="evals-run" ${evalRunning ? 'disabled' : ''}>
            ${evalRunning ? 'Running…' : '▶ Run the suite'}</button></div>
        <p class="sub" style="margin-top:4px">10 synthetic cases across steps, ideas, mentor, cheer, and
          assess — shape checks plus a judge scoring warmth, concreteness, and safety.
          About 20 AI calls per run. Real member content is never sampled.</p>
        <div id="eval-progress"></div>
        ${r.runs && r.runs.length ? `<div style="margin-top:10px">${runsChart(r.runs)}</div>
          <div class="sub" style="font-size:0.75rem">pass rate per run, oldest → newest</div>` : ''}
      </div>
      ${latest ? `
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Latest run</h2>
          <span class="sub">${when(latest.at)} · ${latest.summary.passed}/${latest.summary.total} passed</span></div>
        <div class="challenge-stats" style="margin-top:8px">${featBlocks}</div>
        <h3 class="admin-h3">Cases</h3>
        ${(latest.cases || []).map(evalCaseRow).join('')}
      </div>` : '<div class="card"><div class="empty-note">No runs yet — press ▶ to grade the whisperer.</div></div>'}`);
  }

  async function runEvalSuite() {
    if (evalRunning) return;
    evalRunning = true;
    const cr = await client.admin.evalCases();
    if (guard(cr)) { evalRunning = false; return; }
    const cases = cr.cases || [];
    const results = [];
    for (let i = 0; i < cases.length; i++) {
      const prog = $('#eval-progress');
      if (prog) prog.innerHTML = `<div class="progress-track" style="margin-top:10px">
        <i style="width:${Math.round((i / cases.length) * 100)}%"></i></div>
        <div class="sub" style="margin-top:4px">grading ${esc(cases[i].id)} (${i + 1}/${cases.length})…</div>`;
      const rr = await client.admin.runEvalCase(cases[i].id);
      if (rr.ok) results.push(rr.result);
      else results.push({ id: cases[i].id, feature: cases[i].feature, pass: false,
        prog: { pass: false, notes: ['route error: ' + rr.error] },
        judge: { warmth: 0, concreteness: 0, safe: false, reason: 'route error' } });
    }
    const saved = await client.admin.saveEvalRun(results);
    evalRunning = false;
    toast(saved.ok
      ? `Report card saved — ${saved.run.summary.passed}/${saved.run.summary.total} passed 🧪`
      : 'Could not save the run.');
    renderEvals();
  }

  // ---------- audit ----------
  async function renderAudit() {
    shell(nav() + '<div class="empty-note">Reading the ledger… 📜</div>');
    const r = await client.admin.auditLog();
    if (guard(r)) return;
    const rows = (r.audit || []).map(a => `
      <div class="admin-row"><span class="admin-who">
        <b>${esc(a.action)}</b> <span class="sub">${esc(a.target || '')}
        ${a.detail ? '· ' + esc(a.detail) : ''} · ${esc(a.email)} · ${when(a.at)}</span></span></div>`).join('');
    shell(`${nav()}
      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Every keeper action 📜</h2>
          <button class="btn small secondary" data-action="admin-refresh">↻</button></div>
        ${rows || '<div class="empty-note">No admin actions recorded yet.</div>'}
      </div>`);
  }

  function load() {
    if (tab === 'overview') renderOverview();
    else if (tab === 'studio') renderStudio();
    else if (tab === 'ops') renderOps();
    else if (tab === 'evals') renderEvals();
    else renderAudit();
  }

  // ---------- note composer (shared) ----------
  function openComposer(memberId, name, kind) {
    const suggestion = kind === 'struggle'
      ? `Saw that things are heavy this week, ${name}. The grove is holding your place — one kind breath at a time. 🌿`
      : `The grove kept your place, ${name}. One tiny step is all a garden ever asks. 🌿`;
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal">
        <h2>A note to ${esc(name)} 🌿</h2>
        <p class="sub">Delivered quietly on her next visit. Warm, short, never guilt.</p>
        <textarea id="admin-note" class="text-input" rows="3" maxlength="240"
          style="margin:10px 0;resize:vertical">${esc(suggestion)}</textarea>
        <div class="modal-actions">
          <button class="btn secondary" data-action="admin-composer-close">Cancel</button>
          <button class="btn accent" data-action="admin-send" data-member="${esc(memberId)}">Send note</button>
        </div>
      </div>`;
    root.classList.remove('hidden');
  }
  function closeComposer() {
    const root = $('#modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'admin-signin') {
      client.auth.signIn().then(load).catch((e) => {
        toast(e && e.code === 'popup_blocked'
          ? 'Your browser blocked the sign-in window — allow popups.'
          : 'Sign-in was cancelled.');
      });
    } else if (a === 'admin-tab') { tab = btn.dataset.tab; editing = null; load(); }
    else if (a === 'admin-tabops') { tab = 'ops'; load(); }
    else if (a === 'admin-refresh') load();
    else if (a === 'admin-nudge') openComposer(btn.dataset.member, btn.dataset.name, btn.dataset.kind);
    else if (a === 'admin-composer-close') closeComposer();
    else if (a === 'admin-send') {
      const text = ($('#admin-note') && $('#admin-note').value.trim()) || '';
      if (!text) return;
      const r = await client.admin.nudge(btn.dataset.member, text);
      closeComposer();
      toast(r.ok ? 'Note tucked into her grove 🌿' : 'Could not send — try again.');
    }
    else if (a === 'studio-new') { editing = { channels: ['note'], days: 7, cooldownDays: 7, active: true }; renderStudio(); }
    else if (a === 'studio-edit') { editing = campaigns.find(c => c.id === btn.dataset.id) || null; renderStudio(); }
    else if (a === 'studio-cancel') { editing = null; renderStudio(); }
    else if (a === 'studio-save') {
      const c = collectCampaign(btn.dataset.id);
      if (!c.name || !c.template) { toast('Name and message are needed 🌿'); return; }
      const r = await client.admin.saveCampaign(c);
      if (r.ok) { editing = null; toast('Workflow saved 🌿'); renderStudio(); }
      else toast('Could not save — check the fields.');
    }
    else if (a === 'studio-toggle') {
      const c = campaigns.find(x => x.id === btn.dataset.id);
      if (!c) return;
      const r = await client.admin.saveCampaign({ ...c, active: !c.active });
      toast(r.ok ? (c.active ? 'Paused ⏸️' : 'Activated 🟢') : 'Could not update.');
      renderStudio();
    }
    else if (a === 'studio-delete') {
      if (!window.confirm('Delete this workflow? Its send log stays in the ledger.')) return;
      await client.admin.deleteCampaign(btn.dataset.id);
      renderStudio();
    }
    else if (a === 'studio-run') {
      toast('Running the workflow…');
      const r = await client.admin.runCampaign(btn.dataset.id);
      toast(r.ok ? `Matched ${r.data.matched}, sent ${r.data.sent}${r.data.pushSkipped ? `, ${r.data.pushSkipped} push skipped (no account)` : ''}` : 'Run failed.');
      renderStudio();
    }
    else if (a === 'evals-run') runEvalSuite();
    else if (a === 'ops-detail') renderOps(btn.dataset.id);
    else if (a === 'ops-save-flags') {
      const r = await client.admin.saveFlags({
        whisperer: $('#flag-whisperer').checked,
        newCircles: $('#flag-circles').checked,
        banner: $('#flag-banner').value.trim(),
      });
      toast(r.ok ? 'Switches saved 🌿' : 'Could not save switches.');
    }
    else if (a === 'ops-regen') {
      const r = await client.admin.regenInvite(btn.dataset.id);
      toast(r.ok ? `New invite: ${r.data.inviteCode}` : 'Could not regenerate.');
      renderOps(btn.dataset.id);
    }
    else if (a === 'ops-ai-reset') {
      await client.admin.circleAi(btn.dataset.id, { resetToday: true });
      toast('AI budget reset for today ✨');
      renderOps(btn.dataset.id);
    }
    else if (a === 'ops-ai-cap') {
      const cap = Number(($('#ops-cap') && $('#ops-cap').value) || 0);
      await client.admin.circleAi(btn.dataset.id, { capOverride: cap > 0 ? cap : null });
      toast(cap > 0 ? `AI cap set to ${cap} ✨` : 'AI cap back to default ✨');
      renderOps(btn.dataset.id);
    }
    else if (a === 'ops-remove-member') {
      if (!window.confirm(`Remove ${btn.dataset.name} from this circle? Her local garden is untouched.`)) return;
      await client.admin.removeMember(btn.dataset.id);
      toast('Member removed.');
      renderOps();
    }
    else if (a === 'ops-purge') {
      if (!window.confirm(`Purge "${btn.dataset.name}" completely? Members, events, chat, and voice notes are deleted. This cannot be undone.`)) return;
      await client.admin.purgeCircle(btn.dataset.id);
      toast('Circle purged.');
      renderOps();
    }
    else if (a === 'ops-del-message') {
      const id = ($('#mod-id') && $('#mod-id').value.trim()) || '';
      if (!id) return;
      const r = await client.admin.deleteMessage(id);
      toast(r.ok ? 'Message deleted.' : 'Not found.');
    }
    else if (a === 'ops-del-event') {
      const id = ($('#mod-id') && $('#mod-id').value.trim()) || '';
      if (!id) return;
      const r = await client.admin.deleteEvent(id);
      toast(r.ok ? 'Event deleted.' : 'Not found.');
    }
  }

  GroveAdmin.boot = function (c) {
    client = c;
    document.title = 'Grove — the keeper’s dashboard';
    document.addEventListener('click', onClick);
    if (!client || !client.auth) {
      shell(`<div class="card" style="text-align:center;padding:30px">
        <h2>🗝️ The keeper’s dashboard</h2>
        <p class="sub" style="margin-top:8px">It lives on the platform version of Grove.</p></div>`);
      return;
    }
    if (client.auth.isSignedIn()) load();
    else gate();
  };
})();

if (typeof window !== 'undefined') window.GroveAdmin = GroveAdmin;
