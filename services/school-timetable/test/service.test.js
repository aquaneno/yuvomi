import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTimetableService, PREFIX } from '../server.js';
import { migrateLegacy } from '../migrate-legacy.js';
import { defaultTimetable, newId } from '../../../modules/school-timetable/model.js';

const origin = 'https://family.example';
const directory = mkdtempSync(join(tmpdir(), 'timetable-service-'));
const dbPath = join(directory, 'module.db');
let service, base, upstream, coreUrl, coreCalls = 0, coreUnavailable = false;
let roster = [{ id: 1, display_name: 'Alice' }, { id: 2, display_name: 'Bob' }, { id: 3, display_name: 'Admin' }];
const identities = {
  alice: { user: { id: 1, role: 'member' }, permissions: { admin: false, modules: { 'ext:school-timetable': 'write' } } },
  bob: { user: { id: 2, role: 'member' }, permissions: { admin: false, modules: { 'ext:school-timetable': 'write' } } },
  admin: { user: { id: 3, role: 'admin' }, permissions: { admin: true, modules: { 'ext:school-timetable': 'write' } } },
  read: { user: { id: 1, role: 'member' }, permissions: { modules: { 'ext:school-timetable': 'read' } } },
  none: { user: { id: 1, role: 'member' }, permissions: { modules: { 'ext:school-timetable': 'none' } } },
  disabled: { user: { id: 1, role: 'admin' }, permissions: { admin: true, modules: {} } },
};
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
before(async () => {
  upstream = createServer((req, res) => {
    coreCalls++;
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-user'], undefined);
    const session = req.headers.cookie?.match(/(?:yuvomi|oikos)\.sid=([^;]+)/)?.[1];
    res.setHeader('Content-Type', 'application/json');
    if (coreUnavailable) { res.writeHead(503); return res.end('{}'); }
    if (!identities[session]) { res.writeHead(401); return res.end('{}'); }
    if (req.url === '/api/v1/auth/me') return res.end(JSON.stringify(identities[session]));
    if (req.url === '/api/v1/timetable/members') return res.end(JSON.stringify({ data: roster }));
    if (req.url.startsWith('/api/v1/timetable/')) return res.end(JSON.stringify(Number(req.url.split('/').at(-1)) === 4 ? { data: populated(), revision: 1 } : { data: defaultTimetable(), revision: 0 }));
    if (req.url === '/api/v1/family/members') return res.end(JSON.stringify({ data: roster }));
    res.writeHead(404); res.end('{}');
  });
  coreUrl = await listen(upstream);
  service = createTimetableService({ yuvomiUrl: coreUrl, publicOrigin: origin, dbPath, cacheMs: 0 });
  base = await listen(service.server);
});
after(async () => { await service.close(); await new Promise((r) => upstream.close(r)); rmSync(directory, { recursive: true, force: true }); });

