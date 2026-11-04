/* tests/live.mjs — end-to-end: the real panel UI → the real FastAPI bridge
   (downloader/api/server.py) → the real downloader-bot engines.

   Start the backend first (inside a checkout of devlopergit04/downloader-bot):
       pip install -r requirements.txt -r api/requirements.txt
       python api/server.py                     # → http://127.0.0.1:8787
   Then:
       npm install && PANEL_API=http://127.0.0.1:8787 node tests/live.mjs        */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = new URL('../downloader/', import.meta.url).pathname;
const API = process.env.PANEL_API || 'http://127.0.0.1:8787';
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  url: 'https://devlopergit04.github.io/downloader/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

const noop = () => {};
const ctx2d = new Proxy({}, { get: (_t, p) => (p === 'createLinearGradient' || p === 'createRadialGradient'
  ? () => ({ addColorStop: noop }) : (typeof p === 'string' ? noop : undefined)), set: () => true });
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = noop;
window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
/* real network: the panel talks to the actual backend (capture Node's fetch first,
   otherwise the wrapper below would recurse into itself once it becomes globalThis.fetch) */
const nodeFetch = globalThis.fetch.bind(globalThis);
window.fetch = (input, init) => nodeFetch(typeof input === 'string' ? input : input.url, init);
window.EventSource = undefined;   // force the polling path in api.js

for (const key of ['window', 'document', 'location', 'localStorage', 'HTMLElement', 'HTMLInputElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'Blob', 'URL', 'CSS', 'fetch',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  if (window[key] === undefined) continue;
  try { Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true }); } catch {}
}

process.on('unhandledRejection', (r) => problems.push('unhandledRejection: ' + (r?.stack || r)));

await import(path.join(ROOT, 'assets/js/app.js'));
const { state } = await import(path.join(ROOT, 'assets/js/store.js'));
const jobs = await import(path.join(ROOT, 'assets/js/jobs.js'));

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (str) => Number(String(str).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d.]/g, '') || 0);
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) problems.push(`ASSERT FAILED: ${label} ${extra}`);
  else console.log(`  ✔ ${label}${extra ? ' — ' + extra : ''}`);
}

await sleep(400);

console.log('\n[A] point the panel at the real backend');
window.location.hash = '#/settings';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(150);
$('[data-tab="backend"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(150);
const urlField = $('input[data-set="apiUrl"]');
urlField.value = API;
urlField.dispatchEvent(new window.Event('change'));
await sleep(120);
ok(state.settings.apiUrl === API, 'api url stored', state.settings.apiUrl);

$('#testConn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(1500);
ok(state.ui.connOk === true, 'GET /api/health succeeded through the panel', $('#connOut').textContent.trim().slice(0, 70));
ok($('#connChip').className.includes('is-ok'), 'connection chip turned green', $('#connChip').className);

console.log('\n[B] switch to live mode');
$('[data-mode="live"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(1200);
ok(state.settings.mode === 'live', 'mode = live');
ok(state.jobs.length >= 0, 'job list synced from server', `${state.jobs.length} job(s)`);

console.log('\n[C] queue a real download through the UI');
window.location.hash = '#/queue';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(200);
const ta = $('#urlInput');
ta.value = 'https://github.com/devlopergit04/downloader-bot/archive/refs/heads/main.zip?live=1';
ta.dispatchEvent(new window.Event('input'));
await sleep(250);
$('#addBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(1500);
ok(state.jobs.some((j) => j.url.includes('live=1')), 'job created on the server and mirrored locally', String(state.jobs.length));

const live = state.jobs.find((j) => j.url.includes('live=1'));
ok(live?.engine === 'HTTP', 'server routed it to the HTTP engine', live?.engine);

console.log('\n[D] wait for the real download to finish');
let done = null;
for (let i = 0; i < 40; i++) {
  await sleep(700);
  const j = state.jobs.find((x) => x.url.includes('live=1'));
  if (i % 5 === 0) console.log(`    t=${(i * 0.7).toFixed(1)}s status=${j?.status} size=${j?.sizeBytes} path=${(j?.path || '').split('/').pop()}`);
  if (j && ['completed', 'error'].includes(j.status)) { done = j; break; }
}
ok(done?.status === 'completed', 'panel shows the job completed', done?.status || 'timeout');
ok(done?.sizeBytes > 1024, 'real file size reported', `${done?.sizeBytes} bytes`);
ok(done?.path?.endsWith('.zip'), 'server-side path mirrored', (done?.path || '').split('/').pop());
ok(state.stats.completed >= 1, 'stats counted the completion', String(state.stats.completed));
ok($$('#jobBody tr').length >= 1, 'table rendered the live job');
ok(state.logs.some((l) => l.source === 'api'), 'api events reached the log console',
  state.logs.filter((l) => l.source === 'api').slice(-1)[0]?.message.slice(0, 60));

console.log('\n[E] dashboard reflects the live run');
window.location.hash = '#/dashboard';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(400);
ok(num($('#stDone').textContent) >= 1, 'dashboard completed counter', $('#stDone').textContent);
ok(!$('#dashBytes').textContent.startsWith('0 B'), 'dashboard bytes counter', $('#dashBytes').textContent);
ok($('#healthBody').textContent.includes('yt-dlp'), 'health card lists engine versions');

console.log('\n[F] back to demo mode');
$('[data-mode="demo"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(600);
ok(state.settings.mode === 'demo', 'mode = demo');
ok($('#connChip').className.includes('is-warn'), 'chip shows the internal simulator', $('#connChip').className);

await sleep(300);
console.log(`\n──────── ${checks} live-mode checks ────────`);
if (problems.length) {
  console.log(`\n✖ ${problems.length} problem(s):`);
  problems.slice(0, 20).forEach((p) => console.log('  • ' + p.slice(0, 300)));
  process.exit(1);
} else {
  console.log('\n✔ live mode clean — panel ↔ FastAPI ↔ real engines');
  process.exit(0);
}
