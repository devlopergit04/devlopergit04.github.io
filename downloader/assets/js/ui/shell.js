/* ui/shell.js — application chrome: router, topbar, sidebar, status bar,
   theme/language handling, live-mode connection and keyboard shortcuts. */

import { state, save, updateSettings, subscribe } from '../store.js';
import { t, setLang, getLang, applyI18n } from '../i18n.js';
import { VIEWS, DEFAULT_ROUTE, ROUTES } from './views/index.js';
import {
  aggregates, statusMessage, sampleTick, syncLive, startFree, pause, resume, retry,
  applySnapshot, applyEvent,
} from '../jobs.js';
import { fmtBytes, fmtSpeed, digits } from '../format.js';
import { sharedClient } from '../api.js';
import { toast } from './overlays.js';
import * as L from '../logs.js';

let currentView = null;
let liveStream = null;
let healthTimer = null;

const $ = (sel) => document.querySelector(sel);

/* ═══════════════ boot ═══════════════ */

export function initShell() {
  applyLang(state.settings.lang, { persist: false });
  applyTheme(state.settings.theme, { persist: false });
  bindTopbar();
  bindOverlays();
  bindSidebar();
  bindShortcuts();
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('resize', () => currentView?.tick?.());

  subscribe(() => { updateStatusbar(); updateBadges(); });

  if (state.settings.mode === 'live') connectLive({ silent: true });
  onHashChange();
  updateStatusbar();
  updateBadges();
  L.info('panel', `panel ready — mode=${state.settings.mode} lang=${state.settings.lang}`, { force: true });
}

/* ═══════════════ router ═══════════════ */

function routeFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  return ROUTES.includes(raw) ? raw : DEFAULT_ROUTE;
}

function onHashChange() {
  const route = routeFromHash();
  state.ui.route = route;
  renderRoute();
}

export function renderRoute() {
  const route = state.ui.route;
  const view = VIEWS[route] || VIEWS[DEFAULT_ROUTE];
  const host = $('#view');

  currentView?.unmount?.();
  host.innerHTML = view.render();
  applyI18n(host);
  view.mount?.(host);
  currentView = view;

  /* chrome sync */
  $('#viewTitle').textContent = view.title();
  $('#viewSubtitle').textContent = view.sub();
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('is-active', a.dataset.route === route));
  document.title = `${view.title()} — Downloader Bot`;
  host.scrollTop = 0;

  if (route === 'queue') {
    const ta = host.querySelector('#urlInput');
    if (ta && window.innerWidth > 900 && !location.hash.includes('noFocus')) setTimeout(() => ta.focus(), 60);
  }
  updateStatusbar();
  updateBadges();
}

export function tickFast() { currentView?.tickFast?.(); }
export function tickSlow() {
  const agg = sampleTick();
  currentView?.tick?.();
  updateStatusbar(agg);
  updateBadges(agg);
}

/* ═══════════════ chrome updates ═══════════════ */

export function updateStatusbar(agg = aggregates()) {
  const msg = $('#sbMessage');
  const text = statusMessage(agg);
  if (msg && msg.textContent !== text) msg.textContent = text;
  const set = (id, v) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };
  set('#sbActive', digits(agg.active));
  set('#sbQueued', digits(agg.queued));
  set('#sbDone', digits(agg.completed));
  set('#sbSpeed', fmtSpeed(agg.speedBps));
  const dir = $('#sbDir');
  if (dir) dir.textContent = `📁 ${state.settings.downloadDir} · ${fmtBytes(state.stats.totalBytes)}`;
}

export function updateBadges(agg = aggregates()) {
  const qb = $('#navQueueBadge');
  const pending = agg.active + agg.queued;
  if (qb) { qb.hidden = pending === 0; qb.textContent = digits(pending); }
  const lb = $('#navLogBadge');
  const errs = state.logs.filter((l) => l.level === 'ERROR').length;
  if (lb) { lb.hidden = errs === 0; lb.textContent = digits(errs); }
  const footer = $('#modeLabelFooter');
  if (footer) footer.textContent = state.settings.mode;
  /* engine strip glow */
  const busyEngines = new Set(state.jobs.filter((j) => j.status === 'downloading').map((j) => j.engine));
  document.querySelectorAll('.engine-pill').forEach((p) => p.classList.toggle('is-busy', busyEngines.has(p.dataset.engine)));
}

export function setConnection(ok, label) {
  const chip = $('#connChip');
  const dot = $('#connDot');
  const text = $('#connText');
  if (!chip) return;
  chip.classList.toggle('is-ok', ok === true);
  chip.classList.toggle('is-off', ok === false);
  chip.classList.toggle('is-warn', ok === 'warn');
  if (text) text.textContent = label;
  void dot;
}

/* ═══════════════ topbar ═══════════════ */

function bindTopbar() {
  $('#modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.settings.mode) return;
    updateSettings({ mode });
    document.querySelectorAll('#modeSwitch .seg-btn').forEach((b) => b.classList.toggle('is-on', b === btn));
    toast('info', t('toast.modeChanged', { mode: t(`mode.${mode}`) }));
    L.info('panel', `mode → ${mode}`, { force: true });
    if (mode === 'live') connectLive();
    else { disconnectLive(); state.ui.connOk = false; paintConnection(); }
    renderRoute();
  });

  $('#langBtn').addEventListener('click', () => {
    const next = getLang() === 'fa' ? 'en' : 'fa';
    applyLang(next);
    toast('info', t('toast.langChanged'), next === 'fa' ? 'فارسی' : 'English');
  });

  $('#themeBtn').addEventListener('click', () => {
    applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
  });

  document.addEventListener('panel:lang', () => applyLang(state.settings.lang, { persist: false }));
  document.addEventListener('panel:theme', () => applyTheme(state.settings.theme, { persist: false }));
  document.addEventListener('panel:conn', () => paintConnection());
  document.addEventListener('panel:reset', () => { applyLang(state.settings.lang, { persist: false }); applyTheme(state.settings.theme, { persist: false }); renderRoute(); });

  paintConnection();
}

