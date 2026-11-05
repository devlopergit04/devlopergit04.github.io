/* tests/dom.mjs — boots the whole panel inside jsdom and drives it like a user:
   routing, queueing, simulation, controls, drawer, filters, exporters, i18n,
   theme, persistence and mode switching.
   Requires:  npm install   (devDependency: jsdom)
   Run:       node tests/dom.mjs                                          */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = new URL('../downloader/', import.meta.url).pathname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { if (!String(a[0]).includes('[store]')) problems.push('console.warn: ' + a.join(' ')); });

const dom = new JSDOM(html, {
  url: 'https://devlopergit04.github.io/downloader/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

/* jsdom does not fetch <link rel=stylesheet> — inject the real stylesheet so the
   computed-style assertions below exercise the actual cascade. */
window.document.head.insertAdjacentHTML(
  'beforeend',
  `<style>${fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8')}</style>`);

/* ── browser APIs jsdom lacks ─────────────────────────────────────────── */
const noop = () => {};
const ctx2d = new Proxy({}, { get: (_t, p) => (p === 'canvas' ? {} : (p === 'createLinearGradient' || p === 'createRadialGradient'
  ? () => ({ addColorStop: noop })
  : (typeof p === 'string' ? noop : undefined))) , set: () => true });
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = noop;
window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
window.fetch = async () => { throw new TypeError('Failed to fetch (CORS blocked in harness)'); };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: noop, removeEventListener: noop }));

for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'HTMLInputElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'Blob', 'URL', 'CSS', 'fetch',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'DOMParser', 'EventSource']) {
  if (window[key] === undefined) continue;
  try {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  } catch {
    try { globalThis[key] = window[key]; } catch { /* read-only global (e.g. navigator) */ }
  }
}
// Node's own global performance is kept (jsdom's impl delegates to it)

process.on('unhandledRejection', (r) => problems.push('unhandledRejection: ' + (r?.stack || r)));

/* ── boot ─────────────────────────────────────────────────────────────── */
const APP = path.join(ROOT, 'assets/js/app.js');
await import(APP);
const store = await import(path.join(ROOT, 'assets/js/store.js'));
const jobs = await import(path.join(ROOT, 'assets/js/jobs.js'));
const { state } = store;

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (ms) => { await sleep(ms); };

const gcs = (sel) => window.getComputedStyle(window.document.querySelector(sel));
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) problems.push(`ASSERT FAILED: ${label} ${extra}`);
  else console.log(`  ✔ ${label}${extra ? ' — ' + extra : ''}`);
}

await wait(400);

console.log('\n[1] boot + dashboard');
ok($('#boot') === null || $('#boot').classList.contains('gone'), 'splash hidden');
ok($('#view').innerHTML.length > 800, 'dashboard rendered', `${$('#view').innerHTML.length} chars`);
ok($('#viewTitle').textContent.length > 0, 'view title set', $('#viewTitle').textContent);
ok($$('.nav-item.is-active').length === 1, 'one active nav item');
ok($('#sbDir').textContent.includes('downloads'), 'status bar dir', $('#sbDir').textContent.trim());
ok(gcs('#drawerRoot').display === 'none', 'drawer overlay is display:none while [hidden]');
ok(gcs('#modalRoot').display === 'none', 'modal overlay is display:none while [hidden]');
ok(gcs('#scrim').display === 'none', 'mobile scrim is display:none while [hidden]');

console.log('\n[2] routing to every view');
for (const route of ['queue', 'logs', 'telegram', 'sites', 'settings', 'help', 'dashboard']) {
  window.location.hash = '#/' + route;
  window.dispatchEvent(new window.Event('hashchange'));
  await wait(120);
  ok($('#view').innerHTML.length > 500, `view ${route} rendered`, `${$('#view').innerHTML.length} chars`);
  ok($('.nav-item.is-active')?.dataset.route === route, `nav highlights ${route}`);
}

console.log('\n[3] queue: add links, detect engines, run');
window.location.hash = '#/queue';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
const ta = $('#urlInput');
ta.value = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://imgur.com/gallery/xample99',
  'https://github.com/devlopergit04/downloader-bot/archive/refs/heads/main.zip',
  'https://soundcloud.com/forss/flickermood',
].join('\n');
ta.dispatchEvent(new window.Event('input'));
await wait(260);
ok($('#detectLine').textContent.includes('4'), 'routing preview counted 4 links', $('#detectLine').textContent.slice(0, 60));
ok($('#detectLine').innerHTML.includes('gallery-dl'), 'gallery-dl detected');
ok($('#detectLine').innerHTML.includes('yt-dlp'), 'yt-dlp detected');

