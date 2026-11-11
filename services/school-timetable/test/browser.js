/** Real built app: editing subjects, placement, drag movement, time validation and member isolation. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as proxyRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTimetableService, PREFIX } from '../server.js';
import { startHarness, gotoRoute } from '../../../test/document-guards-harness.js';

/** @type {any} */ let harness;
/** @type {any} */ let page;
let proxy, sidecar, publicOrigin;
const directory = mkdtempSync(join(tmpdir(), 'timetable-browser-'));
const errors = [];
before(async () => {
  process.env.MODULES_DIR = fileURLToPath(new URL('../../../modules/', import.meta.url));
  harness = await startHarness();
  let sidecarUrl;
  proxy = createServer((req, res) => {
    // The module tests never ask an external weather service for demo locations.
    if (req.url.startsWith('/api/v1/weather')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data: null, reason: 'not_configured' })); return; }
    const target = new URL(req.url, req.url.startsWith(PREFIX + '/') ? sidecarUrl : harness.baseUrl);
    const outgoing = proxyRequest(target, { method: req.method, headers: req.headers }, (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    outgoing.on('error', () => { res.writeHead(502); res.end('{}'); });
    req.pipe(outgoing);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  publicOrigin = `http://127.0.0.1:${proxy.address().port}`;
  sidecar = createTimetableService({ yuvomiUrl: harness.baseUrl, publicOrigin, dbPath: join(directory, 'module.db'), cacheMs: 0 });
  await new Promise((r) => sidecar.server.listen(0, '127.0.0.1', r));
  sidecarUrl = `http://127.0.0.1:${sidecar.server.address().port}`;
  page = await harness.context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== publicOrigin) { void request.abort(); return; }
    void request.continue();
  });
  await page.setCookie(...harness.cookies);
  page.__yuvomiBase = publicOrigin;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    localStorage.setItem('yuvomi-locale', 'de'); localStorage.setItem('yuvomi-onboarded', '1');
    localStorage.setItem('yuvomi-install-dismissed', String(Date.now()));
  });
});
after(async () => {
  await page?.close(); await sidecar?.close();
  if (proxy) await new Promise((r) => proxy.close(r));
  await harness?.close(); rmSync(directory, { recursive: true, force: true });
});
/** @param {string} method @param {string} path @param {any} [body] */
async function request(method, path, body) {
  return page.evaluate(async (/** @type {any} */ args) => {
    const tokenResponse = await fetch('/api/extensions/school-timetable/session', { cache: 'no-store' });
    const token = tokenResponse.headers.get('X-Timetable-CSRF');
    const response = await fetch(`/api/extensions/school-timetable${args.path}`, { method: args.method, headers: { 'Content-Type': 'application/json', 'X-Timetable-CSRF': token }, body: args.body === undefined ? undefined : JSON.stringify(args.body) });
    return { status: response.status, body: await response.json() };
  }, { method, path, body });
}
async function board() { await gotoRoute(page, '/m/school-timetable'); await page.waitForSelector('[data-palette]'); }
async function current() {
  const id = await page.$eval('[data-member]', (/** @type {HTMLSelectElement} */ el) => el.value);
  return { id, ...(await request('GET', `/${id}`)).body };
}

test('subject with teacher and room persists, is escaped and can be placed by keyboard-compatible controls', async () => {
  await board();
  assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined');
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

test('dragging a subject from the palette clones it into a second lesson', async () => {
  const source = await page.$('[data-palette] .tt-drag');
  const target = await page.$('[data-slot="lesson-3"][data-day="1"]');
  const a = await source.boundingBox(); const b = await target.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 5, { steps: 6 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await page.mouse.up();
  await page.waitForSelector('[data-slot="lesson-3"][data-day="1"] .tt-card');
  const saved = await current();
  assert.equal(saved.data.subjects.length, 1);
  assert.equal(saved.data.entries.length, 2);
  assert.equal(await page.$$eval('[data-palette] .tt-card', (els) => els.length), 1);
});

test('overlapping lesson times cannot be saved, valid changes preserve assignments and numbers skip breaks', async () => {
  await page.click('[data-times]');
  await page.waitForSelector('[data-slots]');
  await page.$eval('[data-row="lesson-1"] [data-end]', (/** @type {HTMLInputElement} */ el) => { el.value = '09:00'; });
  await page.click('.tt-dialog form button[type="submit"]');
  await page.waitForFunction(() => Boolean(document.querySelector('.tt-dialog [data-error]')?.textContent));
  assert.equal((await current()).data.slots[0].end, '08:45');
  await page.$eval('[data-row="lesson-1"] [data-end]', (/** @type {HTMLInputElement} */ el) => { el.value = '08:40'; });
  await page.click('.tt-dialog form button[type="submit"]');
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
  await page.waitForFunction(() => document.querySelector('[data-palette]') && document.querySelectorAll('[data-palette] .tt-card').length === 0);
  const other = await current();
  assert.equal(other.data.subjects.length, 0); assert.equal(other.data.entries.length, 0);
  await page.setViewport({ width: 390, height: 844 });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, board: document.querySelector('.tt-scroll')?.scrollWidth }));
  assert.ok(layout.width <= layout.viewport + 1);
  assert.ok(layout.board > layout.viewport);
  if (process.env.TIMETABLE_SCREENSHOT) await page.screenshot({ path: process.env.TIMETABLE_SCREENSHOT, fullPage: true });
});


test('empty/whitespace subjects are blocked; existing subjects can be edited and deleted', async () => {
  await page.setViewport({ width: 1280, height: 900 });
  await page.click('[data-new]');
  await page.waitForSelector('#tt-name');
  await page.type('#tt-name', '   ');
  await page.click('[data-subject-form] button[type="submit"]');
  assert.equal((await current()).data.subjects.length, 0);
  await page.$eval('#tt-name', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('#tt-name', 'Deutsch');
  await page.type('#tt-teacher', 'Herr Muster');
  await page.click('[data-subject-form] button[type="submit"]');
  await page.waitForSelector('[data-edit]');
  await page.waitForFunction(() => !document.querySelector('.tt-dialog[open]'));
  await page.click('[data-edit]');
  await page.waitForSelector('#tt-room');
  await page.type('#tt-room', 'A203');
  await page.click('[data-subject-form] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.tt-dialog[open]'));
  assert.equal((await current()).data.subjects[0].room, 'A203');
  await page.click('[data-edit]');
  await page.click('[data-delete]');
  await page.waitForSelector('[data-yes]');
  await page.click('[data-yes]');
  await page.waitForFunction(() => document.querySelector('[data-palette]') && document.querySelectorAll('[data-palette] .tt-card').length === 0);
  assert.equal((await current()).data.subjects.length, 0);
});

test('route abort closes open module dialogs; the production build reports no script errors', async () => {
  await page.click('[data-new]');
  await page.waitForSelector('.tt-dialog[open]');
  await page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForFunction(() => !document.querySelector('.tt-dialog[open]'));
  assert.deepEqual(errors, []);
});
