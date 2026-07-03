'use strict';
// fake-supabase — an in-memory double of the exact Supabase surface Grove
// uses (GoTrue anonymous auth + PostgREST tables/RPCs), for tests and local
// two-player demos. Zero dependencies. Mirrors real semantics: RLS-filtered
// reads (empty, not 403), 403 on unauthorized writes, rotating refresh
// tokens, (circle_id, client_key) dedupe.
//
//   node tools/fake-supabase.js --port 9911
//
const http = require('http');
const { randomUUID } = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};

function createFake() {
  const state = {
    tokens: new Map(),     // access token -> userId
    refreshes: new Map(),  // refresh token -> userId
    circles: new Map(),    // id -> {id, name, invite_code, created_by, created_at}
    byCode: new Map(),     // invite_code -> circleId
    members: [],           // {id, circle_id, user_id, name, avatar_id, accent_id, joined_at}
    events: [],            // {id, circle_id, member_id, client_key, type, payload, created_at}
    nextEventId: 1,
    seq: 1,
  };

  const isMember = (circleId, userId) =>
    state.members.some(m => m.circle_id === circleId && m.user_id === userId);
  const membersOf = (circleId) =>
    state.members.filter(m => m.circle_id === circleId)
      .slice().sort((a, b) => a.joined_at.localeCompare(b.joined_at));

  function newSession(userId) {
    const access = 'tok-' + userId + '-' + (state.seq++);
    const refresh = 'ref-' + userId + '-' + (state.seq++);
    state.tokens.set(access, userId);
    state.refreshes.set(refresh, userId);
    return { access_token: access, refresh_token: refresh, user: { id: userId } };
  }

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!state.byCode.has(code)) return code;
    }
  }

  function addEvent(circleId, memberId, clientKey, type, payload) {
    state.events.push({
      id: state.nextEventId++, circle_id: circleId, member_id: memberId,
      client_key: clientKey, type, payload: payload || {},
      created_at: new Date().toISOString(),
    });
  }

  function addMember(circleId, userId, body) {
    const m = {
      id: randomUUID(), circle_id: circleId, user_id: userId,
      name: body.member_name, avatar_id: body.avatar, accent_id: body.accent,
      joined_at: new Date().toISOString(),
    };
    state.members.push(m);
    addEvent(circleId, m.id, randomUUID(), 'join', { name: m.name });
    return m;
  }

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS));
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') { send(204); return; }

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { /* keep {} */ }
      const u = new URL(req.url, 'http://localhost');
      const q = u.searchParams;
      const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const userId = state.tokens.get(auth) || null;
      const needAuth = () => {
        if (!userId) { send(401, { message: 'JWT expired' }); return true; }
        return false;
      };
      const eq = (key) => {
        const v = q.get(key);
        return v && v.startsWith('eq.') ? v.slice(3) : null;
      };

      // ---- GoTrue ----
      if (req.method === 'POST' && u.pathname === '/auth/v1/signup') {
        send(200, newSession('u-' + randomUUID().slice(0, 8)));
        return;
      }
      if (req.method === 'POST' && u.pathname === '/auth/v1/token'
          && q.get('grant_type') === 'refresh_token') {
        const uid = state.refreshes.get(body.refresh_token);
        if (!uid) { send(401, { message: 'invalid refresh token' }); return; }
        state.refreshes.delete(body.refresh_token); // rotation
        send(200, newSession(uid));
        return;
      }

      // ---- RPCs ----
      if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/create_circle') {
        if (needAuth()) return;
        const circle = {
          id: randomUUID(), name: body.circle_name, invite_code: newCode(),
          created_by: userId, created_at: new Date().toISOString(),
        };
        state.circles.set(circle.id, circle);
        state.byCode.set(circle.invite_code, circle.id);
        const m = addMember(circle.id, userId, body);
        send(200, {
          circle: { id: circle.id, name: circle.name, invite_code: circle.invite_code },
          member_id: m.id,
        });
        return;
      }
      if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/join_circle') {
        if (needAuth()) return;
        const code = String(body.code || '').trim().toUpperCase();
        const circleId = state.byCode.get(code);
        if (!circleId) { send(400, { message: 'not-found' }); return; }
        const circle = state.circles.get(circleId);
        let m = state.members.find(x => x.circle_id === circleId && x.user_id === userId);
        if (!m) {
          if (membersOf(circleId).length >= 5) { send(400, { message: 'full' }); return; }
          m = addMember(circleId, userId, body);
        }
        send(200, {
          circle: { id: circle.id, name: circle.name, invite_code: circle.invite_code },
          member_id: m.id,
          members: membersOf(circleId).map(x => ({
            id: x.id, name: x.name, avatar_id: x.avatar_id,
            accent_id: x.accent_id, joined_at: x.joined_at,
          })),
        });
        return;
      }

      // ---- events ----
      if (u.pathname === '/rest/v1/events' && req.method === 'GET') {
        if (needAuth()) return;
        const circleId = eq('circle_id');
        const gt = q.get('id') && q.get('id').startsWith('gt.') ? Number(q.get('id').slice(3)) : 0;
        const limit = Number(q.get('limit')) || 200;
        // RLS semantics: non-members read an empty set, never an error.
        if (!circleId || !isMember(circleId, userId)) { send(200, []); return; }
        send(200, state.events
          .filter(e => e.circle_id === circleId && e.id > gt)
          .sort((a, b) => a.id - b.id)
          .slice(0, limit));
        return;
      }
      if (u.pathname === '/rest/v1/events' && req.method === 'POST') {
        if (needAuth()) return;
        const rows = Array.isArray(body) ? body : [body];
        const ignoreDupes = /ignore-duplicates/.test(req.headers.prefer || '');
        for (const r of rows) {
          const m = state.members.find(x => x.id === r.member_id);
          if (!m || m.user_id !== userId || m.circle_id !== r.circle_id
              || !isMember(r.circle_id, userId)) {
            send(403, { message: 'new row violates row-level security policy' });
            return;
          }
          const dupe = state.events.some(e =>
            e.circle_id === r.circle_id && e.client_key === r.client_key);
          if (dupe) {
            if (ignoreDupes) continue;
            send(409, { message: 'duplicate key value violates unique constraint' });
            return;
          }
          addEventRow(r);
        }
        send(201);
        return;
      }

      // ---- members ----
      if (u.pathname === '/rest/v1/members' && req.method === 'GET') {
        if (needAuth()) return;
        const circleId = eq('circle_id');
        if (!circleId || !isMember(circleId, userId)) { send(200, []); return; }
        send(200, membersOf(circleId).map(x => ({
          id: x.id, name: x.name, avatar_id: x.avatar_id,
          accent_id: x.accent_id, joined_at: x.joined_at,
        })));
        return;
      }
      if (u.pathname === '/rest/v1/members' && req.method === 'DELETE') {
        if (needAuth()) return;
        const circleId = eq('circle_id');
        const uidFilter = eq('user_id');
        // RLS: you may only delete your own membership rows.
        state.members = state.members.filter(m =>
          !(m.circle_id === circleId && m.user_id === uidFilter && m.user_id === userId));
        send(204);
        return;
      }

      send(404, { message: 'no such endpoint: ' + req.method + ' ' + u.pathname });
    });

    function addEventRow(r) {
      state.events.push({
        id: state.nextEventId++, circle_id: r.circle_id, member_id: r.member_id,
        client_key: r.client_key, type: r.type, payload: r.payload || {},
        created_at: new Date().toISOString(),
      });
    }
  });

  return {
    server,
    state,
    listen(port) {
      return new Promise((resolve) => {
        server.listen(port === undefined ? 0 : port, '127.0.0.1',
          () => resolve(server.address().port));
      });
    },
    close() {
      // Drop keep-alive sockets (global fetch pools them) so the server truly
      // closes; otherwise process.exit races libuv teardown on Windows.
      if (server.closeAllConnections) server.closeAllConnections();
      server.close();
    },
  };
}

module.exports = { createFake };

if (require.main === module) {
  const argPort = process.argv.indexOf('--port');
  const port = argPort !== -1 ? Number(process.argv[argPort + 1]) : 9911;
  createFake().listen(port).then((p) =>
    console.log(`fake supabase → http://localhost:${p}`));
}