$('#addBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(300);
ok(state.jobs.length === 4, '4 jobs queued', String(state.jobs.length));
ok(state.jobs.some((j) => j.engine === 'yt-dlp') && state.jobs.some((j) => j.engine === 'gallery-dl') && state.jobs.some((j) => j.engine === 'HTTP'), 'engines assigned');
ok($$('#jobBody tr').length === 4, 'table has 4 rows');

console.log('\n[4] simulation progresses');
await wait(2600);
const active = state.jobs.filter((j) => ['downloading', 'processing'].includes(j.status));
const progressed = state.jobs.filter((j) => j.progress > 0);
ok(progressed.length > 0, 'jobs progressed', progressed.map((j) => `${j.engine}:${Math.round(j.progress)}%`).join(' '));
ok(active.length <= state.settings.concurrency, 'concurrency respected', `${active.length} ≤ ${state.settings.concurrency}`);
ok(state.logs.length > 10, 'logs flowing', `${state.logs.length} entries`);
ok($('#overallPct').textContent !== '0%', 'overall progress moved', $('#overallPct').textContent);
ok(Number($('#navQueueBadge').textContent.replace(/[^\d]/g, '')) >= 0, 'queue badge updated', $('#navQueueBadge').textContent);
ok(gcs('#queueEmpty').display === 'none', 'empty-state stays hidden while jobs exist');

console.log('\n[5] job controls');
const target = state.jobs.find((j) => j.status === 'downloading') || state.jobs[0];
jobs.pause(target.id);
await wait(200);
ok(target.status === 'paused', 'pause works', target.status);
jobs.resume(target.id);
await wait(400);
ok(['downloading', 'processing', 'queued', 'completed'].includes(target.status), 'resume works', target.status);
jobs.cancel(target.id);
await wait(400);
ok(['cancelled', 'completed'].includes(target.status), 'cancel works', target.status);

console.log('\n[6] detail drawer');
$$('#jobBody tr')[1]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(200);
ok($('#drawerRoot').hidden === false, 'drawer opened');
ok(gcs('#drawerRoot').display === 'flex', 'drawer overlay is actually visible when open');
ok($('#drawerBody').innerHTML.includes('kv'), 'drawer has details');
ok($('#drawerFoot').children.length > 0, 'drawer has actions');
$('[data-close-drawer]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(100);
ok($('#drawerRoot').hidden === true, 'drawer closed');
ok(gcs('#drawerRoot').display === 'none', 'drawer overlay is really gone after closing');

console.log('\n[7] logs view filters');
window.location.hash = '#/logs';
window.dispatchEvent(new window.Event('hashchange'));
await wait(200);
const before = $$('#logBox .logline').length;
ok(before > 0, 'log lines rendered', String(before));
$('[data-level="DEBUG"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(150);
ok($$('#logBox .logline').length <= before, 'level filter narrows output', `${$$('#logBox .logline').length} ≤ ${before}`);
$('#sourceSel').value = 'yt-dlp';
$('#sourceSel').dispatchEvent(new window.Event('change'));
await wait(200);
ok($$('#logBox .logline').every((l) => l.querySelector('.src').textContent === 'yt-dlp'), 'source filter works');

console.log('\n[8] settings + exporters');
window.location.hash = '#/settings';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
ok($('input[data-set="telegramBotToken"]'), 'env tab shows token field');
$('[data-tab="export"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(150);
ok($('#setBody').innerHTML.includes('.env'), 'export tab rendered');
const { buildEnv, buildCompose, buildRunScript, buildSystemdUnit, buildPanelSnapshot } = await import(path.join(ROOT, 'assets/js/exporters.js'));
ok(buildEnv().includes('TELEGRAM_BOT_TOKEN='), '.env builds');
ok(buildCompose().includes('downloader-webpanel'), 'compose builds');
ok(buildRunScript().includes('api/server.py'), 'run.sh builds');
ok(buildSystemdUnit().includes('[Service]'), 'systemd unit builds');
ok(JSON.parse(buildPanelSnapshot()).panel.startsWith('downloader-bot-web-panel/'), 'snapshot is valid JSON');
$('[data-tab="backend"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
ok($('#setBody').innerHTML.includes('apiUrl') || $('#setBody').innerHTML.includes('data-set="apiUrl"'), 'backend tab rendered');

console.log('\n[9] sites view');
window.location.hash = '#/sites';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
ok($$('#siteGrid .site').length >= 18, 'site cards rendered', String($$('#siteGrid .site').length));
$('#siteSearch').value = 'tiktok';
$('#siteSearch').dispatchEvent(new window.Event('input'));
await wait(120);
ok($$('#siteGrid .site').length === 1, 'site search filters', String($$('#siteGrid .site').length));
$('#probeUrl').value = 'https://x.com/i/status/123';
$('#probeBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
ok($('#probeOut').textContent.includes('gallery-dl'), 'probe routes x.com → gallery-dl');

console.log('\n[10] telegram simulator');
window.location.hash = '#/telegram';
window.dispatchEvent(new window.Event('hashchange'));
await wait(200);
$('#tgInput').value = '/ping';
$('#tgSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(900);
ok(state.telegram.messages.some((m) => m.text.includes('ربات زنده')), '/ping answered', state.telegram.messages.at(-1)?.text.slice(0, 30));
$('#tgInput').value = 'https://youtu.be/xyz999';
$('#tgAlsoQueue').checked = false;
$('#tgSend').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(1200);
ok(state.telegram.messages.some((m) => m.text.includes('⬇️')), 'download flow started (progress edits)', state.telegram.messages.at(-1)?.text.slice(0, 24));
await wait(12000);
ok(state.telegram.messages.some((m) => m.text.includes('دانلود کامل')), 'download finished in chat', state.telegram.messages.at(-1)?.text.split('\n')[0]);
ok(state.telegram.messages.at(-1)?.text.includes('yt-dlp'), 'caption names the engine');

console.log('\n[11] i18n + theme');
window.location.hash = '#/sites';
window.dispatchEvent(new window.Event('hashchange'));
await wait(200);
$('#langBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(300);
ok(window.document.documentElement.lang === 'en', 'switched to English', window.document.documentElement.lang);
ok(window.document.documentElement.dir === 'ltr', 'dir flipped to ltr');
ok($('#viewTitle').textContent === 'Supported sites', 'view title translated', $('#viewTitle').textContent);
ok($('#view').textContent.includes('Engine routing'), 'view content translated');
$('#langBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(250);
ok(window.document.documentElement.lang === 'fa' && window.document.documentElement.dir === 'rtl', 'back to Persian RTL');
$('#themeBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
ok(window.document.documentElement.dataset.theme === 'light', 'light theme applied');
$('#themeBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
ok(window.document.documentElement.dataset.theme === 'dark', 'dark theme restored');

console.log('\n[12] persistence + mode switch');
ok(fs.existsSync('/dev/null'), 'sanity');
await wait(600);
const raw = window.localStorage.getItem('dlbot.panel.v1');
ok(!!raw, 'state persisted to localStorage', raw ? `${(raw.length / 1024).toFixed(1)} KB` : '');
const parsed = JSON.parse(raw || '{}');
ok(parsed.jobs?.length >= 4, 'jobs persisted', String(parsed.jobs?.length));
ok(parsed.settings?.downloadDir === './downloads', 'settings persisted');

$('[data-mode="live"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(400);
ok(state.settings.mode === 'live', 'mode switched to live');
ok($('#connChip').className.includes('is-off') || $('#connChip').className.includes('is-ok'), 'connection chip reflects state', $('#connChip').className);
$('[data-mode="demo"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(300);
ok(state.settings.mode === 'demo', 'mode switched back to demo');

console.log('\n[13] shortcuts');
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'g', bubbles: true }));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
await wait(250);
ok(state.ui.route === 'logs', 'g+l navigates to logs', state.ui.route);

await wait(400);
console.log(`\n──────── ${checks} checks run ────────`);
if (problems.length) {
  console.log(`\n✖ ${problems.length} problem(s):`);
  problems.slice(0, 40).forEach((p) => console.log('  • ' + p.slice(0, 400)));
  process.exit(1);
} else {
  console.log('\n✔ integration harness clean — no runtime errors');
  process.exit(0);
}
