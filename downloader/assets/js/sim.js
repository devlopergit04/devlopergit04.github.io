/* sim.js — in-browser model of the three download engines.
   Produces the same event stream (logs, progress, speed, phases) that the real
   bot emits, so the UI behaves identically in demo mode and live mode. */

import { describeUrl } from './sites.js';
import { engineFor, friendlyName, suggestedFilename, qualityById } from './engine.js';

export class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} job      queue job (url, quality, id)
 * @param {object} settings panel settings (demoSpeedMbps, demoErrorRate, ytdlpRetries…)
 * @param {object} hooks    {onLog, onProgress, onPhase, onMeta}
 * @returns {Promise<{path:string,sizeBytes:number,title:string,kind:string,engine:string}>}
 */
export async function runSimulated(job, settings, hooks, control) {
  const url = job.url;
  const engine = engineFor(url);
  const meta = describeUrl(url, job.quality);
  const q = qualityById(job.quality);
  hooks.onMeta?.(meta);

  const filename = suggestedFilename(url, meta.title, job.quality);
  const outDir = String(settings.downloadDir || './downloads').replace(/\/+$/, '');
  const path = engine === 'gallery'
    ? `${outDir}/${meta.site || 'gallery'}/${filename}`
    : `${outDir}/${filename}`;

  const totalBytes = meta.sizeBytes;
  const targetBps = Math.max(0.4, Number(settings.demoSpeedMbps) || 45) * 1e6 / 8;
  const errRate = Math.max(0, Math.min(100, Number(settings.demoErrorRate) || 0)) / 100;

  const isCancelled = () => control?.cancelled === true;
  const waitIfPaused = async () => {
    while (control?.paused === true && !isCancelled()) await sleep(90);
    if (isCancelled()) throw new CancelledError();
  };

  const maybeFail = (stage) => {
    if (!errRate) return null;
    if (Math.random() > errRate * 0.35) return null;
    const pool = engine === 'http'
      ? [`HTTP Error 403: Forbidden (${url})`, 'HTTP Error 404: Not Found', 'aiohttp.ClientConnectorError: cannot connect to host', 'Content-Length missing and connection dropped']
      : engine === 'gallery'
        ? [`gallery-dl: No images found in ${url}`, 'gallery-dl.exception.AuthorizationError: login required', 'HTTP Error 429: Too Many Requests']
        : ['ERROR: [youtube] This video is unavailable in your country due to a copyright restriction', 'ERROR: Unable to extract initial data', 'ffmpeg: not found — cannot merge video+audio streams', 'ERROR: fragment not downloaded (retrying)'];
    return pool[Math.floor(Math.random() * pool.length)] + ` [${stage}]`;
  };

  let doneBytes = job.doneBytes || 0;
  const startedAt = Date.now();
  const report = (extra = {}) => {
    const elapsed = Math.max(0.35, (Date.now() - startedAt) / 1000);
    const speed = extra.speedBps ?? ((doneBytes - (job.doneBytes || 0)) / elapsed);
    hooks.onProgress({
      doneBytes, totalBytes,
      percent: totalBytes ? Math.min(100, (doneBytes / totalBytes) * 100) : 0,
      speedBps: speed,
      etaSec: speed > 0 ? (totalBytes - doneBytes) / speed : null,
    });
  };

  /* ── phase 1: extraction / connection ─────────────────────────────────── */
  if (engine === 'http') {
    hooks.onLog('INFO', `HTTP GET ${url}`);
    hooks.onPhase('connecting');
    await sleep(220 + Math.random() * 420); await waitIfPaused();
    hooks.onLog('DEBUG', `User-Agent: Mozilla/5.0 (compatible; DownloaderBot/1.0)`);
    hooks.onLog('DEBUG', `Content-Length: ${totalBytes} — saving as ${filename}`);
  } else if (engine === 'gallery') {
    hooks.onPhase('extracting');
    hooks.onLog('INFO', `[${meta.site?.toLowerCase() || 'gallery'}] Extracting URL: ${url}`);
    await sleep(260 + Math.random() * 500); await waitIfPaused();
    const count = 1 + Math.floor(Math.random() * 11);
    hooks.onLog('INFO', `[${meta.site?.toLowerCase() || 'gallery'}] Found ${count} file(s) — recursive: true`);
    meta.files = count;
    hooks.onMeta?.(meta);
  } else {
    hooks.onPhase('extracting');
    hooks.onLog('INFO', `[generic] Extracting URL: ${url}`);
    await sleep(200 + Math.random() * 400); await waitIfPaused();
    hooks.onLog('DEBUG', `[download] Available formats: ${meta.formats.length}`);
    hooks.onLog('INFO', `[download] Destination: ${outDir}/${friendlyName(url)}`);
    if (q.id !== 'audio' && job.quality === 'best') {
      hooks.onLog('DEBUG', `[download] format: ${q.fmt}`);
    }
    hooks.onLog('DEBUG', `retries=${settings.ytdlpRetries} concurrent_fragment_downloads=${settings.ytdlpConcurrent} geo_bypass=True`);
  }

  const fail = maybeFail('extract');
  if (fail) { hooks.onLog('ERROR', fail); throw new Error(fail); }

  /* ── phase 2: transfer ────────────────────────────────────────────────── */
  hooks.onPhase('downloading');
  let tick = 0;
  while (doneBytes < totalBytes) {
    await waitIfPaused();
    const stepMs = 140;
    await sleep(stepMs);
    tick++;

    // ramp-up then steady jitter, like a real socket
    const ramp = Math.min(1, tick / 6);
    const jitter = 0.62 + Math.random() * 0.78;
    const chunk = targetBps * (stepMs / 1000) * ramp * jitter;
    doneBytes = Math.min(totalBytes, doneBytes + chunk);

    if (tick % 12 === 0) {
      const pctNow = Math.round((doneBytes / totalBytes) * 100);
      hooks.onLog('DEBUG', `[download] ${pctNow}% of ${fmt(totalBytes)} @ ${fmtSpeedLocal(targetBps * jitter)}`);
    }
    // a transient hiccup that retries (only when the user asked for chaos)
    if (errRate && tick % 30 === 0 && Math.random() < errRate) {
      hooks.onLog('WARNING', `[download] unable to download fragment — retrying (1/${settings.ytdlpRetries})`);
      await sleep(320);
    }
    report({ speedBps: targetBps * ramp * jitter });

    const hardFail = maybeFail('transfer');
    if (hardFail && doneBytes > totalBytes * 0.15 && Math.random() < 0.06) {
      hooks.onLog('ERROR', hardFail);
      throw new Error(hardFail);
    }
  }
  await waitIfPaused();
  report({ speedBps: 0 });

  /* ── phase 3: post-processing ─────────────────────────────────────────── */
  if (engine === 'http') {
    hooks.onPhase('processing');
    hooks.onLog('DEBUG', `closing stream — wrote ${fmt(totalBytes)} to ${path}`);
    await sleep(140);
  } else if (engine === 'gallery') {
    hooks.onPhase('processing');
    hooks.onLog('INFO', `[${meta.site?.toLowerCase() || 'gallery'}] wrote ${meta.files} file(s) to ${path}`);
    await sleep(220);
  } else {
    hooks.onPhase('processing');
    if (q.id === 'audio') {
      hooks.onLog('INFO', '[ExtractAudio] Destination: ' + path.replace(/\.[^.]+$/, '.mp3'));
      hooks.onLog('DEBUG', q.post);
      await sleep(520 + Math.random() * 420);
    } else {
      hooks.onLog('INFO', `[Merger] Merging formats into "${path}"`);
      hooks.onLog('DEBUG', 'ffmpeg version 6.1 — concat demuxer');
      await sleep(600 + Math.random() * 600);
    }
  }
  await waitIfPaused();
  if (isCancelled()) throw new CancelledError();

  hooks.onLog('SUCCESS', `done: ${path} (${fmt(totalBytes)})`);
  return {
    path,
    sizeBytes: Math.round(totalBytes),
    title: meta.title,
    kind: meta.kind,
    engine: meta.engineLabel,
    durationSec: meta.durationSec,
    resolution: meta.resolution,
    formats: meta.formats,
  };
}

function fmt(n) {
  let v = Number(n);
  for (const u of ['B', 'KB', 'MB', 'GB']) {
    if (v < 1024) return `${v.toFixed(u === 'B' ? 0 : 1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TB`;
}
function fmtSpeedLocal(bps) {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(0)} KiB/s`;
  return `${(bps / 1048576).toFixed(2)} MiB/s`;
}

/** Build the Telegram-style progress bar used in handlers/messages.py::_bar */
export function telegramBar(percent) {
  const filled = Math.round(percent / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
