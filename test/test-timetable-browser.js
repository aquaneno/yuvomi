/** Real built app: editing subjects, placement, drag movement, time validation and member isolation. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, openPage, gotoRoute } from './document-guards-harness.js';

/** @type {any} */ let harness;
/** @type {any} */ let page;
before(async () => { harness = await startHarness(); page = await openPage(harness, { device: 'desktop' }); });
after(async () => { await page?.close(); await harness?.close(); });
/** @param {string} method @param {string} path @param {any} [body] */
async function request(method, path, body) {
  return page.evaluate(async (/** @type {any} */ args) => {
    const token = document.cookie.split('; ').find((c) => c.startsWith('csrf-token='))?.slice(11) ?? '';
    const response = await fetch(`/api/v1${args.path}`, { method: args.method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(token) }, body: args.body === undefined ? undefined : JSON.stringify(args.body) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
}
async function board() { await gotoRoute(page, '/timetable'); await page.waitForSelector('[data-palette]'); }
async function current() {
  const id = await page.$eval('[data-member]', (/** @type {HTMLSelectElement} */ el) => el.value);
  return { id, ...(await request('GET', `/timetable/${id}`)).body };
}

test('subject with teacher and room persists, is escaped and can be placed by keyboard-compatible controls', async () => {
  await board();
  await page.click('[data-new]');
  await page.waitForSelector('#tt-name');
  await page.type('#tt-name', 'Mathe <b>');
  await page.type('#tt-teacher', 'Frau Beispiel');
  await page.type('#tt-room', '101');
  await page.click('[data-subject-form] button[type="submit"]');
  await page.waitForSelector('[data-palette] [data-select]');
  assert.equal(await page.$('[data-palette] .tt-card strong b'), null);
  await page.click('[data-select]');
  await page.click('[data-place="lesson-1"][data-day="1"]');
  await page.waitForSelector('[data-slot="lesson-1"][data-day="1"] .tt-card');
  const saved = await current();
  assert.equal(saved.data.subjects[0].teacher, 'Frau Beispiel');
  assert.equal(saved.data.entries[0].day, 1);
  await board();
  assert.equal((await current()).data.subjects[0].room, '101');
  assert.equal(await page.$$eval('.tt-break', (/** @type {Element[]} */ rows) => rows.length), 3);
});

test('dragging a scheduled card moves it to an empty cell and persists the move', async () => {
  // Wait until the lazy Sortable instance is attached before sending pointer input.
  await page.waitForFunction(() => {
    const cell = document.querySelector('[data-slot="lesson-1"][data-day="1"]');
    return Boolean(cell && Object.keys(cell).some((key) => key.startsWith('Sortable')));
  });
  const source = await page.$('[data-slot="lesson-1"][data-day="1"] .tt-drag');
  const target = await page.$('[data-slot="lesson-2"][data-day="2"]');
  const a = await source.boundingBox(); const b = await target.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 5, { steps: 6 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await page.mouse.up();
  await page.waitForSelector('[data-slot="lesson-2"][data-day="2"] .tt-card');
  const saved = await current();
  assert.deepEqual(saved.data.entries, [{ day: 2, slot_id: 'lesson-2', subject_id: saved.data.subjects[0].id }]);
});

test('overlapping lesson times cannot be saved, valid changes preserve assignments and numbers skip breaks', async () => {
  await page.click('[data-times]');
  await page.waitForSelector('[data-slots]');
  await page.$eval('[data-row="lesson-1"] [data-end]', (/** @type {HTMLInputElement} */ el) => { el.value = '09:00'; });
  await page.click('.modal-panel form button[type="submit"]');
  await page.waitForFunction(() => Boolean(document.querySelector('.modal-panel [data-error]')?.textContent));
  assert.equal((await current()).data.slots[0].end, '08:45');
  await page.$eval('[data-row="lesson-1"] [data-end]', (/** @type {HTMLInputElement} */ el) => { el.value = '08:40'; });
  await page.click('.modal-panel form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('[data-slots]'));
  assert.equal((await current()).data.slots[0].end, '08:40');
  assert.equal((await current()).data.entries[0].day, 2);
  const titles = await page.$$eval('.tt-table tbody tr:not(.tt-break) th', (/** @type {Element[]} */ els) => els.map((el) => el.textContent?.trim()));
  assert.ok(titles[2].startsWith('3.'));
});

test('each member has an independent plan and mobile page contains horizontal scrolling only inside the board', async () => {
  const previous = await current();
  const ids = await page.$$eval('[data-member] option', (/** @type {HTMLOptionElement[]} */ els) => els.map((el) => el.value));
  const next = ids.find((/** @type {string} */ id) => id !== previous.id);
  assert.ok(next);
  await page.select('[data-member]', next);
  await page.waitForFunction(() => document.querySelectorAll('[data-palette] .tt-card').length === 0);
  const other = await current();
  assert.equal(other.data.subjects.length, 0); assert.equal(other.data.entries.length, 0);
  await page.setViewport({ width: 390, height: 844 });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, board: document.querySelector('.tt-scroll')?.scrollWidth }));
  assert.ok(layout.width <= layout.viewport + 1);
  assert.ok(layout.board > layout.viewport);
});
