/* store.js — tiny observable store with localStorage persistence. */

const KEY = 'dlbot.panel.v1';

export const DEFAULT_SETTINGS = {
  /* mirrors .env.example / config.py */
  telegramBotToken: '',
  allowedUserId: '',
  maxUploadMb: 50,
  downloadDir: './downloads',
  ytdlpRetries: 10,
  ytdlpConcurrent: 4,
  logLevel: 'INFO',
  extraFormats: 'bestvideo*+bestaudio/best,bestquality/best',
  /* panel preferences */
  lang: 'fa',
  theme: 'dark',
  compact: false,
  notify: true,
  keepLogs: true,
  maxLogs: 600,
  /* connection */
  mode: 'demo',
  apiUrl: 'http://127.0.0.1:8787',
  apiToken: '',
  pollInterval: 2,
  webHost: '0.0.0.0',
  webPort: 8787,
  webCors: 'https://devlopergit04.github.io',
  /* queue behaviour */
  quality: 'best',
  concurrency: 3,
  autoStart: true,
  realBrowserDownloads: true,
  demoSpeedMbps: 45,
  demoErrorRate: 0,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  jobs: [],
  logs: [],
  activity: [],
  stats: { totalBytes: 0, completed: 0, failed: 0, cancelled: 0, startedAt: Date.now() },
  telegram: { messages: [], userId: '987654321', asOtherUser: false, lastPing: null, pingMs: null },
  ui: { route: 'dashboard', selectedJobId: null, drawerJobId: null, logFilter: { levels: ['DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'], source: 'all', autoScroll: true, wrap: true }, settingsTab: 'env', siteQuery: '', speedSamples: [] },
};

const listeners = new Set();
let saveTimer = null;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason = 'change') { for (const fn of listeners) fn(reason, state); }

/** Debounced persistence (jobs/logs can change many times per second). */
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const payload = {
        v: 1,
        settings: state.settings,
        stats: state.stats,
        logs: state.settings.keepLogs ? state.logs.slice(-state.settings.maxLogs) : [],
        activity: state.activity.slice(0, 60),
        telegram: { ...state.telegram, messages: state.telegram.messages.slice(-40) },
        ui: { logFilter: state.ui.logFilter, settingsTab: state.ui.settingsTab },
        jobs: state.jobs.map((j) => ({
          ...j,
          /* an in-flight job cannot survive a reload → park it as paused */
          status: j.status === 'downloading' || j.status === 'processing' ? 'paused' : j.status,
          speedBps: 0,
        })),
      };
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (err) {
      /* quota / private mode — the panel still works in memory */
      console.warn('[store] persist failed', err);
    }
  }, 350);
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return; }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (Array.isArray(data.jobs)) state.jobs = data.jobs.filter((j) => j && j.id && j.url);
    if (Array.isArray(data.logs)) state.logs = data.logs;
    if (Array.isArray(data.activity)) state.activity = data.activity;
    if (data.telegram) state.telegram = { ...state.telegram, ...data.telegram };
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    if (data.ui) state.ui = { ...state.ui, ...data.ui };
  } catch (err) {
    console.warn('[store] corrupt state, starting fresh', err);
  }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state.settings = { ...DEFAULT_SETTINGS };
  state.jobs = [];
  state.logs = [];
  state.activity = [];
  state.stats = { totalBytes: 0, completed: 0, failed: 0, cancelled: 0, startedAt: Date.now() };
  state.ui.speedSamples = [];
  emit('reset');
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
  emit('settings');
}
