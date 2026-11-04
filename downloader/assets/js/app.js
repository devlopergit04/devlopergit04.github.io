/* app.js — bootstrap: load state, mount the shell, start the tick loops,
   register the service worker and wire global error reporting. */

import { state, load, save, subscribe } from './store.js';
import { initShell, tickFast, tickSlow, renderRoute, disconnectLive } from './ui/shell.js';
import { startFree, toast } from './jobs.js';
import * as L from './logs.js';
import { t } from './i18n.js';

export const VERSION = '1.0.0';

async function boot() {
  load();

  document.getElementById('panelVersion').textContent = VERSION;

  initShell();

  /* ── tick loops ─────────────────────────────────────────────────────── */
  setInterval(() => { try { tickFast(); } catch (err) { report(err, 'tickFast'); } }, 220);
  setInterval(() => { try { tickSlow(); } catch (err) { report(err, 'tickSlow'); } }, 1000);

  /* ── first-run welcome ──────────────────────────────────────────────── */
  if (!state.logs.length) {
    L.info('panel', `Downloader Bot web panel v${VERSION} — https://devlopergit04.github.io/downloader/`, { force: true });
    L.info('panel', `mode=${state.settings.mode} lang=${state.settings.lang} theme=${state.settings.theme}`, { force: true });
    L.debug('engine', 'routing rules loaded: DIRECT_DOMAINS=3 GALLERY_DOMAINS=11 FILE_EXT=32');
    L.info('yt-dlp', 'engine ready (simulated in demo mode)', { force: true });
    L.info('gallery-dl', 'engine ready (simulated in demo mode)', { force: true });
    L.info('HTTP', 'engine ready — direct links are fetched for real when CORS allows it', { force: true });
    if (!state.settings.telegramBotToken) {
      L.warn('telegram', 'TELEGRAM_BOT_TOKEN is empty — set it under Settings → .env');
    }
  }

  /* resume anything that was mid-flight before a reload */
  const stranded = state.jobs.filter((j) => j.status === 'paused' && j.progress > 0 && j.progress < 100);
  if (stranded.length) {
    L.warn('queue', `${stranded.length} job(s) were interrupted by a page reload — parked as paused`, { force: true });
  }
  if (state.settings.autoStart && state.settings.mode === 'demo') startFree();

  /* ── global error surface ───────────────────────────────────────────── */
  window.addEventListener('error', (e) => report(e.error || e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));
  window.addEventListener('beforeunload', () => { save(); });
  window.addEventListener('offline', () => {
    toast('warn', 'offline', t('conn.liveOff'));
    L.warn('panel', 'browser went offline');
  });
  window.addEventListener('online', () => {
    L.info('panel', 'browser back online');
    if (state.settings.mode === 'live') renderRoute();
  });

  subscribe((reason) => { if (reason === 'reset') disconnectLive(); });

  /* ── PWA ────────────────────────────────────────────────────────────── */
  registerServiceWorker();

  /* ── hide the splash ────────────────────────────────────────────────── */
  requestAnimationFrame(() => {
    const boot = document.getElementById('boot');
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 420);
  });
}

function report(err, where) {
  const message = err?.message ? `${err.name || 'Error'}: ${err.message}` : String(err);
  L.error(where, message);
  console.error(`[panel:${where}]`, err);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const base = location.pathname.replace(/[^/]*$/, '');
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base })
      .then((reg) => L.debug('pwa', `service worker registered (scope ${reg.scope})`))
      .catch((err) => L.warn('pwa', `service worker registration failed: ${err.message}`));
  });
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) {
    b.innerHTML = `<div class="card card-pad" style="max-width:520px;text-align:start">
      <h3 style="color:#fca5a5">panel failed to start</h3>
      <pre class="code" style="margin-top:10px">${String(err?.stack || err).replace(/[<>&]/g, '')}</pre>
    </div>`;
    b.classList.remove('gone');
  }
});
