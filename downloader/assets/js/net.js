/* net.js — the *real* HTTP engine inside the browser.
   For direct links whose server allows CORS (e.g. raw.githubusercontent.com,
   most CDNs, speed-test files) the panel genuinely streams the bytes, reports
   real progress and hands you the finished file. Anything the browser blocks
   (opaque CORS, private sites, media extractors) is reported so the queue can
   fall back to the simulator or the live backend. */

import { friendlyName, extOf } from './engine.js';

export const MAX_BROWSER_BYTES = 256 * 1024 * 1024; // keep RAM sane

export class RealDownloadError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse a filename from Content-Disposition, else from the URL (mirrors http.py). */
export function filenameFromHeaders(headers, url) {
  const cd = headers.get('content-disposition') || '';
  if (cd.includes('filename')) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m && m[1]) return decodeURIComponent(m[1]).trim();
  }
  const last = decodeURIComponent(url.split('?')[0].split('#')[0].split('/').pop() || '');
  return last || `download${extOf(url) || '.bin'}`;
}

/**
 * Stream a direct link to a Blob with live progress.
 * @returns {Promise<{blob:Blob,filename:string,sizeBytes:number,contentType:string}>}
 */
export async function realHttpDownload(url, { onProgress, control, signal } = {}) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  let resp;
  try {
    resp = await fetch(url, { signal: ac.signal, mode: 'cors', credentials: 'omit', redirect: 'follow' });
  } catch (err) {
    if (ac.signal.aborted) throw new RealDownloadError('cancelled', 'aborted');
    throw new RealDownloadError('cors', `Browser blocked the request (CORS/network): ${err.message || err}`);
  }
  if (!resp.ok) throw new RealDownloadError('http', `HTTP Error ${resp.status}: ${resp.statusText || ''}`.trim());

  const total = Number(resp.headers.get('content-length')) || 0;
  if (total > MAX_BROWSER_BYTES) {
    ac.abort();
    throw new RealDownloadError('toobig', `File is ${(total / 1048576).toFixed(0)} MB — too large for an in-browser download (limit ${MAX_BROWSER_BYTES / 1048576} MB). Use the live backend.`);
  }
  const filename = filenameFromHeaders(resp.headers, url);
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';

  // No reader (opaque/cached response) → fall back to a single .blob() read.
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const blob = await resp.blob();
    onProgress?.({ doneBytes: blob.size, totalBytes: blob.size || total, percent: 100, speedBps: 0, etaSec: 0 });
    return { blob, filename, sizeBytes: blob.size, contentType };
  }

  const reader = resp.body.getReader();
  const chunks = [];
  let done = 0;
  const started = Date.now();
  let lastReport = 0;

  for (;;) {
    if (control?.cancelled) { ac.abort(); throw new RealDownloadError('cancelled', 'aborted'); }
    while (control?.paused) { await sleep(90); if (control?.cancelled) { ac.abort(); throw new RealDownloadError('cancelled', 'aborted'); } }

    const { value, done: finished } = await reader.read();
    if (finished) break;
    if (value) {
      chunks.push(value);
      done += value.byteLength;
      const now = Date.now();
      if (now - lastReport > 110 || done === total) {
        lastReport = now;
        const elapsed = Math.max(0.25, (now - started) / 1000);
        const speed = done / elapsed;
        onProgress?.({
          doneBytes: done,
          totalBytes: total || done,
          percent: total ? Math.min(100, (done / total) * 100) : null,
          speedBps: speed,
          etaSec: total && speed > 0 ? (total - done) / speed : null,
        });
      }
    }
  }

  const blob = new Blob(chunks, { type: contentType });
  onProgress?.({ doneBytes: blob.size, totalBytes: blob.size, percent: 100, speedBps: 0, etaSec: 0 });
  return { blob, filename, sizeBytes: blob.size, contentType };
}

/** Trigger a real browser "Save file" for a Blob. */
export function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename || friendlyName('download');
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 20_000);
  return href;
}

/** Cheap HEAD probe used by the detail drawer ("can the browser fetch this?"). */
export async function probeDirect(url, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ac.signal, mode: 'cors', credentials: 'omit' });
    return {
      ok: r.ok, status: r.status,
      size: Number(r.headers.get('content-length')) || null,
      type: r.headers.get('content-type') || null,
    };
  } catch (err) {
    return { ok: false, status: 0, error: String(err.message || err), blocked: true };
  } finally {
    clearTimeout(timer);
  }
}
