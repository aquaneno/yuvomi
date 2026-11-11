/** Module-owned native dialogs: no imports of private/hashed core components. */
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

const stack = [];
export function closeDialogs() { for (const dialog of [...stack]) { dialog.close(); dialog.remove(); } }
export function captureModalContext() { return stack.at(-1); }
export function closeModal({ context = stack.at(-1) } = {}) {
  if (context?.isConnected) context.close();
}

export function openModal({ title, content, onSave, size }) {
  const dialog = document.createElement('dialog');
  const previous = document.activeElement;
  dialog.className = `tt-dialog ${size === 'lg' ? 'tt-dialog--large' : ''}`;
  dialog.setAttribute('aria-label', title);
  dialog.insertAdjacentHTML('beforeend', `<header class="tt-dialog__header"><h2>${esc(title)}</h2><button type="button" class="btn btn--ghost" data-dialog-close aria-label="${esc(t('common.cancel'))}">×</button></header><div class="tt-dialog__body">${content}</div>`);
  document.body.append(dialog);
  stack.push(dialog);
  const local = new AbortController();
  const dispose = () => {
    local.abort();
    const index = stack.indexOf(dialog);
    if (index >= 0) stack.splice(index, 1);
    dialog.remove();
    if (previous?.isConnected) previous.focus();
  };
  dialog.addEventListener('close', dispose, { once: true });
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close(), { signal: local.signal });
  dialog.showModal();
  onSave?.(dialog);
  return dialog;
}

export function confirmOverModal(message, { confirmLabel, detail } = {}) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = openModal({ title: message, content: `<p>${esc(detail || '')}</p><div class="tt-dialog__footer"><button class="btn btn--secondary" data-no>${esc(t('common.cancel'))}</button><button class="btn btn--danger" data-yes>${esc(confirmLabel || t('common.delete'))}</button></div>` });
    dialog.addEventListener('close', () => resolve(confirmed), { once: true });
    dialog.querySelector('[data-yes]').onclick = () => { confirmed = true; dialog.close(); };
    dialog.querySelector('[data-no]').onclick = () => dialog.close();
  });
}
