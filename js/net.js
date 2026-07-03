'use strict';
// GroveNet — SDK-free Supabase client over plain fetch. No DOM, no globals
// beyond fetch/AbortSignal. Every method resolves {ok:true, ...} or
// {ok:false, error, offline?} — it never throws.
const GroveNet = {};

GroveNet.makeClient = function (cfg) {
  const url = String(cfg.url || '').replace(/\/+$/, '');
  const anonKey = cfg.anonKey;
  const fetchFn = cfg.fetchFn || ((typeof fetch !== 'undefined') ? fetch : null);
  const timeoutMs = cfg.timeoutMs || 8000;
  const onSession = cfg.onSession || function () {};
  let session = cfg.session || null;

  const toSession = (d) => ({
    access: d.access_token, refresh: d.refresh_token,
    userId: d.user && d.user.id,
  });
  function setSession(s) { session = s; onSession(s); }

  async function call(path, opts) {
    const o = opts || {};
    const headers = { apikey: anonKey, 'Content-Type': 'application/json' };
    if (o.authed && session) headers.Authorization = 'Bearer ' + session.access;
    if (o.prefer) headers.Prefer = o.prefer;
    // Own controller + ref'd timer (AbortSignal.timeout is unref'd in Node,
    // which lets a drained event loop exit before the abort ever fires).
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let resp;
    try {
      resp = await fetchFn(url + path, {
        method: o.method || 'GET',
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, offline: true, data: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await resp.json(); } catch (e) { /* empty bodies (204) are fine */ }
    return { ok: resp.ok, status: resp.status, data };
  }

  // Authed call with one refresh-and-retry on 401.
  async function authedCall(path, opts) {
    let r = await call(path, Object.assign({}, opts, { authed: true }));
    if (r.status === 401 && session && session.refresh) {
      const rr = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh },
      });
      if (rr.ok && rr.data && rr.data.access_token) {
        setSession(toSession(rr.data));
        r = await call(path, Object.assign({}, opts, { authed: true }));
      } else {
        return { ok: false, status: 401, data: null, sessionLost: true };
      }
    }
    return r;
  }

  function fail(r) {
    if (r.offline) return { ok: false, error: 'offline', offline: true };
    if (r.sessionLost) return { ok: false, error: 'session-lost' };
    const msg = r.data && (r.data.message || r.data.error_description || r.data.msg || r.data.error);
    if (msg && msg.indexOf('not-found') !== -1) return { ok: false, error: 'not-found' };
    if (msg && /\bfull\b/.test(msg)) return { ok: false, error: 'full' };
    return { ok: false, error: msg || ('http-' + r.status) };
  }

  const camelMember = (m) => ({
    id: m.id, name: m.name, avatarId: m.avatar_id,
    accentId: m.accent_id, joinedAt: m.joined_at,
  });
  const camelCircle = (c) => ({ id: c.id, name: c.name, inviteCode: c.invite_code });

  return {
    kind: 'supabase',
    ai: null,   // AI surfaces live on the App Deploy backend only

    buildInviteLink(code) {
      if (typeof location !== 'undefined' && location.origin && location.origin !== 'null') {
        return location.origin + location.pathname + '#join=' + code;
      }
      return '#join=' + code;
    },

    getSession: () => session,

    async signInAnon() {
      const r = await call('/auth/v1/signup', { method: 'POST', body: {} });
      if (!r.ok || !r.data || !r.data.access_token) return fail(r);
      setSession(toSession(r.data));
      return { ok: true, session };
    },

    async createCircle(p) {
      const r = await authedCall('/rest/v1/rpc/create_circle', {
        method: 'POST',
        body: { circle_name: p.circleName, member_name: p.memberName,
          avatar: p.avatarId, accent: p.accentId },
      });
      if (!r.ok) return fail(r);
      return { ok: true, circle: camelCircle(r.data.circle), memberId: r.data.member_id };
    },

    async joinCircle(p) {
      const r = await authedCall('/rest/v1/rpc/join_circle', {
        method: 'POST',
        body: { code: p.code, member_name: p.memberName,
          avatar: p.avatarId, accent: p.accentId },
      });
      if (!r.ok) return fail(r);
      return { ok: true, circle: camelCircle(r.data.circle), memberId: r.data.member_id,
        members: (r.data.members || []).map(camelMember) };
    },

    async fetchMembers(circleId) {
      const r = await authedCall(
        '/rest/v1/members?circle_id=eq.' + circleId + '&order=joined_at.asc', {});
      if (!r.ok) return fail(r);
      return { ok: true, members: (r.data || []).map(camelMember) };
    },

    async pushEvents(circleId, memberId, events) {
      if (!events.length) return { ok: true, pushed: 0 };
      const rows = events.map(e => ({ circle_id: circleId, member_id: memberId,
        client_key: e.client_key, type: e.type, payload: e.payload }));
      const r = await authedCall('/rest/v1/events?on_conflict=circle_id,client_key', {
        method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      if (!r.ok) return fail(r);
      return { ok: true, pushed: rows.length };
    },

    async pullEvents(circleId, cursor, limit) {
      const r = await authedCall('/rest/v1/events?circle_id=eq.' + circleId
        + '&id=gt.' + cursor + '&order=id.asc&limit=' + (limit || 200), {});
      if (!r.ok) return fail(r);
      const events = r.data || [];
      return { ok: true, events,
        cursor: events.length ? events[events.length - 1].id : cursor };
    },

    async leaveCircle(circleId, memberId, leaveEvent) {
      // Post the goodbye while still a member — RLS forbids it afterwards.
      if (leaveEvent) await this.pushEvents(circleId, memberId, [leaveEvent]);
      const r = await authedCall('/rest/v1/members?circle_id=eq.' + circleId
        + '&user_id=eq.' + (session ? session.userId : ''), { method: 'DELETE' });
      if (!r.ok) return fail(r);
      return { ok: true };
    },
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveNet;
if (typeof window !== 'undefined') window.GroveNet = GroveNet;
