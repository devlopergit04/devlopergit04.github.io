/* format.js — human-readable numbers, sizes, speeds and times (fa + en). */

import { getLang, t } from './i18n.js';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Convert digits to Persian when the UI language is fa. */
export function digits(value) {
  const s = String(value);
  if (getLang() !== 'fa') return s;
  return s.replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}

/** gui/workers.py::_fmt — B / KB / MB / GB / TB */
export function fmtBytes(n, frac = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  let v = Number(n);
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (Math.abs(v) < 1024) return `${v.toFixed(unit === 'B' ? 0 : frac)} ${unit}`;
    v /= 1024;
  }
  return `${v.toFixed(frac)} TB`;
}

/** gui/workers.py::_speed_from — KiB/s style */
export function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KiB/s';
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KiB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MiB/s`;
}

export function fmtDuration(sec) {
  if (!sec || sec < 0 || !Number.isFinite(sec)) return '—';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${digits(Math.ceil(sec))}s`;
  if (sec < 3600) return `${digits(Math.ceil(sec / 60))}m`;
  return `${digits((sec / 3600).toFixed(1))}h`;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const locale = getLang() === 'fa' ? 'fa-IR' : 'en-GB';
  try { return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' }); }
  catch { return d.toISOString().replace('T', ' ').slice(0, 19); }
}

export function timeAgo(ts) {
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 5) return t('time.now');
  if (diff < 60) return t('time.ago', { n: digits(Math.floor(diff)) });
  if (diff < 3600) return t('time.minAgo', { n: digits(Math.floor(diff / 60)) });
  return t('time.hourAgo', { n: digits(Math.floor(diff / 3600)) });
}

export function pct(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

export function plural(n, fa, en) { return getLang() === 'fa' ? fa : (n === 1 ? en : `${en}s`); }

export function truncate(s, n = 60) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
