/* jobs.js — the queue manager. One code path for both modes:
     · demo → sim.js (modelled engines) + net.js (real browser fetch for direct links)
     · live → api.js (the Python backend does the work, we mirror its state)   */

import { state, save, emit, updateSettings } from './store.js';
import { engineFor, engineLabel, kindFor, friendlyName, detectUrls, normalizeUrl, suggestedFilename, KIND_ICON } from './engine.js';
import { describeUrl } from './sites.js';
import { runSimulated, CancelledError } from './sim.js';
import { realHttpDownload, saveBlob, RealDownloadError } from './net.js';
import { sharedClient, ApiError } from './api.js';
import * as L from './logs.js';
import { fmtBytes, fmtSpeed, timeAgo } from './format.js';
import { t, getLang } from './i18n.js';
import { toast } from './ui/overlays.js';

const ACTIVE = ['downloading', 'processing'];
const FINISHED = ['completed', 'error', 'cancelled'];
export { ACTIVE, FINISHED, KIND_ICON };

const controls = new Map();   // jobId → {paused, cancelled}
const running = new Map();    // jobId → Promise
let idSeq = 0;
let emitTimer = null;

/** Coalesced notify — progress ticks fire many times per second. */
export function notify(reason = 'jobs') {
  if (emitTimer) return;
  emitTimer = setTimeout(() => { emitTimer = null; emit(reason); }, 90);
}

const uid = () => `job_${Date.now().toString(36)}_${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ── creation ───────────────────────────────────────────────────────────── */

export function addText(text, opts = {}) {
  const urls = detectUrls(text);
  if (!urls.length) return { added: 0, dups: 0 };
  return addUrls(urls, opts);
}

export function addUrls(urls, { quality = state.settings.quality, autoStart = state.settings.autoStart } = {}) {
  let added = 0;
  let dups = 0;
  for (const raw of urls) {
    const url = normalizeUrl(String(raw).trim());
    if (!url) continue;
    if (state.jobs.some((j) => j.url === url && !FINISHED.includes(j.status))) { dups++; continue; }
    const engine = engineFor(url);
    const meta = describeUrl(url, quality);
    const job = {
      id: uid(),
      url,
      name: meta.title || friendlyName(url),
      engine: engineLabel(url).label,
      engineKey: engine,
      kind: kindFor(url, quality),
      quality,
      status: 'queued',
      phase: '',
      progress: 0,
      doneBytes: 0,
      totalBytes: meta.sizeBytes,
      speedBps: 0,
      etaSec: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      path: '',
      sizeBytes: 0,
      error: '',
      attempts: 0,
      real: false,
      meta: { ...meta, filename: suggestedFilename(url, meta.title, quality) },
    };
    state.jobs.unshift(job);
    added++;
    L.info(job.engine, `queued: ${url}`, { jobId: job.id });
    activity('added', job);
  }
  if (added) {
    save();
    notify();
    if (autoStart) startFree();
  }
  return { added, dups };
}

/* ── lifecycle ──────────────────────────────────────────────────────────── */

export function startFree() {
  if (state.settings.mode === 'live') return;      // the backend schedules
  const cap = Math.max(1, Number(state.settings.concurrency) || 3);
  let active = state.jobs.filter((j) => ACTIVE.includes(j.status)).length;
  for (const job of [...state.jobs].reverse()) {   // FIFO: oldest first
    if (active >= cap) break;
    if (job.status === 'queued') { start(job); active++; }
  }
}

function start(job) {
  if (state.settings.mode === 'live') { startLive(job); return; }
  const control = { paused: false, cancelled: false };
  controls.set(job.id, control);
  job.status = 'downloading';
  job.phase = 'connecting';
  job.error = '';
  job.startedAt = job.startedAt || Date.now();
  job.attempts++;
  notify();
  L.info('queue', `start ${job.engine} → ${job.url}`, { jobId: job.id });

  const p = runDemo(job, control)
    .then((result) => complete(job, result))
    .catch((err) => {
      if (err instanceof CancelledError || err?.reason === 'cancelled' || control.cancelled) {
        job.status = 'cancelled';
        job.phase = '';
        job.speedBps = 0;
        job.finishedAt = Date.now();
        state.stats.cancelled++;
        L.warn('queue', `cancelled: ${job.name}`, { jobId: job.id });
        activity('cancelled', job);
        toast('warn', t('toast.cancelled'), job.name);
      } else if (control.paused && job.status !== 'completed') {
        job.status = 'paused';
        job.phase = '';
        job.speedBps = 0;
        L.warn('queue', `paused: ${job.name}`, { jobId: job.id });
      } else {
        fail(job, err?.message || String(err));
      }
    })
    .finally(() => {
      controls.delete(job.id);
      running.delete(job.id);
      job.speedBps = job.status === 'downloading' ? job.speedBps : 0;
      save();
      notify();
      startFree();
    });
  running.set(job.id, p);
}

async function runDemo(job, control) {
  const settings = state.settings;
  const engine = job.engine;
  const hooks = {
    onLog: (level, message) => L.log(level, engine, message, { jobId: job.id, force: level !== 'DEBUG' }),
    onPhase: (phase) => { job.phase = phase; },
    onMeta: (meta) => {
      job.meta = { ...job.meta, ...meta };
      if (meta.title && (!job.name || job.name === friendlyName(job.url))) job.name = meta.title;
      job.kind = meta.kind || job.kind;
    },
  };
  const onProgress = (p) => {
    job.doneBytes = p.doneBytes;
    job.totalBytes = p.totalBytes || job.totalBytes;
    job.progress = p.percent ?? (job.totalBytes ? (p.doneBytes / job.totalBytes) * 100 : 0);
    job.speedBps = p.speedBps || 0;
    job.etaSec = p.etaSec ?? null;
    notify();
  };

  /* 1) direct links: try a REAL download in the browser first */
  if (job.engineKey === 'http' && settings.realBrowserDownloads) {
    try {
      L.info('HTTP', `browser fetch (real bytes) → ${job.url}`, { jobId: job.id });
      const res = await realHttpDownload(job.url, { onProgress, control });
      job.real = true;
      saveBlob(res.blob, res.filename);
      L.success('HTTP', `saved to browser download folder: ${res.filename} (${fmtBytes(res.sizeBytes)})`, { jobId: job.id });
      toast('ok', t('toast.savedReal'), `${res.filename} · ${fmtBytes(res.sizeBytes)}`);
      return {
        path: `browser-download://${res.filename}`,
        sizeBytes: res.sizeBytes,
        title: res.filename,
        kind: 'file',
        engine: 'HTTP',
        formats: [],
      };
    } catch (err) {
      if (err instanceof RealDownloadError && err.reason === 'cancelled') throw new CancelledError();
      if (err instanceof RealDownloadError && err.reason === 'toobig') {
        L.error('HTTP', err.message, { jobId: job.id });
        throw err;
      }
      L.warn('HTTP', `${err.message || err} — falling back to the simulator`, { jobId: job.id });
    }
  }

  /* 2) everything else: modelled engine run */
  return runSimulated(job, settings, { ...hooks, onProgress }, control);
}