async function call(method, path, body, as = 'alice', headers = {}) {
  const session = `yuvomi.sid=${as}`;
  let csrf = '';
  if (method !== 'GET') {
    const tokenResponse = await fetch(base + PREFIX + '/session', { headers: { Cookie: session } });
    csrf = tokenResponse.headers.get('X-Timetable-CSRF') || '';
  }
  const response = await fetch(base + PREFIX + path, {
    method, headers: { Cookie: `${session}; school-timetable-csrf=${csrf}`, Origin: origin, 'X-Timetable-CSRF': csrf, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
function populated() {
  const data = defaultTimetable();
  data.subjects.push({ id: newId(), name: 'Mathematik', teacher: 'Frau Beispiel', room: '101', color: '#0891B2' });
  data.entries.push({ day: 1, slot_id: 'lesson-1', subject_id: data.subjects[0].id });
  return data;
}
test('session is mandatory; user and role headers cannot impersonate an administrator', async () => {
  const response = await fetch(base + PREFIX + '/members', { headers: { 'X-User': '3', Authorization: 'Bearer ignored' } });
  assert.equal(response.status, 401);
  assert.equal((await call('GET', '/members', undefined, 'expired')).status, 401);
});
test('roster and default board use only public Yuvomi APIs', async () => {
  const members = await call('GET', '/members');
  assert.equal(members.status, 200);
  assert.deepEqual(members.body.data.map((m) => m.can_edit), [true, false, false]);
  const result = await call('GET', '/1');
  assert.equal(result.body.revision, 0);
  assert.equal(result.body.data.slots.filter((s) => s.kind === 'lesson').length, 8);
  assert.equal(result.body.data.slots.filter((s) => s.kind === 'break').length, 3);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(result.headers.get('set-cookie'), /SameSite=Strict; Secure/);
});
test('subject creation persists teacher, room, color and stable IDs across a service restart', async () => {
  const data = populated();
  assert.equal((await call('PUT', '/1', { data, revision: 0 })).status, 200);
  await service.close();
  service = createTimetableService({ yuvomiUrl: coreUrl, publicOrigin: origin, dbPath, cacheMs: 0 });
  base = await listen(service.server);
  const saved = await call('GET', '/1');
  assert.deepEqual(saved.body.data, data);
  assert.equal(saved.body.revision, 1);
});
test('stale writes, including two simultaneous first saves, cannot overwrite current data', async () => {
  const current = (await call('GET', '/1')).body;
  assert.equal((await call('PUT', '/1', { data: current.data, revision: 0 })).status, 409);
  assert.deepEqual((await call('GET', '/1')).body, current);
  const results = await Promise.all([call('PUT', '/2', { data: populated(), revision: 0 }, 'admin'), call('PUT', '/2', { data: populated(), revision: 0 }, 'admin')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await call('PUT', '/3', { data: populated(), revision: 12 }, 'admin')).status, 409);
});
test('owner/admin writes, other members read, and plans stay independent', async () => {
  const current = (await call('GET', '/1')).body;
  assert.equal((await call('GET', '/1', undefined, 'bob')).body.can_edit, false);
  assert.equal((await call('PUT', '/1', current, 'bob', { 'x-user': '3' })).status, 403);
  assert.equal((await call('PUT', '/3', { data: populated(), revision: 0 }, 'admin')).status, 200);
  assert.notEqual((await call('GET', '/1')).body.data.subjects[0].id, (await call('GET', '/3')).body.data.subjects[0].id);
});
test('read/none/missing module permissions are enforced even for owners or admins', async () => {
  assert.equal((await call('GET', '/1', undefined, 'read')).body.can_edit, false);
  assert.equal((await call('PUT', '/1', { data: populated(), revision: 1 }, 'read')).status, 403);
  for (const as of ['none', 'disabled']) assert.equal((await call('GET', '/members', undefined, as)).status, 403);
});
test('Origin, independent CSRF header and session-bound cookie are mandatory', async () => {
  const body = { data: populated(), revision: 1 };
  assert.equal((await call('PUT', '/1', body, 'alice', { Origin: 'https://evil.example' })).body.reason, 'origin');
  assert.equal((await call('PUT', '/1', body, 'alice', { 'X-Timetable-CSRF': '' })).body.reason, 'csrf');
  assert.equal((await call('PUT', '/1', body, 'alice', { 'X-Timetable-CSRF': 'a'.repeat(64), Cookie: 'yuvomi.sid=alice; school-timetable-csrf=' + 'a'.repeat(64) })).body.reason, 'csrf');
  assert.equal((await call('PUT', '/1', body, 'alice', { Cookie: 'yuvomi.sid=alice; yuvomi.sid=admin' })).status, 401);
  const token = (await call('GET', '/session', undefined, 'admin')).headers.get('X-Timetable-CSRF');
  assert.equal((await call('PUT', '/1', body, 'alice', { Cookie: `yuvomi.sid=alice; school-timetable-csrf=${token}`, 'X-Timetable-CSRF': token })).body.reason, 'csrf');
});
test('inactive/missing members and malformed IDs are refused', async () => {
  for (const id of ['0', '-1', '1junk', '9007199254740992']) assert.equal((await call('GET', '/' + id)).status, 400);
  assert.equal((await call('GET', '/99')).status, 404);
  const previous = roster;
  roster = roster.filter((m) => m.id !== 2);
  assert.equal((await call('GET', '/2')).status, 404);
  assert.equal((await call('PUT', '/2', { data: populated(), revision: 1 }, 'admin')).status, 404);
  roster = previous;
});
for (const variant of ['blank-name', 'break', 'foreign-subject', 'duplicate-cell', 'duplicate-subject', 'duplicate-slot', 'overlap', 'invalid-clock', 'reverse', 'weekday', 'missing-slot', 'no-lessons', 'too-many-subjects']) {
  test(`invalid ${variant} cannot modify the stored board`, async () => {
    const data = populated();
    if (variant === 'blank-name') data.subjects[0].name = '   ';
    if (variant === 'break') data.entries[0].slot_id = 'break-2';
    if (variant === 'foreign-subject') data.entries[0].subject_id = 'foreign';
    if (variant === 'duplicate-cell') data.entries.push({ ...data.entries[0] });
    if (variant === 'duplicate-subject') data.subjects.push({ ...data.subjects[0] });
    if (variant === 'duplicate-slot') data.slots.push({ ...data.slots[0] });
    if (variant === 'overlap') data.slots[1].start = '08:30';
    if (variant === 'invalid-clock') data.slots[0].start = '25:00';
    if (variant === 'reverse') data.slots[0].end = '07:00';
    if (variant === 'weekday') data.entries[0].day = 6;
    if (variant === 'missing-slot') data.slots.shift();
    if (variant === 'no-lessons') { data.slots = data.slots.filter((s) => s.kind === 'break'); data.entries = []; }
    if (variant === 'too-many-subjects') data.subjects = Array.from({ length: 61 }, (_, i) => ({ ...data.subjects[0], id: `s-${i}` }));
    const before = (await call('GET', '/1')).body;
    assert.equal((await call('PUT', '/1', { data, revision: before.revision })).status, 400);
    assert.deepEqual((await call('GET', '/1')).body, before);
  });
}
test('malformed/oversized request bodies and wrong content type are rejected', async () => {
  const response = await call('GET', '/session');
  const csrf = response.headers.get('X-Timetable-CSRF');
  const headers = { Cookie: `yuvomi.sid=alice; school-timetable-csrf=${csrf}`, Origin: origin, 'X-Timetable-CSRF': csrf, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + PREFIX + '/1', { method: 'PUT', headers, body: '{broken' })).status, 400);
  assert.equal((await fetch(base + PREFIX + '/1', { method: 'PUT', headers, body: 'x'.repeat(140000) })).status, 413);
  assert.equal((await call('PUT', '/1', {}, 'alice', { 'Content-Type': 'text/plain' })).status, 415);
});
test('short session cache avoids spending the auth rate limit on every read', async () => {
  const cached = createTimetableService({ yuvomiUrl: coreUrl, publicOrigin: origin, dbPath: ':memory:', cacheMs: 3000 });
  const url = await listen(cached.server);
  try {
    const before = coreCalls;
    for (let i = 0; i < 4; i++) assert.equal((await fetch(url + PREFIX + '/session', { headers: { Cookie: 'yuvomi.sid=alice' } })).status, 200);
    assert.equal(coreCalls - before, 1);
    assert.equal((await fetch(url + PREFIX + '/session', { headers: { Cookie: 'yuvomi.sid=none' } })).status, 403);
  } finally { await cached.close(); }
});
test('core outages keep stored plans intact and a later request recovers', async () => {
  const before = (await call('GET', '/1')).body;
  coreUnavailable = true;
  try { assert.equal((await call('GET', '/1')).status, 503); }
  finally { coreUnavailable = false; }
  assert.deepEqual((await call('GET', '/1')).body, before);
});
test('subject removal and changed lesson times preserve stable remaining references', async () => {
  const { data, revision } = (await call('GET', '/1')).body;
  data.subjects = []; data.entries = []; data.slots[0].start = '08:05';
  const result = await call('PUT', '/1', { data, revision });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.slots[0].id, 'lesson-1');
});


test('legacy API migration imports saved plans once, skips defaults and never overwrites module plans', async () => {
  roster.push({ id: 4, display_name: 'Legacy child' }, { id: 5, display_name: 'Empty child' });
  const options = { legacyUrl: coreUrl, timetableUrl: base, publicOrigin: origin, sessionCookie: 'yuvomi.sid=admin' };
  const first = await migrateLegacy(options);
  assert.deepEqual(first.copied, [4]);
  assert.equal((await call('GET', '/4')).body.data.subjects[0].name, 'Mathematik');
  assert.deepEqual((await migrateLegacy(options)).copied, []);
  assert.equal((await call('GET', '/4')).body.revision, 1);
  await assert.rejects(migrateLegacy({ ...options, sessionCookie: 'yuvomi.sid=alice' }), /administrator/);
});
