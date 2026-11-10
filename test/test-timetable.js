/** Real migrated database + HTTP: ownership, graph validation and optimistic writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultTimetable, timetableError } from '../public/utils/timetable.js';
import { moduleForPath, tokenAllows } from '../server/scopes.js';

process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';
const { get, closeForShutdown } = await import('../server/db.js');
const { default: router } = await import('../server/routes/timetable.js');
const express = createRequire(import.meta.url)('express');
const database = get();
const addUser = database.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)');
const alice = Number(addUser.run('tt-alice', 'Alice', 'x', 'member').lastInsertRowid);
const bob = Number(addUser.run('tt-bob', 'Bob', 'x', 'member').lastInsertRowid);
const admin = Number(addUser.run('tt-admin', 'Admin', 'x', 'admin').lastInsertRowid);
const former = Number(addUser.run('tt-former', 'Former', 'x', 'member').lastInsertRowid);
database.prepare("UPDATE users SET deactivated_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(former);
const app = express();
app.use(express.json());
app.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {Function} */ next) => {
  req.authUserId = Number(req.get('x-user') || alice);
  req.authRole = req.authUserId === admin ? 'admin' : 'member';
  // A token must not borrow a different cookie session's owner identity.
  req.session = { userId: admin };
  next();
});
app.use('/timetable', router);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', () => resolve(undefined)));
const base = `http://127.0.0.1:${server.address().port}/timetable`;
test.after(async () => { server.close(); await closeForShutdown(Date.now() + 1000); });
/** @param {string} method @param {string} path @param {any} [body] @param {number} [as] */
async function call(method, path, body, as = alice) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': String(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
/** @returns {import('../public/utils/timetable.js').Timetable} */
function populated() {
  const data = defaultTimetable();
  data.subjects.push({ id: 'math', name: 'Maths', teacher: 'Teacher A', room: '101', color: '#0891B2' });
  data.entries.push({ day: 1, slot_id: 'lesson-1', subject_id: 'math' });
  return data;
}

test('default has eight numbered lessons and three breaks; reads never create rows', async () => {
  const result = await call('GET', `/${alice}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.revision, 0);
  assert.equal(result.body.data.slots.filter((/** @type {any} */ s) => s.kind === 'lesson').length, 8);
  assert.equal(result.body.data.slots.filter((/** @type {any} */ s) => s.kind === 'break').length, 3);
  assert.equal(timetableError(result.body.data), null);
  assert.equal(database.prepare('SELECT count(*) AS n FROM school_timetables').get().n, 0);
});
test('roster excludes former accounts and reports self/admin editability', async () => {
  const result = await call('GET', '/members');
  assert.deepEqual(result.body.data.map((/** @type {any} */ m) => m.id).sort(), [alice, bob, admin].sort());
  assert.equal(result.body.data.find((/** @type {any} */ m) => m.id === alice).can_edit, true);
  assert.equal(result.body.data.find((/** @type {any} */ m) => m.id === bob).can_edit, false);
  assert.ok((await call('GET', '/members', undefined, admin)).body.data.every((/** @type {any} */ m) => m.can_edit));
});
test('owner saves, stale writes conflict and cannot destroy a newer placement', async () => {
  const data = populated();
  assert.equal((await call('PUT', `/${alice}`, { data, revision: 0 })).status, 200);
  const moved = structuredClone(data); moved.entries[0].day = 2;
  assert.equal((await call('PUT', `/${alice}`, { data: moved, revision: 1 })).status, 200);
  const stale = await call('PUT', `/${alice}`, { data, revision: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.reason, 'timetable_conflict');
  const stored = await call('GET', `/${alice}`);
  assert.equal(stored.body.revision, 2); assert.equal(stored.body.data.entries[0].day, 2);
});
test('another member can read but cannot write, even with an admin cookie; admin can write', async () => {
  assert.equal((await call('GET', `/${alice}`, undefined, bob)).body.can_edit, false);
  assert.equal((await call('PUT', `/${alice}`, { data: populated(), revision: 2 }, bob)).status, 403);
  assert.equal((await call('PUT', `/${bob}`, { data: populated(), revision: 0 }, admin)).status, 200);
  assert.equal((await call('GET', `/${bob}`)).body.data.entries[0].subject_id, 'math');
});
for (const variant of ['break', 'foreign-subject', 'duplicate-cell', 'duplicate-subject', 'duplicate-slot', 'overlap', 'invalid-clock', 'reverse', 'weekday', 'missing-slot', 'no-lessons', 'too-many-subjects']) {
  test(`rejects ${variant} atomically`, async () => {
    const data = populated();
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
    const before = (await call('GET', `/${alice}`)).body;
    assert.equal((await call('PUT', `/${alice}`, { data, revision: before.revision })).status, 400);
    assert.deepEqual((await call('GET', `/${alice}`)).body, before);
  });
}
test('rejects malformed IDs, missing revision and inactive members', async () => {
  for (const id of ['0', '-1', '1junk']) assert.equal((await call('GET', `/${id}`)).status, 400);
  assert.equal((await call('GET', `/${former}`)).status, 404);
  assert.equal((await call('PUT', `/${former}`, { data: populated(), revision: 0 }, admin)).status, 404);
  assert.equal((await call('PUT', `/${alice}`, { data: populated() })).status, 400);
});
test('separate timetable scope maps both read and write methods', () => {
  assert.equal(moduleForPath('/timetable/members'), 'timetable');
  assert.equal(tokenAllows(['timetable:read'], 'timetable', 'read'), true);
  assert.equal(tokenAllows(['timetable:read'], 'timetable', 'write'), false);
  assert.equal(tokenAllows(['schedule:write'], 'timetable', 'read'), false);
});
test('deleting a subject with its assignments and changing times preserve stable IDs', async () => {
  const current = (await call('GET', `/${alice}`)).body;
  const data = current.data;
  data.subjects = []; data.entries = []; data.slots[0].start = '08:05';
  const saved = await call('PUT', `/${alice}`, { data, revision: current.revision });
  assert.equal(saved.status, 200); assert.equal(saved.body.data.slots[0].id, 'lesson-1');
});
test('user deletion cascades the personal timetable', () => {
  database.prepare('DELETE FROM users WHERE id = ?').run(bob);
  assert.equal(database.prepare('SELECT 1 FROM school_timetables WHERE user_id = ?').get(bob), undefined);
});
