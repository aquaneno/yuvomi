import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.js';
import { cleanTimetable, defaultTimetable, timetableError } from '../../modules/school-timetable/model.js';

export const PREFIX = '/api/extensions/school-timetable';
const PERMISSION = 'ext:school-timetable';
const CSRF_COOKIE = 'school-timetable-csrf';
const fail = (status, error, reason) => Object.assign(new Error(error), { status, reason });

function cookieValue(header, name) {
  const values = String(header || '').split(';').map((v) => v.trim()).filter((v) => v.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
function sessionCookie(header) {
  for (const name of ['yuvomi.sid', 'oikos.sid']) {
    const value = cookieValue(header, name);
    if (value) return `${name}=${value}`;
  }
  throw fail(401, 'A Yuvomi browser session is required.', 'session_required');
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, 'JSON required.');
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size <= 128 * 1024) parts.push(part);
  }
  if (size > 128 * 1024) throw fail(413, 'Request too large.');
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw fail(400, 'Invalid JSON.'); }
}

/** Embeddable for integration tests; production configuration is explicit. */
export function createTimetableService({ yuvomiUrl, publicOrigin, dbPath, cacheMs = 3000, fetchCore = fetch }) {
  const internal = new URL(yuvomiUrl);
  const publicUrl = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(internal.protocol) || internal.username || internal.password || internal.pathname !== '/') throw new Error('YUVOMI_URL must be an HTTP(S) origin.');
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an exact origin without trailing slash/path.');
  if (!dbPath) throw new Error('TIMETABLE_DB is required.');
  const store = openStore(dbPath);
  const secret = randomBytes(32);
  const cache = new Map();
  const ttl = Math.max(0, Math.min(Number(cacheMs) || 0, 5000));
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const csrfFor = (session) => createHmac('sha256', secret).update(session).digest('hex');
  async function core(path, session) {
    let response;
    try {
      response = await fetchCore(new URL('/api/v1' + path, internal), {
        headers: { Cookie: session, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
    } catch { throw fail(503, 'Yuvomi is unavailable.', 'dependency'); }
    if ([401, 403].includes(response.status)) throw fail(response.status, 'Yuvomi denied access.', 'core_permission');
    if (!response.ok) throw fail(503, 'Yuvomi API is unavailable.', 'dependency');
    try { return await response.json(); } catch { throw fail(503, 'Invalid Yuvomi API response.', 'dependency'); }
  }
  async function resolveSession(session) {
    const key = hash(session);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    cache.delete(key);
    const identity = await core('/auth/me', session);
    if (!Number.isSafeInteger(identity.user?.id)) throw fail(401, 'Invalid Yuvomi identity.');
    const access = identity.permissions?.modules?.[PERMISSION];
    // Missing key also covers a disabled/uninstalled module. Fail closed for older core versions.
    if (!['read', 'write'].includes(access)) throw fail(403, 'Module disabled or access denied.', 'module_permission');
    const value = { user: { id: identity.user.id, admin: identity.user.role === 'admin' && identity.permissions.admin === true }, access };
    if (cache.size >= 1000) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }
  const mayEdit = (identity, id) => identity.access === 'write' && (identity.user.admin || identity.user.id === id);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url, 'http://sidecar.invalid').pathname;
      if (path === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
      if (!path.startsWith(PREFIX + '/')) throw fail(404, 'Not found.');
      if (!['GET', 'PUT'].includes(req.method)) throw fail(405, 'Method not allowed.');
      const session = sessionCookie(req.headers.cookie);
      const identity = await resolveSession(session);
      const csrf = csrfFor(session);
      if (req.method !== 'GET') {
        if (req.headers.origin !== publicOrigin) throw fail(403, 'Origin rejected.', 'origin');
        const header = req.headers['x-timetable-csrf'];
        const cookie = cookieValue(req.headers.cookie, CSRF_COOKIE);
        if (typeof header !== 'string' || header !== cookie || !/^[a-f0-9]{64}$/.test(header) || !timingSafeEqual(Buffer.from(header), Buffer.from(csrf))) throw fail(403, 'CSRF token rejected.', 'csrf');
      } else {
        res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=${PREFIX}; SameSite=Strict${publicUrl.protocol === 'https:' ? '; Secure' : ''}`);
        res.setHeader('X-Timetable-CSRF', csrf);
      }
      const route = path.slice(PREFIX.length);
      if (route === '/session' && req.method === 'GET') return json(res, 200, { can_write: identity.access === 'write' });
      const roster = await core('/family/members', session);
      if (!Array.isArray(roster.data) || roster.data.some((m) => !Number.isSafeInteger(m.id) || typeof m.display_name !== 'string')) throw fail(503, 'Invalid household response.', 'dependency');
      if (route === '/members' && req.method === 'GET') {
        return json(res, 200, { data: roster.data.map(({ id, display_name }) => ({ id, display_name, can_edit: mayEdit(identity, id) })) });
      }
      if (!/^\/[1-9]\d*$/.test(route) || !Number.isSafeInteger(Number(route.slice(1)))) throw fail(400, 'Invalid member ID.');
      const id = Number(route.slice(1));
      if (!roster.data.some((m) => m.id === id)) throw fail(404, 'Household member not found.');
      if (req.method === 'GET') return json(res, 200, { ...(store.get(id) || { data: defaultTimetable(), revision: 0 }), can_edit: mayEdit(identity, id) });
      if (!mayEdit(identity, id)) throw fail(403, 'Only the owner or an administrator may edit this timetable.', 'owner_permission');
      const { data, revision } = (await readBody(req)) || {};
      const reason = timetableError(data);
      if (reason || !Number.isSafeInteger(revision) || revision < 0) throw fail(400, 'Invalid timetable or revision.', reason || 'timetable_invalid');
      const clean = cleanTimetable(data);
      const saved = store.save(id, clean, revision);
      if (!saved) throw fail(409, 'Timetable changed. Reload before editing.', 'timetable_conflict');
      return json(res, 200, { data: clean, revision: saved.revision, can_edit: true });
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('Timetable request failed:', error.message);
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'Internal server error.' : error.message, code: status, ...(error.reason ? { reason: error.reason } : {}) });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, close: async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); cache.clear(); store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = createTimetableService({ yuvomiUrl: process.env.YUVOMI_URL, publicOrigin: process.env.PUBLIC_ORIGIN, dbPath: process.env.TIMETABLE_DB || '/data/timetable.db' });
  service.server.listen(Number(process.env.PORT || 3100), '0.0.0.0', () => console.log('Timetable service listening.'));
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => { void service.close().then(() => process.exit(0)); });
}
