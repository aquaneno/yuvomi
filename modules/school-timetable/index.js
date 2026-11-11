/** School timetable: one weekly board and subject palette per household member. */
import { createApi } from './api.js';
import { renderPageHeader, renderPageTitle, renderPageBody, renderPageSection } from './page-layout.js';
import { newId } from './model.js';
import { t } from '/i18n.js';
import { esc, REQUIRED_MARK } from '/utils/html.js';
import { openModal, closeModal, confirmOverModal, captureModalContext, closeDialogs } from './dialog.js';
import { sortableSet } from './sortable.js';
import { defaultTimetable, timetableError, minuteOfDay, clock } from './model.js';
/** @typedef {import('./model.js').Timetable} Timetable */
/** @typedef {import('./model.js').TimetableSubject} Subject */
/** @typedef {import('./model.js').TimetableSlot} Slot */

/** @param {HTMLElement} container @param {{user?:any, signal?:AbortSignal}} options */
export async function render(container, { user, signal } = {}) {
  const api = createApi(signal);
  const scope = sortableSet();
  const events = new AbortController();
  const listen = (element, type, callback, options = {}) => element?.addEventListener(type, callback, { ...options, signal: events.signal });
  let active = !signal?.aborted;
  let busy = false;
  let generation = 0;
  let memberId = 0;
  let revision = 0;
  let editable = false;
  let selected = '';
  let moving = '';
  let movingDay = 0;
  let conflict = false;
  /** @type {Timetable} */
  let plan = defaultTimetable();
  /** @type {{id:number, display_name:string, can_edit:boolean}[]} */
  let members = [];
  const canEdit = () => editable && !busy && !conflict;
  const dialogs = new Set();
  const cleanup = () => { active = false; generation++; scope.clear(); events.abort(); closeDialogs(); dialogs.clear(); container.classList.remove('timetable-page'); };
  const openDialog = (options) => { const dialog = openModal(options); dialogs.add(dialog); dialog.addEventListener('close', () => dialogs.delete(dialog), { once: true }); };
  container.classList.add('timetable-page');
  signal?.addEventListener('abort', cleanup, { once: true });
  if (!active) { cleanup(); return cleanup; }
  /** @param {string} key */
  const label = (key) => esc(t(`extensions.school-timetable.${key}`));
  /** @param {number} day */
  const dayName = (day) => new Intl.DateTimeFormat(document.documentElement.lang || 'de', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, day + 1)));
  /** @param {string} message */
  function status(message) {
    const el = container.querySelector('[data-status]');
    if (el) el.textContent = message;
  }
  /** @param {unknown} err */
  function errorMessage(err) {
    const reason = /** @type {any} */ (err)?.data?.reason;
    if (reason === 'timetable_conflict') return t('extensions.school-timetable.conflict');
    if (reason === 'timetable_times') return t('extensions.school-timetable.timesError');
    return [404, 502, 503, 504].includes(/** @type {any} */ (err)?.status) ? t('extensions.school-timetable.dependencyError') : t('common.errorGeneric');
  }
  /** @param {Timetable} candidate */
  async function save(candidate) {
    if (!active || !canEdit()) return false;
    const reason = timetableError(candidate);
    if (reason) { status(t(reason === 'timetable_times' ? 'extensions.school-timetable.timesError' : 'extensions.school-timetable.invalid')); return false; }
    busy = true;
    scope.clear();
    const root = container.querySelector('[data-workspace]');
    if (root instanceof HTMLElement) root.inert = true;
    status(t('common.loading'));
    const targetMember = memberId;
    try {
      const answer = await api.put(`/${targetMember}`, { data: candidate, revision });
      if (!active || memberId !== targetMember) return false;
      plan = answer.data;
      revision = answer.revision;
      busy = false;
      moving = '';
      paint();
      status(t('extensions.school-timetable.saved'));
      return true;
    } catch (err) {
      if (!active) return false;
      busy = false;
      conflict = /** @type {any} */ (err)?.status === 409;
      paint();
      status(errorMessage(err));
      return false;
    }
  }
  /** @param {Subject} subject @param {boolean} palette */
  function card(subject, palette) {
    return `<div class="tt-card" data-subject="${esc(subject.id)}" style="--subject-color:${esc(subject.color)}">
      ${canEdit() ? `<span class="tt-drag" aria-hidden="true">⠿</span>` : ''}
      <span class="tt-card__text"><strong>${esc(subject.name)}</strong><span>${esc([subject.teacher, subject.room].filter(Boolean).join(' · '))}</span></span>
      ${canEdit() && palette ? `<button class="btn btn--ghost tt-select" data-select="${esc(subject.id)}" aria-pressed="${selected === subject.id}" aria-label="${label('choose')}: ${esc(subject.name)}">${label('choose')}</button><button class="btn btn--ghost" data-edit="${esc(subject.id)}" aria-label="${esc(t('common.editNamed', { name: subject.name }))}">${esc(t('common.edit'))}</button>` : ''}
    </div>`;
  }
  function paint() {
    if (!active) return;
    scope.clear();
    let lesson = 0;
    const rows = plan.slots.map((slot) => {
      const title = slot.kind === 'break' ? label('break') : `${++lesson}. ${label('lesson')}`;
      if (slot.kind === 'break') return `<tr class="tt-break"><th scope="row">${title}<small>${esc(slot.start)} - ${esc(slot.end)}</small></th><td colspan="${plan.days}">${label('break')}</td></tr>`;
      const cells = Array.from({ length: plan.days }, (_, i) => {
        const day = i + 1;
        const entry = plan.entries.find((e) => e.day === day && e.slot_id === slot.id);
        const subject = plan.subjects.find((s) => s.id === entry?.subject_id);
        const name = `${dayName(day)}, ${title.replace(/<[^>]*>/g, '')}, ${slot.start} - ${slot.end}`;
        return `<td><div class="tt-cell" data-slot="${esc(slot.id)}" data-day="${day}">${subject ? card(subject, false) : ''}</div>
          ${canEdit() ? `<button class="tt-cell-action" data-place="${esc(slot.id)}" data-day="${day}" aria-label="${esc(name)}: ${subject ? esc(subject.name) : label('free')}">${subject ? esc(t('common.edit')) : label('place')}</button>` : ''}</td>`;
      }).join('');
      return `<tr><th scope="row">${title}<small>${esc(slot.start)} - ${esc(slot.end)}</small></th>${cells}</tr>`;
    }).join('');
    container.replaceChildren();
    container.insertAdjacentHTML('beforeend', renderPageHeader({ title: renderPageTitle(esc(t('extensions.school-timetable.menu'))) }) + renderPageBody({ content: renderPageSection({ content: `
      <p data-status role="status" aria-live="polite"></p>
      ${conflict ? `<button class="btn btn--primary" data-reload>${esc(t('common.retry'))}</button>` : ''}
      <div data-workspace>
        <div class="tt-toolbar"><label>${label('member')}<select class="form-input" data-member>${members.map((m) => `<option value="${m.id}" ${m.id === memberId ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select></label>
          ${canEdit() ? `<button class="btn btn--secondary" data-times>${label('times')}</button><button class="btn btn--primary" data-new>${label('addSubject')}</button>` : ''}
        </div>
        <p class="form-hint">${canEdit() ? label('hint') : label('readOnly')}</p>
        <div class="tt-layout">
          <aside class="tt-palette" aria-label="${label('subjects')}"><h2>${label('subjects')}</h2>
            <div data-palette>${plan.subjects.map((s) => card(s, true)).join('')}</div>
            ${plan.subjects.length ? '' : `<p class="form-hint">${label('empty')}</p>`}
            ${selected ? `<p class="form-hint">${esc(plan.subjects.find((s) => s.id === selected)?.name ?? '')} · ${label('place')}</p><button class="btn btn--ghost" data-cancel-selection>${esc(t('common.cancel'))}</button>` : ''}
          </aside>
          <div class="tt-scroll" tabindex="0" role="region" aria-label="${esc(t('extensions.school-timetable.menu'))}"><table class="tt-table"><caption class="sr-only">${esc(members.find((m) => m.id === memberId)?.display_name ?? '')}</caption>
            <thead><tr><th scope="col">${label('lesson')}</th>${Array.from({ length: plan.days }, (_, i) => `<th scope="col">${esc(dayName(i + 1))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>
    ` }) }));
    listen(container.querySelector('[data-member]'), 'change', (event) => {
      const id = Number(/** @type {HTMLSelectElement} */ (event.target).value);
      void load(id);
    });
    listen(container.querySelector('[data-reload]'), 'click', () => { void load(memberId); });
    listen(container.querySelector('[data-new]'), 'click', () => subjectDialog());
    listen(container.querySelector('[data-times]'), 'click', timeDialog);
    listen(container.querySelector('[data-cancel-selection]'), 'click', () => { selected = ''; moving = ''; paint(); });
    container.querySelectorAll('[data-select]').forEach((el) => listen(el, 'click', () => {
      selected = el.getAttribute('data-select') ?? ''; moving = ''; paint();
      container.querySelector('button[data-place]')?.scrollIntoView({ block: 'nearest' });
    }));
    container.querySelectorAll('[data-edit]').forEach((el) => listen(el, 'click', () => subjectDialog(el.getAttribute('data-edit') ?? '')));
    container.querySelectorAll('[data-place]').forEach((el) => listen(el, 'click', () => {
      const slotId = el.getAttribute('data-place') ?? '';
      const day = Number(el.getAttribute('data-day'));
      if (selected && !plan.entries.some((e) => e.day === day && e.slot_id === slotId)) { void place(day, slotId, selected, movingDay, moving); }
      else assignmentDialog(day, slotId);
    }));
    if (canEdit()) wireDrag();
  }
  /** @param {number} day @param {string} slotId @param {string} subjectId @param {number} [fromDay] @param {string} [fromSlot] */
  async function place(day, slotId, subjectId, fromDay = 0, fromSlot = '') {
    const candidate = structuredClone(plan);
    candidate.entries = candidate.entries.filter((e) => !(e.day === day && e.slot_id === slotId) && !(e.day === fromDay && e.slot_id === fromSlot));
    candidate.entries.push({ day, slot_id: slotId, subject_id: subjectId });
    return save(candidate);
  }
  function wireDrag() {
    /** @param {any} evt */
    const dropped = (evt) => {
      const day = Number(evt.to.dataset.day);
      const slotId = evt.to.dataset.slot;
      if (!day || !slotId) { paint(); return; }
      // Let Sortable finish its own cleanup before replacing the DOM.
      queueMicrotask(() => { void place(day, slotId, evt.item.dataset.subject, Number(evt.from.dataset.day), evt.from.dataset.slot); });
    };
    const palette = container.querySelector('[data-palette]');
    if (palette instanceof HTMLElement) void scope.add(palette, { handle: '.tt-drag', draggable: '.tt-card', group: { name: 'timetable', pull: 'clone', put: false }, sort: false, onEnd: dropped }).catch(() => { if (active) status(t('extensions.school-timetable.hint')); });
    container.querySelectorAll('[data-slot]').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      void scope.add(el, { handle: '.tt-drag', draggable: '.tt-card', group: { name: 'timetable', put: () => !el.querySelector('.tt-card') }, sort: false, onEnd: dropped }).catch(() => { if (active) status(t('extensions.school-timetable.hint')); });
    });
  }
  /** @param {string} [subjectId] */
  function subjectDialog(subjectId = '') {
    if (!canEdit()) return;
    const existing = plan.subjects.find((s) => s.id === subjectId);
    if (!existing && plan.subjects.length >= 60) { status(t('extensions.school-timetable.limit')); return; }
    const draft = existing ?? { id: newId(), name: '', teacher: '', room: '', color: '#0891B2' };
    const openedFor = memberId;
    openDialog({ title: existing ? draft.name : t('extensions.school-timetable.addSubject'), content: `<form data-subject-form>
      <div class="form-group"><label class="form-label" for="tt-name">${esc(t('common.nameLabel'))}${REQUIRED_MARK}</label><input class="form-input" id="tt-name" name="name" required maxlength="80" value="${esc(draft.name)}"></div>
      <div class="form-group"><label class="form-label" for="tt-teacher">${label('teacher')}</label><input class="form-input" id="tt-teacher" name="teacher" maxlength="120" value="${esc(draft.teacher)}"></div>
      <div class="form-group"><label class="form-label" for="tt-room">${label('room')}</label><input class="form-input" id="tt-room" name="room" maxlength="80" value="${esc(draft.room)}"></div>
      <div class="form-group"><label class="form-label" for="tt-color">${esc(t('extensions.school-timetable.color'))}</label><input id="tt-color" name="color" type="color" value="${esc(draft.color)}"></div>
      <p role="alert" data-error></p><div class="modal-panel__footer">${existing ? `<button class="btn btn--danger-outline" type="button" data-delete>${esc(t('common.delete'))}</button>` : ''}<button class="btn btn--secondary" type="button" data-cancel>${esc(t('common.cancel'))}</button><button class="btn btn--primary" type="submit">${esc(t(existing ? 'common.save' : 'common.add'))}</button></div></form>`,
      onSave: (/** @type {HTMLElement} */ panel) => {
        const context = captureModalContext();
        listen(panel.querySelector('[data-cancel]'), 'click', () => { void closeModal({ context }); });
        const form = /** @type {HTMLFormElement} */ (panel.querySelector('form'));
        listen(form, 'submit', async (event) => {
          event.preventDefault();
          if (memberId !== openedFor || !canEdit() || !form.reportValidity()) return;
          const nameInput = form.elements.namedItem('name');
          if (!nameInput.value.trim()) { nameInput.setCustomValidity(t('extensions.school-timetable.invalid')); nameInput.reportValidity(); listen(nameInput, 'input', () => nameInput.setCustomValidity(''), { once: true }); return; }
          const fields = new FormData(form);
          const candidate = structuredClone(plan);
          const value = { id: draft.id, name: String(fields.get('name') ?? '').trim(), teacher: String(fields.get('teacher') ?? '').trim(), room: String(fields.get('room') ?? '').trim(), color: String(fields.get('color')) };
          candidate.subjects = [...candidate.subjects.filter((s) => s.id !== draft.id), value];
          if (await save(candidate)) await closeModal({ force: true, context });
          else { const error = panel.querySelector('[data-error]'); if (error) error.textContent = container.querySelector('[data-status]')?.textContent || t('extensions.school-timetable.invalid'); }
        });
        listen(panel.querySelector('[data-delete]'), 'click', async () => {
          const confirmed = await confirmOverModal(t('common.deleteNamed', { name: draft.name }), { danger: true, confirmLabel: t('common.delete'), detail: t('extensions.school-timetable.removeHint'), closeOnConfirm: false });
          if (!confirmed || !active || memberId !== openedFor || !canEdit()) return;
          const candidate = structuredClone(plan);
          candidate.subjects = candidate.subjects.filter((s) => s.id !== draft.id);
          candidate.entries = candidate.entries.filter((e) => e.subject_id !== draft.id);
          if (selected === draft.id) selected = '';
          if (await save(candidate)) await closeModal({ force: true, context });
        });
      },
    });
  }
  /** @param {number} day @param {string} slotId */
  function assignmentDialog(day, slotId) {
    if (!canEdit()) return;
    const openedFor = memberId;
    const entry = plan.entries.find((e) => e.day === day && e.slot_id === slotId);
    openDialog({ title: dayName(day), content: `<form><div class="form-group"><label class="form-label" for="tt-subject">${label('subjects')}</label><select class="form-input" id="tt-subject" name="subject"><option value="">${label('free')}</option>${plan.subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === entry?.subject_id ? 'selected' : ''}>${esc(s.name)}${s.teacher ? ` · ${esc(s.teacher)}` : ''}</option>`).join('')}</select></div>
      <p role="alert" data-error></p><div class="modal-panel__footer">${entry ? `<button class="btn btn--secondary" type="button" data-move>${label('move')}</button>` : ''}<button class="btn btn--secondary" type="button" data-cancel>${esc(t('common.cancel'))}</button><button class="btn btn--primary" type="submit">${esc(t('common.save'))}</button></div></form>`,
      onSave: (/** @type {HTMLElement} */ panel) => {
        const context = captureModalContext();
        listen(panel.querySelector('[data-cancel]'), 'click', () => { void closeModal({ context }); });
        listen(panel.querySelector('[data-move]'), 'click', () => {
          if (!entry || memberId !== openedFor || !canEdit()) return;
          selected = entry.subject_id; moving = slotId; movingDay = day; void closeModal({ force: true, context }); paint();
        });
        listen(panel.querySelector('form'), 'submit', async (event) => {
          event.preventDefault();
          if (memberId !== openedFor || !canEdit()) return;
          const id = /** @type {HTMLSelectElement} */ (panel.querySelector('select')).value;
          const candidate = structuredClone(plan);
          candidate.entries = candidate.entries.filter((e) => !(e.day === day && e.slot_id === slotId));
          if (id) candidate.entries.push({ day, slot_id: slotId, subject_id: id });
          if (await save(candidate)) await closeModal({ force: true, context });
          else { const error = panel.querySelector('[data-error]'); if (error) error.textContent = conflict ? t('extensions.school-timetable.conflict') : t('common.errorGeneric'); }
        });
      },
    });
  }
  function timeDialog() {
    if (!canEdit()) return;
    const openedFor = memberId;
    const candidate = structuredClone(plan);
    openDialog({ title: t('extensions.school-timetable.times'), size: 'lg', content: `<form><div class="form-group"><label class="form-label" for="tt-days">${label('days')}</label><select id="tt-days" class="form-input" name="days">${[5, 6, 7].map((n) => `<option value="${n}" ${candidate.days === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div data-slots></div><div class="tt-toolbar"><button type="button" class="btn btn--secondary" data-add="lesson">${label('addLesson')}</button><button type="button" class="btn btn--secondary" data-add="break">${label('addBreak')}</button></div>
      <p class="form-hint">${label('removeHint')}</p><p role="alert" data-error></p><div class="modal-panel__footer"><button class="btn btn--secondary" type="button" data-cancel>${esc(t('common.cancel'))}</button><button class="btn btn--primary" type="submit">${esc(t('common.save'))}</button></div></form>`,
      onSave: (/** @type {HTMLElement} */ panel) => {
        const context = captureModalContext();
        listen(panel.querySelector('[data-cancel]'), 'click', () => { void closeModal({ context }); });
        const list = /** @type {HTMLElement} */ (panel.querySelector('[data-slots]'));
        const drawSlots = () => {
          let number = 0;
          list.replaceChildren();
          list.insertAdjacentHTML('beforeend', candidate.slots.map((s) => {
            const title = s.kind === 'lesson' ? `${++number}. ${t('extensions.school-timetable.lesson')}` : t('extensions.school-timetable.break');
            return `<div class="tt-time-row" data-row="${esc(s.id)}"><strong>${esc(title)}</strong><label>${esc(t('extensions.school-timetable.startTime'))}<input class="form-input" type="time" required data-start value="${esc(s.start)}" aria-label="${esc(title)}: ${esc(t('extensions.school-timetable.startTime'))}"></label><label>${esc(t('extensions.school-timetable.endTime'))}<input class="form-input" type="time" required data-end value="${esc(s.end)}" aria-label="${esc(title)}: ${esc(t('extensions.school-timetable.endTime'))}"></label><button type="button" class="btn btn--ghost" data-remove="${esc(s.id)}" aria-label="${esc(t('common.removeNamed', { name: title }))}">${esc(t('common.delete'))}</button></div>`;
          }).join(''));
          list.querySelectorAll('[data-remove]').forEach((el) => listen(el, 'click', () => {
            readSlots(); candidate.slots = candidate.slots.filter((s) => s.id !== el.getAttribute('data-remove')); drawSlots();
          }));
        };
        const readSlots = () => {
          list.querySelectorAll('[data-row]').forEach((row) => {
            const slot = candidate.slots.find((s) => s.id === row.getAttribute('data-row'));
            if (!slot) return;
            slot.start = /** @type {HTMLInputElement} */ (row.querySelector('[data-start]')).value;
            slot.end = /** @type {HTMLInputElement} */ (row.querySelector('[data-end]')).value;
          });
        };
        drawSlots();
        panel.querySelectorAll('[data-add]').forEach((el) => listen(el, 'click', () => {
          if (candidate.slots.length >= 30) return;
          readSlots();
          const start = minuteOfDay(candidate.slots.at(-1)?.end ?? '08:00');
          const kind = el.getAttribute('data-add') === 'break' ? 'break' : 'lesson';
          candidate.slots.push({ id: newId(), kind, start: clock(Math.min(start, 1438)), end: clock(Math.min(start + (kind === 'break' ? 15 : 45), 1439)) });
          drawSlots();
        }));
        listen(panel.querySelector('form'), 'submit', async (event) => {
          event.preventDefault();
          if (memberId !== openedFor || !canEdit()) return;
          readSlots();
          candidate.days = Number(/** @type {HTMLSelectElement} */ (panel.querySelector('[name="days"]')).value);
          candidate.entries = candidate.entries.filter((e) => e.day <= candidate.days && candidate.slots.some((s) => s.id === e.slot_id));
          const reason = timetableError(candidate);
          const error = panel.querySelector('[data-error]');
          if (reason) { if (error) error.textContent = t('extensions.school-timetable.timesError'); return; }
          if (await save(candidate)) await closeModal({ force: true, context });
          else if (error) error.textContent = conflict ? t('extensions.school-timetable.conflict') : t('common.errorGeneric');
        });
      },
    });
  }
  /** @param {number} id */
  async function load(id) {
    if (busy || !active) return;
    const request = ++generation;
    scope.clear();
    editable = false;
    selected = ''; moving = ''; conflict = false;
    container.replaceChildren();
    container.insertAdjacentHTML('beforeend', `<p role="status">${esc(t('common.loading'))}</p>`);
    try {
      const answer = await api.get(`/${id}`, { signal });
      if (!active || request !== generation) return;
      memberId = id; revision = answer.revision; plan = answer.data; editable = answer.can_edit;
      paint();
    } catch (err) {
      if (!active || request !== generation) return;
      container.replaceChildren();
      container.insertAdjacentHTML('beforeend', `<p role="alert">${esc(errorMessage(err))}</p><button class="btn btn--primary">${esc(t('common.retry'))}</button>`);
      listen(container.querySelector('button'), 'click', () => { void load(id); });
    }
  }
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `<p role="status">${esc(t('common.loading'))}</p>`);
  try {
    const answer = await api.get('/members', { signal });
    if (!active) return cleanup;
    members = answer.data;
    const initial = members.find((m) => m.id === user?.id) ?? members[0];
    if (initial) await load(initial.id);
    else container.textContent = t('extensions.school-timetable.noMembers');
  } catch (err) {
    if (active) {
      container.textContent = errorMessage(err);
      const retry = document.createElement('button');
      retry.className = 'btn btn--primary'; retry.textContent = t('common.retry');
      listen(retry, 'click', () => { cleanup(); void render(container, { user, signal }); }, { once: true });
      container.append(retry);
    }
  }
  return cleanup;
}
