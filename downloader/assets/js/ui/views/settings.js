/* ui/views/settings.js — bot .env variables, panel preferences, backend
   connection and the file exporters. */

import { state, save, updateSettings, reset } from '../../store.js';
import { t, setLang, LANGS } from '../../i18n.js';
import { digits, fmtBytes } from '../../format.js';
import { esc, icon, on } from '../dom.js';
import { toast, codeModal, confirmDialog } from '../overlays.js';
import { EXPORTS, buildEnv, copyText, downloadText } from '../../exporters.js';
import { sharedClient } from '../../api.js';
import { requestNotifyPermission, clearFinished } from '../../jobs.js';
import { clearLogs } from '../../logs.js';
import { QUALITIES } from '../../engine.js';

let rootEl = null;

const TABS = [
  { id: 'env', icon: 'i-save', key: 'set.tab.env' },
  { id: 'panel', icon: 'i-sliders', key: 'set.tab.panel' },
  { id: 'backend', icon: 'i-cloud', key: 'set.tab.backend' },
  { id: 'export', icon: 'i-download', key: 'set.tab.export' },
  { id: 'danger', icon: 'i-alert', key: 'set.tab.danger' },
];

export const settingsView = {
  id: 'settings',
  title: () => t('view.settings.title'),
  sub: () => t('view.settings.sub'),

  render() {
    const tab = state.ui.settingsTab || 'env';
    return `
    <div class="settings-grid">
      <nav class="tabs-v" id="setTabs">
        ${TABS.map((x) => `<button class="tab-v ${x.id === tab ? 'is-on' : ''}" data-tab="${x.id}">${icon(x.icon)} ${esc(t(x.key))}</button>`).join('')}
      </nav>
      <div id="setBody">${tabBody(tab)}</div>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    on(root, '[data-tab]', 'click', (_e, el) => {
      state.ui.settingsTab = el.dataset.tab;
      save();
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b === el));
      root.querySelector('#setBody').innerHTML = tabBody(el.dataset.tab);
      bind(root);
    });
    bind(root);
  },

  tick() {},
  unmount() { rootEl = null; },
};

/* ═══════════════ tab bodies ═══════════════ */

function tabBody(tab) {
  const s = state.settings;
  if (tab === 'panel') {
    return `
    <section class="card">
      <div class="card-head"><h3>${icon('i-sliders')} <span data-i18n="set.panelTitle"></span></h3></div>
      <div class="card-pad grid cols-2">
        <div class="field"><label data-i18n="set.lang"></label>
          <select class="select" data-set="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${s.lang === k ? 'selected' : ''}>${v.label} (${k})</option>`).join('')}</select>
        </div>
        <div class="field"><label data-i18n="set.theme"></label>
          <select class="select" data-set="theme">
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>🌙 dark (Qt default)</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>☀️ light</option>
          </select>
        </div>
        <div class="field"><label for="qDefault" data-i18n="queue.quality"></label>
          <select class="select" data-set="quality" id="qDefault">${QUALITIES.map((q) => `<option value="${q.id}" ${s.quality === q.id ? 'selected' : ''}>${esc(t(`quality.${q.id}`))}</option>`).join('')}</select>
          <span class="hint mono">format = ${esc(QUALITIES.find((q) => q.id === s.quality)?.fmt || '')}</span>
        </div>
        <div class="field"><label data-i18n="queue.concurrency"></label>
          <input class="input" type="number" min="1" max="8" data-set="concurrency" value="${digitsPlain(s.concurrency)}">
          <span class="hint">gui/main_window.py → cap = 3</span>
        </div>
        <div class="field"><label data-i18n="set.demoSpeed"></label>
          <input class="input" type="number" min="1" max="1000" step="5" data-set="demoSpeedMbps" value="${digitsPlain(s.demoSpeedMbps)}">
        </div>
        <div class="field"><label data-i18n="set.demoErrorRate"></label>
          <input class="input" type="number" min="0" max="100" data-set="demoErrorRate" value="${digitsPlain(s.demoErrorRate)}">
          <span class="hint">0 = هیچ خطایی شبیه‌سازی نمی‌شود</span>
        </div>
        <div class="field"><label data-i18n="set.maxLogs"></label>
          <input class="input" type="number" min="50" max="5000" step="50" data-set="maxLogs" value="${digitsPlain(s.maxLogs)}">
        </div>
        <div class="field"><label>&nbsp;</label>
          <div class="stack" style="gap:8px">
            <label class="switch"><input type="checkbox" data-set="autoStart" ${s.autoStart ? 'checked' : ''}><span class="track"></span><span data-i18n="queue.autoStart"></span></label>
            <label class="switch"><input type="checkbox" data-set="realBrowserDownloads" ${s.realBrowserDownloads ? 'checked' : ''}><span class="track"></span><span>دانلود واقعی در مرورگر (لینک‌های مستقیم)</span></label>
            <label class="switch"><input type="checkbox" data-set="compact" ${s.compact ? 'checked' : ''}><span class="track"></span><span data-i18n="set.compact"></span></label>
            <label class="switch"><input type="checkbox" data-set="keepLogs" ${s.keepLogs ? 'checked' : ''}><span class="track"></span><span data-i18n="set.keepLogs"></span></label>
            <label class="switch"><input type="checkbox" data-set="notify" ${s.notify ? 'checked' : ''}><span class="track"></span><span data-i18n="set.notify"></span> <button class="btn sm ghost" id="askNotify">اجازه</button></label>
          </div>
        </div>
      </div>
    </section>`;
  }

  if (tab === 'backend') {
    return `
    <section class="card">
      <div class="card-head"><h3>${icon('i-cloud')} <span data-i18n="set.backendTitle"></span></h3>
        <span class="spacer"></span>
        <span class="badge ${s.mode === 'live' ? (state.ui.connOk ? 'ok' : 'err') : 'info'}">${esc(s.mode === 'live' ? (state.ui.connOk ? t('conn.liveOk') : t('conn.liveOff')) : t('conn.demo'))}</span>
      </div>
      <div class="card-pad stack" style="gap:12px">
        <p class="muted" style="font-size:12.5px" data-i18n="set.backendSub"></p>
        <div class="grid cols-2">
          <div class="field"><label data-i18n="set.apiUrl"></label>
            <input class="input mono" data-set="apiUrl" value="${esc(s.apiUrl || '')}" placeholder="http://127.0.0.1:8787">
            <span class="hint">CORS باید <span class="mono">https://devlopergit04.github.io</span> را بپذیرد</span>
          </div>
          <div class="field"><label data-i18n="set.apiToken"></label>
            <input class="input mono" type="password" data-set="apiToken" value="${esc(s.apiToken || '')}" placeholder="WEBPANEL_TOKEN">
          </div>
          <div class="field"><label data-i18n="set.pollInterval"></label>
            <input class="input" type="number" min="1" max="30" data-set="pollInterval" value="${digitsPlain(s.pollInterval)}">
          </div>
          <div class="field"><label>WEBPANEL_PORT</label>
            <input class="input" type="number" min="1" max="65535" data-set="webPort" value="${digitsPlain(s.webPort)}">
          </div>
        </div>
        <div class="row">
          <button class="btn primary" id="testConn">${icon('i-wifi')} <span data-i18n="set.testConn"></span></button>
          <button class="btn ghost" id="showServerCode">${icon('i-terminal')} api/server.py</button>
          <span class="grow"></span>
          <span class="muted" id="connOut" style="font-size:11.5px"></span>
        </div>
        <div class="card" style="background:var(--bg-3)">
          <div class="card-pad">
            <b style="font-size:12.5px">اجرای بک‌اند کنار ربات</b>
<pre class="code" style="margin-top:8px"><span class="c"># 1) فایل api/server.py را داخل مخزن downloader-bot بگذارید</span>
pip install fastapi uvicorn
python api/server.py            <span class="c"># → http://127.0.0.1:${digitsPlain(s.webPort)}</span>

<span class="c"># 2) در همین پنل: حالت «اتصال زنده» + آدرس بالا</span>
<span class="c"># 3) برای دسترسی از اینترنت، پشت nginx/caddy با TLS اجرا کنید</span></pre>
          </div>
        </div>
      </div>
    </section>`;
  }

  if (tab === 'export') {
    return `
    <section class="card">
      <div class="card-head"><h3>${icon('i-download')} <span data-i18n="set.exportTitle"></span></h3></div>
      <div class="card-pad">
        <p class="muted" style="font-size:12.5px;margin-bottom:12px" data-i18n="set.exportSub"></p>
        <div class="grid cols-2">
          ${EXPORTS.map((e) => `<div class="card" style="background:var(--bg-3)">
            <div class="card-pad">
              <div class="row" style="margin-bottom:6px">
                <span class="tag">${icon(e.icon)} ${esc(e.file)}</span>
                <span class="grow"></span>
              </div>
              <p class="muted" style="font-size:11.5px;margin-bottom:10px">${esc(e.desc)}</p>
              <div class="row">
                <button class="btn sm ghost" data-preview="${e.id}">${icon('i-search')} preview</button>
                <button class="btn sm ghost" data-copy="${e.id}">${icon('i-copy')} ${esc(t('ui.copy'))}</button>
                <button class="btn sm primary" data-save="${e.id}">${icon('i-download')} ${esc(t('ui.download'))}</button>
              </div>
            </div>
          </div>`).join('')}
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card-head"><h3>${icon('i-save')} .env preview</h3>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="copyEnv">${icon('i-copy')}</button>
            <button class="btn sm primary" id="saveEnv">${icon('i-download')} .env</button>
          </div>
          <div class="card-pad"><pre class="code" style="max-height:340px">${esc(buildEnv())}</pre></div>
        </div>
      </div>
    </section>`;
  }

  if (tab === 'danger') {
    const usage = storageUsage();
    return `
    <section class="card">
      <div class="card-head"><h3>${icon('i-alert')} <span data-i18n="set.resetTitle"></span></h3></div>
      <div class="card-pad stack" style="gap:12px">
        <p class="muted" style="font-size:12.5px" data-i18n="set.resetSub"></p>
        <dl class="kv">
          <dt>localStorage</dt><dd class="mono">${esc(usage.key)} — ${esc(fmtBytes(usage.bytes))}</dd>
          <dt>jobs</dt><dd>${digits(state.jobs.length)} (${digits(state.jobs.filter((j) => j.status === 'completed').length)} completed)</dd>
          <dt>logs</dt><dd>${digits(state.logs.length)}</dd>
          <dt>activity</dt><dd>${digits(state.activity.length)}</dd>
          <dt>downloaded (session)</dt><dd>${esc(fmtBytes(state.stats.totalBytes))}</dd>
        </dl>
        <div class="row">
          <button class="btn ghost" id="clearFinished">${icon('i-check')} <span data-i18n="ui.clearDone"></span></button>
          <button class="btn ghost" id="clearLogs2">${icon('i-terminal')} <span data-i18n="logs.clear"></span></button>
          <button class="btn danger" id="fullReset">${icon('i-trash')} <span data-i18n="set.reset"></span></button>
        </div>
      </div>
    </section>`;
  }

  /* default: env */
  return `
  <section class="card">
    <div class="card-head"><h3>${icon('i-save')} <span data-i18n="set.envTitle"></span></h3>
      <span class="spacer"></span>
      <span class="badge ok">config.py</span>
    </div>
    <div class="card-pad">
      <p class="muted" style="font-size:12.5px;margin-bottom:12px" data-i18n="set.envSub"></p>
      <div class="grid cols-2">
        <div class="field"><label>TELEGRAM_BOT_TOKEN <span class="req">*</span></label>
          <input class="input mono" type="password" data-set="telegramBotToken" value="${esc(s.telegramBotToken || '')}" placeholder="123456789:AAAA…">
          <span class="hint" data-i18n="tg.tokenHint"></span>
        </div>
        <div class="field"><label>ALLOWED_USER_ID</label>
          <input class="input mono" data-set="allowedUserId" value="${esc(s.allowedUserId || '')}" placeholder="empty = public">
          <span class="hint" data-i18n="tg.allowedHint"></span>
        </div>
        <div class="field"><label>MAX_UPLOAD_MB</label>
          <input class="input" type="number" min="0" max="4000" data-set="maxUploadMb" value="${digitsPlain(s.maxUploadMb)}">
          <span class="hint">0 = unlimited · Telegram bot API: 50 MB</span>
        </div>
        <div class="field"><label>DOWNLOAD_DIR</label>
          <input class="input mono" data-set="downloadDir" value="${esc(s.downloadDir || './downloads')}">
          <span class="hint">created if missing</span>
        </div>
        <div class="field"><label>YTDLP_RETRIES</label>
          <input class="input" type="number" min="0" max="100" data-set="ytdlpRetries" value="${digitsPlain(s.ytdlpRetries)}">
        </div>
        <div class="field"><label>YTDLP_CONCURRENT</label>
          <input class="input" type="number" min="1" max="16" data-set="ytdlpConcurrent" value="${digitsPlain(s.ytdlpConcurrent)}">
          <span class="hint">concurrent_fragment_downloads</span>
        </div>
        <div class="field"><label>LOG_LEVEL</label>
          <select class="select" data-set="logLevel">
            ${['DEBUG', 'INFO', 'WARNING', 'ERROR'].map((lv) => `<option value="${lv}" ${s.logLevel === lv ? 'selected' : ''}>${lv}</option>`).join('')}
          </select>
          <span class="hint">کنسول لاگ همین سطح را اعمال می‌کند</span>
        </div>
        <div class="field"><label>EXTRA_FORMATS</label>
          <input class="input mono" data-set="extraFormats" value="${esc(s.extraFormats || '')}">
          <span class="hint">yt-dlp format selector</span>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn primary" id="saveEnv2">${icon('i-download')} .env</button>
        <button class="btn ghost" id="copyEnv2">${icon('i-copy')} <span data-i18n="ui.copy"></span></button>
        <button class="btn ghost" id="previewEnv">${icon('i-search')} preview</button>
        <span class="grow"></span>
        <span class="badge">${icon('i-shield')} stored locally only</span>
      </div>
    </div>
  </section>`;
}

/* ═══════════════ bindings ═══════════════ */

function bind(root) {
  /* generic data-set inputs */
  root.querySelectorAll('[data-set]').forEach((el) => {
    const key = el.dataset.set;
    const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' || el.type === 'range' ? 'change' : 'change');
    el.addEventListener(evt, () => {
      const raw = el.type === 'checkbox' ? el.checked : el.value;
      const value = el.type === 'number' || el.type === 'range' ? Number(raw) : raw;
      updateSettings({ [key]: value });
      if (key === 'lang') { setLang(value); document.dispatchEvent(new CustomEvent('panel:lang')); }
      if (key === 'theme') document.dispatchEvent(new CustomEvent('panel:theme'));
      if (['logLevel', 'maxLogs', 'keepLogs'].includes(key)) toast('info', t('set.saved'), `${key} = ${String(value)}`);
      if (key === 'quality') {
        const hint = root.querySelector('#qDefault')?.parentElement?.querySelector('.hint');
        if (hint) hint.textContent = `format = ${QUALITIES.find((q) => q.id === value)?.fmt || ''}`;
      }
    });
    /* number/text fields also live-update while typing */
    if (el.type === 'number' || el.type === 'text' || el.type === 'password') {
      el.addEventListener('input', () => {
        const value = el.type === 'number' ? Number(el.value) : el.value;
        state.settings[key] = value;
        save();
      });
    }
  });

  const click = (id, fn) => root.querySelector('#' + id)?.addEventListener('click', fn);

  click('askNotify', async () => {
    const res = await requestNotifyPermission();
    toast(res === 'granted' ? 'ok' : 'warn', res === 'granted' ? t('set.saved') : res, 'Notification');
  });

  click('testConn', async () => {
    const out = root.querySelector('#connOut');
    out.innerHTML = `<span class="spin"></span> ${esc(t('conn.checking'))}`;
    sharedClient.setConfig({ baseUrl: state.settings.apiUrl, token: state.settings.apiToken });
    const t0 = performance.now();
    try {
      const h = await sharedClient.health();
      const ms = Math.round(performance.now() - t0);
      state.ui.connOk = true; save();
      out.innerHTML = `✅ ${digits(ms)} ms · ${esc(h?.bot || 'backend')} · ffmpeg ${esc(h?.engines?.ffmpeg || '?')}`;
      toast('ok', t('toast.connOk'), `${ms} ms`);
    } catch (err) {
      state.ui.connOk = false; save();
      out.innerHTML = `❌ ${esc(err.message)}`;
      toast('err', t('toast.connFail'), err.message);
    }
    document.dispatchEvent(new CustomEvent('panel:conn'));
  });

  click('showServerCode', () => codeModal({
    title: 'api/server.py',
    filename: 'server.py',
    code: SERVER_SNIPPET,
  }));

  click('copyEnv', async () => toast(await copyText(buildEnv()) ? 'ok' : 'err', t('ui.copied'), '.env'));
  click('saveEnv', () => { downloadText('.env', buildEnv()); toast('ok', t('ui.download'), '.env'); });
  click('copyEnv2', async () => toast(await copyText(buildEnv()) ? 'ok' : 'err', t('ui.copied'), '.env'));
  click('saveEnv2', () => { downloadText('.env', buildEnv()); toast('ok', t('ui.download'), '.env'); });
  click('previewEnv', () => codeModal({ title: '.env', filename: '.env', code: buildEnv() }));

  click('clearFinished', () => { clearFinished(); toast('ok', t('ui.clearDone')); rerenderTab(root); });
  click('clearLogs2', () => { clearLogs(); toast('ok', t('logs.clear')); rerenderTab(root); });
  click('fullReset', async () => {
    if (await confirmDialog(t('set.resetSub'), { danger: true, okLabel: t('set.reset') })) {
      reset();
      toast('ok', t('set.resetDone'));
      document.dispatchEvent(new CustomEvent('panel:reset'));
    }
  });

  /* exporters */
  on(root, '[data-preview]', 'click', (_e, el) => {
    const e = EXPORTS.find((x) => x.id === el.dataset.preview);
    codeModal({ title: e.file, filename: e.file, code: e.build(state.settings) });
  });
  on(root, '[data-copy]', 'click', async (_e, el) => {
    const e = EXPORTS.find((x) => x.id === el.dataset.copy);
    toast(await copyText(e.build(state.settings)) ? 'ok' : 'err', t('ui.copied'), e.file);
  });
  on(root, '[data-save]', 'click', (_e, el) => {
    const e = EXPORTS.find((x) => x.id === el.dataset.save);
    downloadText(e.file, e.build(state.settings));
    toast('ok', t('ui.download'), e.file);
  });
}

function rerenderTab(root) {
  root.querySelector('#setBody').innerHTML = tabBody(state.ui.settingsTab || 'env');
  bind(root);
}

function storageUsage() {
  const key = 'dlbot.panel.v1';
  let bytes = 0;
  try { bytes = (localStorage.getItem(key) || '').length * 2; } catch { /* ignore */ }
  return { key, bytes };
}

function digitsPlain(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

/* short reference snippet shown from the backend tab */
const SERVER_SNIPPET = `# api/server.py — REST bridge for the online panel (full file in the repo)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from downloader import DownloaderEngine
from config import load_settings

app = FastAPI(title="downloader-bot web panel")
app.add_middleware(CORSMiddleware, allow_origins=["https://devlopergit04.github.io"],
                   allow_methods=["*"], allow_headers=["*"])
engine = DownloaderEngine(load_settings())

@app.get("/api/health")
async def health(): ...

@app.post("/api/jobs")
async def create_job(payload: JobIn): ...

@app.get("/api/jobs")
async def list_jobs(): ...
`;
