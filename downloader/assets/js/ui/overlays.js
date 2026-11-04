/* ui/overlays.js — toasts, the job detail drawer and modal dialogs. */

import { byId, icon, esc } from './dom.js';
import { t } from '../i18n.js';
import { applyI18n } from '../i18n.js';

/* ── toasts ─────────────────────────────────────────────────────────────── */
export function toast(kind, title, body = '', timeout = 4200) {
  const root = byId('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ic = kind === 'ok' ? 'i-check' : kind === 'err' || kind === 'warn' ? 'i-alert' : 'i-bolt';
  el.innerHTML = `<span class="ico">${icon(ic)}</span><span class="bd"><b></b></span>`;
  el.querySelector('b').textContent = title;
  if (body) {
    const s = document.createElement('span');
    s.textContent = body;
    el.querySelector('.bd').appendChild(s);
  }
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

/* ── drawer ─────────────────────────────────────────────────────────────── */
let drawerOnClose = null;

export function openDrawer({ title, subtitle = '', body = '', foot = '', onClose = null }) {
  const root = byId('drawerRoot');
  byId('drawerTitle').textContent = title;
  byId('drawerSubtitle').textContent = subtitle;
  byId('drawerBody').innerHTML = body;
  byId('drawerFoot').innerHTML = foot;
  root.hidden = false;
  drawerOnClose = onClose;
  applyI18n(root);
  requestAnimationFrame(() => root.querySelector('.drawer')?.focus?.());
  return root;
}

export function closeDrawer() {
  const root = byId('drawerRoot');
  if (!root || root.hidden) return;
  root.hidden = true;
  const cb = drawerOnClose;
  drawerOnClose = null;
  cb?.();
}

export function updateDrawerBody(html) {
  const b = byId('drawerBody');
  if (b && !byId('drawerRoot').hidden) b.innerHTML = html;
}

/* ── modal ──────────────────────────────────────────────────────────────── */
export function openModal({ title, body = '', foot = '', wide = false }) {
  const root = byId('modalRoot');
  byId('modalTitle').textContent = title;
  byId('modalBody').innerHTML = body;
  byId('modalFoot').innerHTML = foot;
  byId('modal').style.width = wide ? 'min(920px,96vw)' : '';
  root.hidden = false;
  applyI18n(root);
  return root;
}

export function closeModal() {
  const root = byId('modalRoot');
  if (root) root.hidden = true;
}

/** Promise-based confirm. */
export function confirmDialog(message, { title = '', okLabel, cancelLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    openModal({
      title: title || t('ui.actions'),
      body: `<p style="font-size:13.5px">${esc(message)}</p>`,
      foot: `<button class="btn ghost" data-m="cancel">${esc(cancelLabel || t('ui.cancel'))}</button>
             <button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(okLabel || t('ui.yes'))}</button>`,
    });
    const root = byId('modalRoot');
    const done = (v) => { root.removeEventListener('click', onClick); closeModal(); resolve(v); };
    const onClick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      done(b.dataset.m === 'ok');
    };
    root.addEventListener('click', onClick);
  });
}

/** Code preview modal with copy + download. */
export function codeModal({ title, filename, code, lang = '' }) {
  openModal({
    title,
    wide: true,
    body: `<div class="row" style="margin-bottom:8px">
        <span class="tag">${esc(filename)}</span>
        <span class="grow"></span>
        <button class="btn sm ghost" data-code-copy>${icon('i-copy')} ${esc(t('ui.copy'))}</button>
        <button class="btn sm primary" data-code-save>${icon('i-download')} ${esc(t('ui.download'))}</button>
      </div>
      <pre class="code" style="max-height:56vh"><code>${esc(code)}</code></pre>`,
    foot: `<button class="btn ghost" data-close-modal>${esc(t('ui.close'))}</button>`,
  });
  const root = byId('modalRoot');
  root.onclick = async (e) => {
    if (e.target.closest('[data-close-modal]')) { closeModal(); root.onclick = null; return; }
    if (e.target.closest('[data-code-copy]')) {
      const { copyText } = await import('../exporters.js');
      const ok = await copyText(code);
      toast(ok ? 'ok' : 'err', ok ? t('ui.copied') : t('ui.copy'), filename);
    }
    if (e.target.closest('[data-code-save]')) {
      const { downloadText } = await import('../exporters.js');
      downloadText(filename, code);
      toast('ok', t('ui.download'), filename);
    }
  };
  void lang;
}
