import { op } from '../helpers.js';
// Pass documented OpenAPI options through the legacy helper’s inferred partial type.
const operation = (/** @type {any} */ options) => op(options);

export function timetablePaths() {
  const subject = { type: 'object', required: ['id', 'name', 'teacher', 'room', 'color'], properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,64}$' }, name: { type: 'string', minLength: 1, maxLength: 80 },
    teacher: { type: 'string', maxLength: 120 }, room: { type: 'string', maxLength: 80 }, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
  } };
  const slot = { type: 'object', required: ['id', 'kind', 'start', 'end'], properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,64}$' }, kind: { enum: ['lesson', 'break'] },
    start: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
  } };
  const entry = { type: 'object', required: ['day', 'slot_id', 'subject_id'], properties: {
    day: { type: 'integer', minimum: 1, maximum: 7 }, slot_id: { type: 'string' }, subject_id: { type: 'string' },
  } };
  const plan = { type: 'object', required: ['days', 'subjects', 'slots', 'entries'], properties: {
    days: { type: 'integer', minimum: 5, maximum: 7 }, subjects: { type: 'array', maxItems: 60, items: subject },
    slots: { type: 'array', minItems: 1, maxItems: 30, items: slot }, entries: { type: 'array', maxItems: 210, items: entry },
  } };
  const response = { type: 'object', required: ['data', 'revision', 'can_edit'], properties: {
    data: plan, revision: { type: 'integer', minimum: 0 }, can_edit: { type: 'boolean' },
  } };
  const ok = { description: 'Timetable and its current optimistic-lock revision', content: { 'application/json': { schema: response } } };
  const params = [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }];
  return {
    '/api/v1/timetable/members': {
      get: operation({ tag: 'Timetable', summary: 'List active household members with owner/admin editability', description: 'Requires timetable:read. Excludes staff, guests, display accounts and deactivated members. Module read-only rights can further restrict can_edit.' }),
    },
    '/api/v1/timetable/{userId}': {
      get: operation({ tag: 'Timetable', summary: 'Read a member’s weekly school timetable', params,
        description: 'Requires timetable:read. Household-readable. An unsaved plan returns revision 0 and a default eight-lesson grid with breaks; reading does not create a row.',
        responses: { 200: ok, 400: { description: 'Invalid ID' }, 403: { description: 'Module access denied' }, 404: { description: 'Not an active household member' } } }),
      put: operation({ tag: 'Timetable', summary: 'Replace a member’s weekly school timetable atomically', params, stateChanging: true,
        description: 'Requires timetable:write and owner or administrator identity. Send the revision from GET. Stable IDs are unique within subjects and slots. Times must increase without overlap; at least one lesson must remain. Entries refer only to this plan’s subjects and lesson slots, with one entry per weekday/slot. Removing a subject, slot or day requires removing its entries in the same request. Reasons: timetable_invalid for malformed data or references, timetable_times for invalid or overlapping times, timetable_conflict for stale revision. Unrecognised fields are discarded.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['data', 'revision'], properties: { data: plan, revision: { type: 'integer', minimum: 0 } } } } } },
        responses: { 200: ok, 400: { description: 'Invalid data, references or times' }, 403: { description: 'Owner/admin or module write access required' }, 404: { description: 'Not an active household member' }, 409: { description: 'timetable_conflict: fetch the latest revision before retrying' } },
      }),
    },
  };
}
