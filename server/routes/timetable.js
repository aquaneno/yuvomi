/** Weekly school timetable. Household-readable, writable only by owner or admin. */
import { createRequire } from 'node:module';
import * as db from '../db.js';
import { isAdminRequest } from '../middleware/require-admin.js';
import { householdMemberSql, memberOrderSql } from '../services/household-members.js';
import { cleanTimetable, defaultTimetable, timetableError } from '../../public/utils/timetable.js';

const router = createRequire(import.meta.url)('express').Router();
/** @param {any} req @param {number} userId */
const mayEdit = (req, userId) => isAdminRequest(req) || (req.authUserId ?? req.session?.userId) === userId;

router.get('/members', (/** @type {any} */ req, /** @type {any} */ res) => {
  const members = /** @type {{id:number, display_name:string}[]} */ (db.get().prepare(
    `SELECT u.id, u.display_name FROM users u WHERE ${householdMemberSql('u')} ORDER BY ${memberOrderSql('u')}`,
  ).all());
  res.json({ data: members.map((u) => ({ ...u, can_edit: mayEdit(req, u.id) })) });
});

router.use('/:userId', (/** @type {any} */ req, /** @type {any} */ res, /** @type {Function} */ next) => {
  const userId = Number(req.params.userId);
  if (!/^[1-9]\d*$/.test(req.params.userId) || !Number.isSafeInteger(userId)) {
    res.status(400).json({ error: 'Invalid user ID.', code: 400 }); return;
  }
  const member = db.get().prepare(`SELECT u.id FROM users u WHERE u.id = ? AND ${householdMemberSql('u')}`).get(userId);
  if (!member) { res.status(404).json({ error: 'Household member not found.', code: 404 }); return; }
  next();
});

router.get('/:userId', (/** @type {any} */ req, /** @type {any} */ res) => {
  const userId = Number(req.params.userId);
  const row = /** @type {{data:string, revision:number}|undefined} */ (db.get().prepare('SELECT data, revision FROM school_timetables WHERE user_id = ?').get(userId));
  res.json({ data: row ? JSON.parse(row.data) : defaultTimetable(), revision: row?.revision ?? 0, can_edit: mayEdit(req, userId) });
});

router.put('/:userId', (/** @type {any} */ req, /** @type {any} */ res) => {
  const userId = Number(req.params.userId);
  if (!mayEdit(req, userId)) { res.status(403).json({ error: 'Only the owner or an administrator may change this timetable.', code: 403 }); return; }
  const { data, revision } = req.body ?? {};
  const reason = timetableError(data);
  if (reason || !Number.isSafeInteger(revision) || revision < 0) {
    res.status(400).json({ error: 'Invalid timetable or revision.', code: 400, reason: reason ?? 'timetable_invalid' }); return;
  }
  const clean = cleanTimetable(data);
  // Atomic compare-and-swap also covers the first save (expected revision 0).
  const updated = db.transaction(() => {
    const row = /** @type {{revision:number}|undefined} */ (db.get().prepare('SELECT revision FROM school_timetables WHERE user_id = ?').get(userId));
    if ((row?.revision ?? 0) !== revision) return false;
    db.get().prepare(`INSERT INTO school_timetables (user_id, data, revision) VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, revision = school_timetables.revision + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`).run(userId, JSON.stringify(clean));
    return true;
  });
  if (!updated) { res.status(409).json({ error: 'Timetable changed. Reload before editing.', code: 409, reason: 'timetable_conflict' }); return; }
  res.json({ data: clean, revision: revision + 1, can_edit: true });
});

export default router;