function complete(job, result) {
  job.status = 'completed';
  job.progress = 100;
  job.phase = '';
  job.speedBps = 0;
  job.etaSec = null;
  job.finishedAt = Date.now();
  job.doneBytes = result.sizeBytes || job.totalBytes;
  job.sizeBytes = result.sizeBytes || job.totalBytes;
  job.path = result.path || '';
  job.name = result.title || job.name;
  job.kind = result.kind || job.kind;
  if (result.formats?.length) job.meta.formats = result.formats;
  if (result.durationSec) job.meta.durationSec = result.durationSec;
  if (result.resolution) job.meta.resolution = result.resolution;
  state.stats.completed++;
  state.stats.totalBytes += job.sizeBytes;
  L.success('queue', `completed: ${job.name} → ${job.path} (${fmtBytes(job.sizeBytes)})`, { jobId: job.id });
  activity('done', job);
  toast('ok', t('toast.done'), `${job.name} · ${fmtBytes(job.sizeBytes)}`);
  desktopNotify(job);
}

function fail(job, message) {
  job.status = 'error';
  job.phase = '';
  job.speedBps = 0;
  job.error = message;
  job.finishedAt = Date.now();
  state.stats.failed++;
  L.error(job.engine, `${message}`, { jobId: job.id });
  activity('error', job);
  toast('err', t('toast.failed'), message);
}

/* ── user actions ───────────────────────────────────────────────────────── */

export function pause(id) {
  const job = getJob(id); if (!job) return;
  const c = controls.get(id);
  if (c) { c.paused = true; job.status = 'paused'; job.phase = ''; job.speedBps = 0; L.warn('queue', `paused: ${job.name}`, { jobId: id }); }
  else if (state.settings.mode === 'live') liveAction(id, 'pause');
  notify(); save();
}

export function resume(id) {
  const job = getJob(id); if (!job) return;
  const c = controls.get(id);
  if (c) {
    c.paused = false;
    job.status = 'downloading';
    L.info('queue', `resumed: ${job.name}`, { jobId: id });
  } else if (job.status === 'paused' || job.status === 'error') {
    const wasError = job.status === 'error';
    job.status = 'queued';
    job.error = '';
    if (wasError) { job.progress = 0; job.doneBytes = 0; }
  }
  if (state.settings.mode === 'live') liveAction(id, 'resume');
  notify(); save(); startFree();
}

