'use strict';
// GroveAdmin — the Grove Keeper's dashboard, served at #admin on platform
// hosts. Shows aggregates and pseudonyms only (first name + flower); no goal
// text, no boost text, no emails ever reach this page.
const GroveAdmin = {};

(function () {
  let client = null;
  let lastInterventions = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (msg) => window.GroveUI && window.GroveUI.toast(msg);

  function shell(inner) {
    const tabs = document.querySelector('.tabs');
    if (tabs) tabs.classList.add('hidden');
    const hud = $('#hud');
    if (hud) hud.innerHTML = '<span class="chip">🗝️ <strong>Grove Keeper</strong></span>';
    $('#app').innerHTML = `<section class="view">${inner}</section>`;
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

  // ---------- charts (inline SVG, garden palette) ----------
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

  function render(ov, iv) {
    lastInterventions = iv;
    const domains = Object.keys(ov.goals.domains).map(d => {
      const v = ov.goals.domains[d];
      return `<div class="stat-block"><b>${v.steps}</b><span>${esc(d)} steps · ${v.blooms} bloom${v.blooms === 1 ? '' : 's'}</span></div>`;
    }).join('') || '<div class="empty-note">No goal activity yet.</div>';

    shell(`
      <div class="section-title"><h2>The Grove Keeper’s Dashboard 🗝️</h2>
        <button class="btn small secondary" data-action="admin-refresh">↻ refresh</button></div>

      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Health</h2>
          <span class="sub">aggregates only — no personal content</span></div>
        <div class="challenge-stats">
          <div class="stat-block"><b>${ov.health.circles}</b><span>circles</span></div>
          <div class="stat-block"><b>${ov.health.members}</b><span>members</span></div>
          <div class="stat-block"><b>${ov.health.activeMembers7d}</b><span>active · 7d</span></div>
          <div class="stat-block"><b>${ov.health.newMembers7d}</b><span>new · 7d</span></div>
          <div class="stat-block"><b>${ov.whisperer.callsToday}</b><span>AI calls today</span></div>
          <div class="stat-block"><b>${ov.nudges7d.manual + ov.nudges7d.workflow}</b><span>notes sent · 7d</span></div>
        </div>
        <div style="margin-top:14px">${eventsChart(ov.health.eventsByDay)}</div>
        <div class="sub" style="font-size:0.75rem">🟩 steps · ⬜ other circle activity, last 14 days</div>
      </div>

      <div class="card">
        <h2 style="font-size:1.05rem">Goals by life area</h2>
        <div class="challenge-stats" style="margin-top:8px">${domains}</div>
        <p class="sub" style="margin-top:8px">Median time from a struggle to first support:
          <b>${ov.community.medianSupportHours == null ? '—' : ov.community.medianSupportHours + 'h'}</b></p>
      </div>

      <div class="card">
        <h2 style="font-size:1.05rem">Sentiment (nightly, labels only)</h2>
        <div style="margin-top:10px">${sentimentChart(ov.sentiment)}</div>
      </div>

      <div class="card">
        <div class="section-title"><h2 style="font-size:1.05rem">Where to step in</h2>
          <span class="sub">${iv.stalled.length + iv.struggles.length} to look at</span></div>
        ${iv.struggles.length ? `<h3 class="admin-h3">🌧️ Unsupported struggles (48h+)</h3>`
          + iv.struggles.map(x => interventionRow('struggle', x)).join('') : ''}
        ${iv.stalled.length ? `<h3 class="admin-h3">🍂 Quiet gardens (7d+)</h3>`
          + iv.stalled.map(x => interventionRow('stalled', x)).join('') : ''}
        ${!iv.stalled.length && !iv.struggles.length
          ? '<div class="empty-note">Every garden is humming. Nothing needs you today 🌤️</div>' : ''}
        ${iv.aiCapped.length ? `<h3 class="admin-h3">✨ Whisperer at capacity</h3>`
          + iv.aiCapped.map(x => `<div class="admin-row"><span class="admin-who">${esc(x.circleName)} — ${x.count} calls today</span></div>`).join('') : ''}
      </div>`);
  }

  async function load() {
    shell('<div class="empty-note">Reading the rings… 🌳</div>');
    const [ov, iv] = await Promise.all([client.admin.overview(), client.admin.interventions()]);
    if (!ov.ok || !iv.ok) {
      const err = (ov.ok ? iv : ov).error || '';
      if (String(err).indexOf('403') !== -1 || err === 'unauthorized') locked();
      else shell('<div class="empty-note">Could not reach the grove — try refresh.</div>');
      return;
    }
    render(ov.data, iv.data);
  }

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

  async function sendNote(memberId) {
    const text = ($('#admin-note') && $('#admin-note').value.trim()) || '';
    if (!text) return;
    const r = await client.admin.nudge(memberId, text);
    closeComposer();
    toast(r.ok ? 'Note tucked into her grove 🌿' : 'Could not send — try again.');
  }

  function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'admin-signin') {
      client.auth.signIn().then(load).catch((e) => {
        toast(e && e.code === 'popup_blocked'
          ? 'Your browser blocked the sign-in window — allow popups.'
          : 'Sign-in was cancelled.');
      });
    } else if (a === 'admin-refresh') load();
    else if (a === 'admin-nudge') openComposer(btn.dataset.member, btn.dataset.name, btn.dataset.kind);
    else if (a === 'admin-composer-close') closeComposer();
    else if (a === 'admin-send') sendNote(btn.dataset.member);
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
