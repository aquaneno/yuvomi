/** Shared timetable model. Stable IDs keep assignments intact when times change. */
/** @typedef {{id:string, name:string, teacher:string, room:string, color:string}} TimetableSubject */
/** @typedef {{id:string, kind:'lesson'|'break', start:string, end:string}} TimetableSlot */
/** @typedef {{day:number, slot_id:string, subject_id:string}} TimetableEntry */
/** @typedef {{days:number, subjects:TimetableSubject[], slots:TimetableSlot[], entries:TimetableEntry[]}} Timetable */

/** @returns {Timetable} */
export function defaultTimetable() {
  const slots = [];
  let minutes = 8 * 60;
  for (let lesson = 1; lesson <= 8; lesson++) {
    slots.push({ id: `lesson-${lesson}`, kind: /** @type {'lesson'} */ ('lesson'), start: clock(minutes), end: clock(minutes + 45) });
    minutes += 45;
    if ([2, 4, 6].includes(lesson)) {
      slots.push({ id: `break-${lesson}`, kind: /** @type {'break'} */ ('break'), start: clock(minutes), end: clock(minutes + 15) });
      minutes += 15;
    }
  }
  return { days: 5, subjects: [], slots, entries: [] };
}
/** @param {number} minutes */
export function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
/** @param {string} value */
export function minuteOfDay(value) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); }

/** Strict, bounded validation before storing a whole plan. Never silently discard assignments.
 * @param {any} plan
 * @returns {string|null} a stable reason, or null
 */
export function timetableError(plan) {
  if (!plan || !Number.isInteger(plan.days) || plan.days < 5 || plan.days > 7
      || !Array.isArray(plan.subjects) || plan.subjects.length > 60
      || !Array.isArray(plan.slots) || plan.slots.length < 1 || plan.slots.length > 30
      || !Array.isArray(plan.entries) || plan.entries.length > 210) return 'timetable_invalid';
  const validId = (/** @type {any} */ value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
  const text = (/** @type {any} */ value, /** @type {number} */ max) => typeof value === 'string' && value.length <= max;
  const subjects = new Set();
  for (const s of plan.subjects) {
    if (!s || !validId(s.id) || subjects.has(s.id) || !text(s.name, 80) || !s.name.trim()
      || !text(s.teacher, 120) || !text(s.room, 80) || typeof s.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(s.color)) return 'timetable_invalid';
    subjects.add(s.id);
  }
  const slots = new Map();
  let end = '';
  for (const s of plan.slots) {
    if (!s || !validId(s.id) || slots.has(s.id) || !['lesson', 'break'].includes(s.kind)
      || typeof s.start !== 'string' || typeof s.end !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end)
      || s.start >= s.end || s.start < end) return 'timetable_times';
    slots.set(s.id, s.kind);
    end = s.end;
  }
  if (![...slots.values()].includes('lesson')) return 'timetable_times';
  const occupied = new Set();
  for (const e of plan.entries) {
    if (!e || !Number.isInteger(e.day) || e.day < 1 || e.day > plan.days
      || slots.get(e.slot_id) !== 'lesson' || !subjects.has(e.subject_id)
      || occupied.has(`${e.day}:${e.slot_id}`)) return 'timetable_invalid';
    occupied.add(`${e.day}:${e.slot_id}`);
  }
  return null;
}

/** @param {Timetable} plan @returns {Timetable} Only persist the documented fields. */
export function cleanTimetable(plan) {
  return {
    days: plan.days,
    subjects: plan.subjects.map(({ id, name, teacher, room, color }) => ({ id, name: name.trim(), teacher: teacher.trim(), room: room.trim(), color })),
    slots: plan.slots.map(({ id, kind, start, end }) => ({ id, kind, start, end })),
    entries: plan.entries.map(({ day, slot_id, subject_id }) => ({ day, slot_id, subject_id })),
  };
}

/** Random IDs also work on LAN HTTP, where crypto.randomUUID is unavailable. */
export function newId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return 's-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