export function cancel(id) {
  const job = getJob(id); if (!job) return;
  const c = controls.get(id);
  if (c) { c.cancelled = true; c.paused = false; }
  else { job.status = 'cancelled'; job.finishedAt = Date.now(); job.speedBps = 0; state.stats.cancelled++; activity('cancelled', job); }
  if (state.settings.mode === 'live') liveAction(id, 'cancel');
  L.warn('queue', `cancel requested: ${job.name}`, { jobId: id });
  notify(); save(); startFree();
}

export function retry(id) {
  const job = getJob(id); if (!job) return;
  job.status = 'queued'; job.error = ''; job.progress = 0; job.doneBytes = 0; job.speedBps = 0; job.etaSec = null; job.finishedAt = null;
  L.info('queue', `retry #${job.attempts + 1}: ${job.url}`, { jobId: id });
  notify(); save(); startFree();
}

export function remove(id) {
  cancel(id);
  const i = state.jobs.findIndex((j) => j.id === id);
  if (i >= 0) state.jobs.splice(i, 1);
  controls.delete(id); running.delete(id);
  L.info('queue', `removed job ${id}`, { jobId: id });
  notify(); save(); startFree();
}

export function clearFinished() {
  const before = state.jobs.length;
  state.jobs = state.jobs.filter((j) => !FINISHED.includes(j.status));
  L.info('queue', `cleared ${before - state.jobs.length} finished job(s)`);
  notify(); save();
}

export function pauseAll() { state.jobs.filter((j) => j.status === 'downloading').forEach((j) => pause(j.id)); }
export function cancelAll() { state.jobs.filter((j) => !FINISHED.includes(j.status)).forEach((j) => cancel(j.id)); }
export function startAll() {
  state.jobs.filter((j) => j.status === 'paused' || j.status === 'queued').forEach((j) => { j.status = 'queued'; });
  notify(); save(); startFree();
}
export function retryFailed() { state.jobs.filter((j) => j.status === 'error').forEach((j) => retry(j.id)); }

export function getJob(id) { return state.jobs.find((j) => j.id === id) || null; }
export function selectedJob() { return getJob(state.ui.selectedJobId) || state.jobs.find((j) => !FINISHED.includes(j.status)) || state.jobs[0] || null; }

/* ── live backend bridge ────────────────────────────────────────────────── */

async function liveAction(id, action) {
  try { await sharedClient.jobAction(id, action); }
  catch (err) { L.error('api', `${action} failed for ${id}: ${err.message}`); }
}

export async function addLive(url, quality) {
  try {
    const job = await sharedClient.createJob({ url, quality });
    L.success('api', `server accepted job ${job.id} (${job.engine})`, { jobId: job.id });
    await syncLive();
    return true;
  } catch (err) {
    if (err instanceof ApiError) L.error('api', `POST /api/jobs failed: ${err.message}`);
    toast('err', t('toast.connFail'), err.message);
    return false;
  }
}

function startLive(job) { /* no-op: the backend schedules its own queue */ }

export async function syncLive() {
  try {
    const data = await sharedClient.listJobs();
    const remote = data?.jobs || [];
    mergeRemote(remote);
    return true;
  } catch (err) {
    L.error('api', `GET /api/jobs failed: ${err.message}`);
    return false;
  }
}

function mergeRemote(remote) {
  const seen = new Set();
  for (const r of remote) {
    seen.add(r.id);
    const local = state.jobs.find((j) => j.id === r.id);
    const mapped = mapRemote(r);
    if (local) {
      const before = local.status;
      Object.assign(local, mapped);
      noteTransition(before, local);
    } else {
      const fresh = { id: mapped.id, createdAt: Date.now(), attempts: 0, real: false, meta: {}, ...mapped };
      state.jobs.unshift(fresh);
      if (fresh.status === 'completed') noteTransition('queued', fresh);
    }
  }
  notify(); save();
}

/** Count/announce a status change that came from the server (live mode). */
function noteTransition(before, job) {
  if (!job || before === job.status) return;
  if (job.status === 'completed') {
    state.stats.completed++;
    state.stats.totalBytes += job.sizeBytes || 0;
    activity('done', job);
    L.success('api', `server finished ${job.name} (${fmtBytes(job.sizeBytes)})`, { jobId: job.id });
    toast('ok', t('toast.done'), `${job.name} · ${fmtBytes(job.sizeBytes)}`);
    desktopNotify(job);
  } else if (job.status === 'error') {
    state.stats.failed++;
    activity('error', job);
    L.error('api', `server reported failure for ${job.name}: ${job.error}`, { jobId: job.id });
    toast('err', t('toast.failed'), job.error || job.name);
  } else if (job.status === 'cancelled') {
    state.stats.cancelled++;
    activity('cancelled', job);
  }
}

