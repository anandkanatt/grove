'use strict';
// GroveNetAppDeploy — circle client over the App Deploy platform bridge
// (window.GrovePlatform = { api, invitesClient }, set by src/main.ts on
// platform hosts). Implements the same surface as GroveNet so sync.js and
// the UI stay backend-agnostic. Every method resolves {ok:true, ...} or
// {ok:false, error, offline?} — it never throws.
const GroveNetAppDeploy = {};

GroveNetAppDeploy.makeClient = function (cfg) {
  const platform = cfg.platform;
  const onSession = cfg.onSession || function () {};
  const circleRef = cfg.circleRef || function () { return null; };
  let session = cfg.session || null;

  function setSession(s) { session = s; onSession(s); }
  const memberKey = () => (session ? session.memberKey : null);

  function fail(e) {
    const status = e && (e.statusCode || (e.response && e.response.status));
    if (status === 429) return { ok: false, error: 'ai-rest' };
    if (status === 401) return { ok: false, error: 'unauthorized' };
    if (status === 400 || status === 404) {
      const msg = (e && e.message) || '';
      if (msg.indexOf('not-found') !== -1) return { ok: false, error: 'not-found' };
      if (/\bfull\b/.test(msg)) return { ok: false, error: 'full' };
      return { ok: false, error: 'http-' + status };
    }
    if (status) return { ok: false, error: 'http-' + status };
    return { ok: false, error: 'offline', offline: true };
  }

  async function post(url, body) {
    try {
      const r = await platform.api.post(url, body);
      return { ok: true, data: (r && r.data) || {} };
    } catch (e) { return fail(e); }
  }
  async function get(url) {
    try {
      const r = await platform.api.get(url);
      return { ok: true, data: (r && r.data) || {} };
    } catch (e) { return fail(e); }
  }
  async function put(url, body) {
    try {
      const r = await platform.api.put(url, body);
      return { ok: true, data: (r && r.data) || {} };
    } catch (e) { return fail(e); }
  }
  async function del(url) {
    try {
      const r = await platform.api.delete(url);
      return { ok: true, data: (r && r.data) || {} };
    } catch (e) { return fail(e); }
  }

  const camelCircle = (d) => ({ id: d.circleId, name: d.circleName, inviteCode: d.inviteCode });

  function identityQuery() {
    const ref = circleRef();
    return 'memberId=' + encodeURIComponent(ref ? ref.memberId : '')
      + '&memberKey=' + encodeURIComponent(memberKey() || '');
  }

  async function aiPost(url, payload) {
    const ref = circleRef();
    if (!ref || !memberKey()) return { ok: false, error: 'no-circle' };
    const r = await post(url, Object.assign({
      memberId: ref.memberId, memberKey: memberKey(), circleId: ref.id,
    }, payload));
    if (!r.ok) return r;
    return Object.assign({ ok: true }, r.data);
  }

  return {
    kind: 'appdeploy',
    getSession: () => session,

    // Identity is the memberKey minted at create/join — nothing to sign in.
    async signInAnon() { return { ok: true, session }; },

    async createCircle(p) {
      const r = await post('/api/circles', {
        name: p.circleName,
        member: { name: p.memberName, avatarId: p.avatarId, accentId: p.accentId },
      });
      if (!r.ok) return r;
      setSession({ platform: 'appdeploy', memberKey: r.data.memberKey });
      return { ok: true, circle: camelCircle(r.data),
        memberId: r.data.memberId, memberKey: r.data.memberKey };
    },

    async joinCircle(p) {
      const r = await post('/api/circles/join', {
        code: String(p.code || '').trim().toUpperCase(),
        member: { name: p.memberName, avatarId: p.avatarId, accentId: p.accentId },
      });
      if (!r.ok) return r;
      setSession({ platform: 'appdeploy', memberKey: r.data.memberKey });
      return { ok: true, circle: camelCircle(r.data),
        memberId: r.data.memberId, memberKey: r.data.memberKey,
        members: r.data.members || [] };
    },

    async fetchMembers(circleId) {
      const r = await get('/api/circles/' + circleId + '/members?' + identityQuery());
      if (!r.ok) return r;
      return { ok: true, members: r.data.members || [] };
    },

    async pushEvents(circleId, memberId, events) {
      if (!events.length) return { ok: true, pushed: 0 };
      const r = await post('/api/circles/' + circleId + '/events', {
        memberId, memberKey: memberKey(),
        events: events.map(e => ({ clientKey: e.client_key, type: e.type, payload: e.payload })),
      });
      if (!r.ok) return r;
      return { ok: true, pushed: r.data.pushed != null ? r.data.pushed : events.length };
    },

    async pullEvents(circleId, cursor) {
      const r = await get('/api/circles/' + circleId + '/events?since=' + cursor
        + '&' + identityQuery());
      if (!r.ok) return r;
      const rows = r.data.events || [];
      // Normalize to the Phase 2 wire shape social.applyRemote expects.
      const events = rows.map(e => ({
        id: e.id, member_id: e.memberId, type: e.type,
        payload: e.payload, created_at: e.createdAt,
      }));
      const cursorOut = rows.length ? rows[rows.length - 1].createdAt : cursor;
      return { ok: true, events, cursor: cursorOut };
    },

    async leaveCircle(circleId, memberId, leaveEvent) {
      if (leaveEvent) await this.pushEvents(circleId, memberId, [leaveEvent]);
      const r = await post('/api/circles/' + circleId + '/leave',
        { memberId, memberKey: memberKey() });
      if (!r.ok) return r;
      return { ok: true };
    },

    buildInviteLink(code) {
      return platform.invitesClient.buildJoinUrl(code, { path: '/' });
    },

    ai: {
      steps: (p) => aiPost('/api/ai/steps', p),
      cheer: (p) => aiPost('/api/ai/cheer', p),
      boostReplies: (p) => aiPost('/api/ai/boost-replies', p),
      insights: (p) => aiPost('/api/ai/insights', p),
      goalIdeas: (p) => aiPost('/api/ai/goal-ideas', p),
      transcribe: (p) => aiPost('/api/ai/transcribe', p),
      assess: (p) => aiPost('/api/ai/assess', p),
    },

    // ---------- phase 5: chat, mentor, flags ----------

    async pullMessages(circleId, since) {
      const r = await get('/api/circles/' + circleId + '/messages?since=' + (since || 0)
        + '&' + identityQuery());
      if (!r.ok) return r;
      return { ok: true, messages: r.data.messages || [], mentor: r.data.mentor || null };
    },

    async sendMessage(circleId, memberId, payload) {
      const r = await post('/api/circles/' + circleId + '/messages',
        Object.assign({ memberId, memberKey: memberKey() }, payload));
      if (!r.ok) return r;
      return { ok: true, message: r.data.message };
    },

    async voiceUrl(circleId, path) {
      const r = await get('/api/circles/' + circleId + '/voice-url?path='
        + encodeURIComponent(path) + '&' + identityQuery());
      if (!r.ok) return r;
      return { ok: true, url: r.data.url };
    },

    async setMentor(circleId, memberId, cfg) {
      const r = await post('/api/circles/' + circleId + '/mentor',
        Object.assign({ memberId, memberKey: memberKey() }, cfg));
      if (!r.ok) return r;
      return { ok: true, mentor: r.data.mentor };
    },

    async mentorChat(circleId, memberId, question, goals) {
      const r = await post('/api/circles/' + circleId + '/mentor-chat',
        { memberId, memberKey: memberKey(), question, goals });
      if (!r.ok) return r;
      return { ok: true, reply: r.data.reply };
    },

    async flags() {
      const r = await get('/api/flags');
      return r.ok ? { ok: true, flags: r.data } : r;
    },

    notifications: platform.notifications || null,

    admin: {
      overview: async () => {
        const r = await get('/api/admin/overview');
        return r.ok ? { ok: true, data: r.data } : r;
      },
      interventions: async () => {
        const r = await get('/api/admin/interventions');
        return r.ok ? { ok: true, data: r.data } : r;
      },
      nudge: async (memberId, text) => post('/api/admin/nudge', { memberId, text }),
      campaigns: async () => {
        const r = await get('/api/admin/campaigns');
        return r.ok ? { ok: true, campaigns: r.data.campaigns } : r;
      },
      saveCampaign: (c) => (c.id
        ? put('/api/admin/campaigns/' + c.id, c)
        : post('/api/admin/campaigns', c)),
      deleteCampaign: (id) => del('/api/admin/campaigns/' + id),
      runCampaign: async (id) => post('/api/admin/campaigns/' + id + '/run', {}),
      campaignLog: async (id) => {
        const r = await get('/api/admin/campaigns/' + id + '/log');
        return r.ok ? { ok: true, log: r.data.log } : r;
      },
      channels: async () => {
        const r = await get('/api/admin/channels');
        return r.ok ? { ok: true, channels: r.data } : r;
      },
      circles: async () => {
        const r = await get('/api/admin/circles');
        return r.ok ? { ok: true, circles: r.data.circles } : r;
      },
      circleDetail: async (id) => {
        const r = await get('/api/admin/circles/' + id);
        return r.ok ? { ok: true, data: r.data } : r;
      },
      regenInvite: async (id) => post('/api/admin/circles/' + id + '/regen-invite', {}),
      removeMember: async (id) => post('/api/admin/members/' + id + '/remove', {}),
      purgeCircle: async (id) => post('/api/admin/circles/' + id + '/purge', {}),
      deleteMessage: (id) => del('/api/admin/messages/' + id),
      deleteEvent: (id) => del('/api/admin/events/' + id),
      circleAi: async (id, p) => post('/api/admin/circles/' + id + '/ai', p),
      flags: async () => {
        const r = await get('/api/admin/flags');
        return r.ok ? { ok: true, flags: r.data } : r;
      },
      saveFlags: async (f) => {
        const r = await put('/api/admin/flags', f);
        return r.ok ? { ok: true, flags: r.data } : r;
      },
      auditLog: async () => {
        const r = await get('/api/admin/audit');
        return r.ok ? { ok: true, audit: r.data.audit } : r;
      },
    },

    // ---------- phase 4: accounts & keeper notes ----------
    // api.* auto-attaches the Bearer token once platform auth has signed in.

    auth: platform.auth || null,

    async linkAccount() {
      const ref = circleRef();
      if (!ref || !memberKey()) return { ok: false, error: 'no-circle' };
      const r = await post('/api/account/link', {
        circleId: ref.id, memberId: ref.memberId, memberKey: memberKey(),
      });
      return r.ok ? { ok: true } : r;
    },

    async backupPush(blob) {
      const r = await post('/api/account/backup', { blob });
      return r.ok ? { ok: true, updatedAt: r.data.updatedAt } : r;
    },

    async backupPull() {
      const r = await get('/api/account/backup');
      return r.ok ? { ok: true, blob: r.data.blob, updatedAt: r.data.updatedAt } : r;
    },

    async setQuiet(quiet) {
      const ref = circleRef();
      if (!ref || !memberKey()) return { ok: false, error: 'no-circle' };
      return post('/api/circles/' + ref.id + '/quiet', {
        memberId: ref.memberId, memberKey: memberKey(), quiet: !!quiet,
      });
    },

    async setReminder(utcHour) {
      const ref = circleRef();
      if (!ref || !memberKey()) return { ok: false, error: 'no-circle' };
      return post('/api/circles/' + ref.id + '/reminder', {
        memberId: ref.memberId, memberKey: memberKey(),
        utcHour: utcHour == null ? null : Number(utcHour),
      });
    },

    async pullNudges() {
      const ref = circleRef();
      if (!ref || !memberKey()) return { ok: true, notes: [] };
      const r = await get('/api/circles/' + ref.id + '/nudges?' + identityQuery());
      return r.ok ? { ok: true, notes: r.data.notes || [] } : r;
    },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveNetAppDeploy;
if (typeof window !== 'undefined') window.GroveNetAppDeploy = GroveNetAppDeploy;