export function applyLang(lang, { persist = true } = {}) {
  setLang(lang);
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  applyI18n(document);
  if (persist) updateSettings({ lang });
  else state.settings.lang = lang;
  /* every view paints its own translated strings imperatively → re-render */
  if (currentView) renderRoute();
  paintConnection();
  updateStatusbar();
}

export function applyTheme(theme, { persist = true } = {}) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#021a15' : '#eef7f2');
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = `<svg><use href="#${theme === 'dark' ? 'i-moon' : 'i-sun'}"/></svg>`;
  if (persist) updateSettings({ theme });
  else state.settings.theme = theme;
  /* charts read CSS variables → redraw on the next frame */
  requestAnimationFrame(() => currentView?.tick?.());
}

function paintConnection() {
  if (state.settings.mode === 'demo') {
    /* a successful backend test is worth showing even while simulating */
    setConnection(state.ui.connOk ? true : 'warn', t('conn.demo'));
    return;
  }
  setConnection(state.ui.connOk ? true : false, state.ui.connOk ? t('conn.liveOk') : t('conn.liveOff'));
}

/* ═══════════════ live backend ═══════════════ */

export function connectLive({ silent = false } = {}) {
  disconnectLive();
  sharedClient.setConfig({ baseUrl: state.settings.apiUrl, token: state.settings.apiToken });
  state.ui.connOk = false;
  paintConnection();

  const check = async () => {
    try {
      const h = await sharedClient.health();
      const was = state.ui.connOk;
      state.ui.connOk = true;
      state.ui.health = h;
      save();
      paintConnection();
      L.success('api', `GET /api/health → ok (bot=${h?.bot || '?'}, ffmpeg=${h?.engines?.ffmpeg || '?'})`);
      if (!was && !silent) toast('ok', t('toast.connOk'), state.settings.apiUrl);
      await syncLive();
      startFree();
    } catch (err) {
      state.ui.connOk = false;
      save();
      paintConnection();
      L.error('api', `health check failed: ${err.message}`);
      if (!silent) toast('err', t('toast.connFail'), err.message);
    }
  };

  check();
  healthTimer = setInterval(check, 20_000);
  liveStream = sharedClient.stream((evt) => {
    if (evt.type === 'snapshot') {
      applySnapshot(evt.jobs);
    } else if (evt.type === 'progress' || evt.type === 'status' || evt.type === 'job') {
      applyEvent(evt);
    } else if (evt.type === 'log') {
      L.log(evt.level || 'INFO', evt.source || 'api', evt.message || '', { jobId: evt.job_id });
    } else if (evt.type === 'error') {
      state.ui.connOk = false;
      paintConnection();
    }
  }, Math.max(1, Number(state.settings.pollInterval) || 2) * 1000);
}

export function disconnectLive() {
  if (liveStream) { liveStream.stop(); liveStream = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

/* ═══════════════ overlays / sidebar / shortcuts ═══════════════ */

function bindOverlays() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-drawer]')) $('#drawerRoot').hidden = true;
    if (e.target.closest('[data-close-modal]')) $('#modalRoot').hidden = true;
  });
  $('#drawerRoot').addEventListener('click', (e) => { if (e.target.id === 'drawerRoot') $('#drawerRoot').hidden = true; });
}

function bindSidebar() {
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  const open = (v) => {
    sidebar.classList.toggle('is-open', v);
    scrim.hidden = !v;
  };
  $('#menuBtn').addEventListener('click', () => open(!sidebar.classList.contains('is-open')));
  $('#sidebarClose').addEventListener('click', () => open(false));
  scrim.addEventListener('click', () => open(false));
  document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', () => open(false)));
}

function bindShortcuts() {
  let gPressed = 0;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (state.ui.route !== 'queue') location.hash = '#/queue';
      setTimeout(() => $('#urlInput')?.focus(), 80);
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#modalRoot').hidden) { $('#modalRoot').hidden = true; return; }
      if (!$('#drawerRoot').hidden) { $('#drawerRoot').hidden = true; return; }
      $('#sidebar').classList.remove('is-open'); $('#scrim').hidden = true;
      return;
    }
    if (typing) return;

    if (e.key === 'g') { gPressed = Date.now(); return; }
    if (Date.now() - gPressed < 900) {
      const map = { d: 'dashboard', q: 'queue', l: 'logs', s: 'settings', t: 'telegram', h: 'help', w: 'sites' };
      const route = map[e.key.toLowerCase()];
      gPressed = 0;
      if (route) { e.preventDefault(); location.hash = `#/${route}`; return; }
    }
    if (e.key === '/') {
      e.preventDefault();
      if (state.ui.route !== 'sites') location.hash = '#/sites';
      setTimeout(() => $('#siteSearch')?.focus(), 80);
      return;
    }
    /* selected-job shortcuts */
    const job = state.jobs.find((j) => j.id === state.ui.selectedJobId) || state.jobs[0];
    if (!job) return;
    if (e.key.toLowerCase() === 'p') { job.status === 'downloading' ? pause(job.id) : resume(job.id); }
    if (e.key.toLowerCase() === 'r') retry(job.id);
  });
}