/** Called by the SSE/polling stream with a full job list. */
export function applySnapshot(jobs) { mergeRemote(Array.isArray(jobs) ? jobs : []); }

/** Called by the SSE stream with a single job update. */
export function applyEvent(evt) {
  if (!evt) return;
  const payload = evt.job || evt;
  const id = payload.id || evt.job_id;
  const job = getJob(id);
  if (!job) { mergeRemote([payload]); return; }
  const before = job.status;
  Object.assign(job, mapRemote(payload));
  noteTransition(before, job);
  notify(); save();
}

function mapRemote(r) {
  return {
    id: r.id,
    url: r.url,
    name: r.title || friendlyName(r.url || ''),
    engine: r.engine || engineLabel(r.url || '').label,
    engineKey: engineFor(r.url || ''),
    kind: r.kind || kindFor(r.url || ''),
    quality: r.quality || 'best',
    status: r.status || 'queued',
    phase: r.phase || '',
    progress: Number(r.progress) || 0,
    doneBytes: Number(r.done_bytes) || 0,
    totalBytes: Number(r.total_bytes) || 0,
    speedBps: Number(r.speed_bps) || 0,
    etaSec: r.eta_sec ?? null,
    startedAt: r.started_at || null,
    finishedAt: r.finished_at || null,
    path: r.path || '',
    sizeBytes: Number(r.size_bytes) || 0,
    error: r.error || '',
    meta: r.meta || {},
  };
}

/* ── aggregates (status bar, dashboard, charts) ─────────────────────────── */

export function aggregates() {
  const jobs = state.jobs;
  const activeJobs = jobs.filter((j) => ACTIVE.includes(j.status));
  const speedBps = activeJobs.reduce((a, j) => a + (j.speedBps || 0), 0);
  const doneBytes = jobs.reduce((a, j) => a + (j.doneBytes || 0), 0);
  const totalBytes = jobs.reduce((a, j) => a + (j.totalBytes || j.sizeBytes || 0), 0);
  return {
    total: jobs.length,
    active: activeJobs.length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    paused: jobs.filter((j) => j.status === 'paused').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'error').length,
    cancelled: jobs.filter((j) => j.status === 'cancelled').length,
    speedBps,
    doneBytes,
    totalBytes,
    overallPercent: totalBytes ? Math.min(100, (doneBytes / totalBytes) * 100) : 0,
    byEngine: jobs.reduce((acc, j) => { acc[j.engine] = (acc[j.engine] || 0) + 1; return acc; }, {}),
    byKind: jobs.reduce((acc, j) => { acc[j.kind] = (acc[j.kind] || 0) + 1; return acc; }, {}),
    etaSec: speedBps > 0 && totalBytes > doneBytes ? (totalBytes - doneBytes) / speedBps : null,
  };
}

/** 1 Hz sampler for the dashboard sparkline + running averages. */
export function sampleTick() {
  const agg = aggregates();
  const samples = state.ui.speedSamples;
  samples.push({ ts: Date.now(), bps: agg.speedBps, active: agg.active });
  if (samples.length > 90) samples.splice(0, samples.length - 90);
  state.stats.totalSpeedBps = agg.speedBps;
  return agg;
}

/* ── activity feed + toasts ─────────────────────────────────────────────── */

export function activity(kind, job, extra = {}) {
  state.activity.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind, jobId: job?.id || null, title: job?.name || extra.title || kind,
    url: job?.url || extra.url || '', ts: Date.now(), detail: extra.detail || '',
  });
  if (state.activity.length > 80) state.activity.length = 80;
  save();
}

export { toast };

function desktopNotify(job) {
  if (!state.settings.notify) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('Downloader Bot', { body: `${job.name} — ${fmtBytes(job.sizeBytes)}`, tag: job.id });
  } catch { /* some browsers require a service worker registration */ }
}

export async function requestNotifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

/** Status line shown in the Qt-like status bar. */
export function statusMessage(agg = aggregates()) {
  if (state.settings.mode === 'live') {
    return agg.active ? `${agg.active} × ${t('status.downloading')} · ${fmtSpeed(agg.speedBps)}` : `${t('conn.liveOk')} · ${agg.total} job(s)`;
  }
  if (agg.active) return `${agg.active} × ${t('status.downloading')} — ${fmtSpeed(agg.speedBps)} · ${t('ui.eta')} ${agg.etaSec ? Math.ceil(agg.etaSec) + 's' : '—'}`;
  if (agg.queued) return `${agg.queued} × ${t('status.queued')}`;
  return t('queue.ready');
}

export { timeAgo, getLang, updateSettings };
