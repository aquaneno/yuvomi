/** Execute the tag editor with controlled API/modal boundaries; no browser required. */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { openPaperlessTags } from '../public/components/paperless-tags.js';

const path = '/documents/dms/paperless/documents/1/tags';
const assigned = (canEdit = true) => ({ data: {
  tags: [{ id: 7, name: 'House' }, { id: 999, name: 'Hidden tag' }],
  tag_ids: [7, 999], can_edit: canEdit, account_id: canEdit ? 1 : undefined,
} });
const catalogue = (page) => ({ data: [
  [{ id: 7, name: 'House' }],
  [{ id: 151, name: '<Another>' }],
  [{ id: 152, name: 'Last page tag' }],
][page - 1], meta: { has_more: page < 3 } });
async function until(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('tag editor did not reach the expected state');
}
function editor(get) {
  const controls = new Map();
  const control = (selector) => {
    if (!controls.has(selector)) controls.set(selector, {
      value: '', disabled: false, hidden: true, innerHTML: '', textContent: '',
      replaceChildren() { this.innerHTML = ''; },
      insertAdjacentHTML(_position, html) { this.innerHTML += html; },
      listeners: new Map(),
      addEventListener(event, handler) { this.listeners.set(event, handler); },
      async emit(event, target) { await this.listeners.get(event)?.({ target, preventDefault() {} }); },
    });
    return controls.get(selector);
  };
  const writes = [];
  let closed = false;
  globalThis.__apiStub = { get, put: async (url, body) => { writes.push({ url, body }); return {}; } };
  globalThis.__openModal = (options) => options.onSave({ querySelector: control });
  globalThis.__closeModal = () => { closed = true; };
  openPaperlessTags({ path, title: 'Receipt' });
  return { control, writes, closed: () => closed };
}
afterEach(() => {
  delete globalThis.__apiStub;
  delete globalThis.__openModal;
  delete globalThis.__closeModal;
  delete globalThis.__modalContextId;
});

test('all pages load before editing; names/IDs are visible and searchable; hidden assignments survive', async () => {
  const pages = [];
  let finishLastPage;
  const lastPage = new Promise((resolve) => { finishLastPage = resolve; });
  const ui = editor(async (url) => {
    if (url === path) return assigned();
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    pages.push(page);
    return page === 3 ? lastPage : catalogue(page);
  });
  await until(() => pages.length === 3);
  assert.equal(ui.control('[type="submit"]').disabled, true);
  assert.equal(ui.control('fieldset').disabled, true);
  finishLastPage(catalogue(3));
  await until(() => !ui.control('[type="submit"]').disabled);
  assert.deepEqual(pages, [1, 2, 3]);
  const list = ui.control('[data-pl-tag-list]');
  assert.match(list.innerHTML, /House \(ID: 7\)/);
  assert.match(list.innerHTML, /Last page tag \(ID: 152\)/);
  assert.match(list.innerHTML, /&lt;Another&gt; \(ID: 151\)/);
  assert.doesNotMatch(list.innerHTML, /<Another>/);
  const search = ui.control('#pl-tag-search');
  search.value = '#152';
  await search.emit('input');
  assert.match(list.innerHTML, /Last page tag/);
  assert.doesNotMatch(list.innerHTML, /House/);
  await list.emit('change', { value: '152', checked: true, matches: () => true });
  search.value = 'hOuSe';
  await search.emit('input');
  assert.match(list.innerHTML, /House/);
  assert.doesNotMatch(list.innerHTML, /Last page tag/);
  await ui.control('form').emit('submit');
  assert.deepEqual(ui.writes, [{ url: path, body: { tags: [7, 999, 152], expected_tags: [7, 999] } }]);
  assert.equal(ui.closed(), true);
});

test('failed catalogue page disables saving; refresh retries from page one', async () => {
  const pages = [];
  let fail = true;
  const ui = editor(async (url) => {
    if (url === path) return assigned();
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    pages.push(page);
    if (page === 2 && fail) { fail = false; throw new Error('offline'); }
    return catalogue(page);
  });
  await until(() => !ui.control('[data-pl-tag-error]').hidden);
  assert.equal(ui.control('[type="submit"]').disabled, true);
  await ui.control('form').emit('submit');
  assert.deepEqual(ui.writes, []);
  await ui.control('[data-pl-tag-reload]').emit('click');
  assert.deepEqual(pages, [1, 2, 1, 2, 3]);
  assert.equal(ui.control('[type="submit"]').disabled, false);
  assert.match(ui.control('[data-pl-tag-list]').innerHTML, /Last page tag \(ID: 152\)/);
});

test('readers see assigned names and IDs without requesting the global catalogue', async () => {
  const requests = [];
  const ui = editor(async (url) => { requests.push(url); return assigned(false); });
  await until(() => ui.control('[data-pl-tag-list]').innerHTML.includes('House'));
  assert.deepEqual(requests, [path]);
  assert.match(ui.control('[data-pl-tag-list]').innerHTML, /House \(ID: 7\)/);
  assert.equal(ui.control('[type="submit"]').hidden, true);
  assert.equal(ui.control('fieldset').disabled, true);
  await ui.control('form').emit('submit');
  assert.deepEqual(ui.writes, []);
});

test('closing the modal during loading prevents subsequent page requests', async () => {
  let context = 1;
  globalThis.__modalContextId = () => context;
  const requests = [];
  let finishPage;
  const pendingPage = new Promise((resolve) => { finishPage = resolve; });
  const ui = editor(async (url) => {
    requests.push(url);
    return url === path ? assigned() : pendingPage;
  });
  await until(() => requests.length === 2);
  context++;
  finishPage(catalogue(1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(ui.control('[type="submit"]').disabled, true);
});
