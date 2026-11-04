/* ui/dom.js — tiny DOM helpers shared by the shell and the views. */

import { escapeHtml } from '../format.js';
import { t } from '../i18n.js';

export const esc = escapeHtml;

export function icon(name, extra = '') {
  return `<svg class="${extra}" aria-hidden="true"><use href="#${name}"/></svg>`;
}

/** Parse an HTML string into a DocumentFragment. */
export function frag(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content;
}

export function mount(root, html) {
  root.innerHTML = html;
  return root;
}

export function on(root, selector, event, handler, opts) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  }, opts);
}

export function byId(id) { return document.getElementById(id); }

/** Delegate clicks: data-action="name" data-id="…" */
export function actions(root, map) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !root.contains(btn)) return;
    const fn = map[btn.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(e, btn.dataset, btn);
  });
}

/** Status pill markup used in tables + drawer. */
export function statusPill(status) {
  const map = {
    queued: ['st-queued', 'i-clock'],
    downloading: ['st-downloading', 'i-download'],
    processing: ['st-processing', 'i-cpu'],
    paused: ['st-paused', 'i-pause'],
    completed: ['st-completed', 'i-check'],
    error: ['st-error', 'i-alert'],
    cancelled: ['st-cancelled', 'i-stop'],
  };
  const [cls, ic] = map[status] || ['st-queued', 'i-clock'];
  return `<span class="status-pill ${cls}"><i></i>${icon(ic)}<span>${esc(t(`status.${status}`))}</span></span>`;
}

export function progressBar(percent, extra = '') {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const cls = p >= 100 ? 'done' : extra.includes('err') ? 'err' : '';
  return `<span class="progress ${cls} ${extra}"><i style="width:${p}%"></i></span>`;
}

export function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

export function engineBadge(engine) {
  const kind = engine === 'yt-dlp' ? 'ok' : engine === 'gallery-dl' ? 'info' : 'warn';
  const ic = engine === 'yt-dlp' ? 'i-video' : engine === 'gallery-dl' ? 'i-image' : 'i-file';
  return `<span class="badge ${kind}">${icon(ic)}${esc(engine)}</span>`;
}

export function kindBadge(kind) {
  const ic = { video: 'i-video', audio: 'i-audio', image: 'i-image', file: 'i-file' }[kind] || 'i-file';
  return `<span class="badge plain">${icon(ic)}${esc(t(`kind.${kind}`))}</span>`;
}
