/* logs.js — ring-buffered log bus shared by every module (queue, engines, api). */

import { state, save, emit } from './store.js';

export const LEVELS = ['DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'];
const LEVEL_ORDER = { DEBUG: 10, INFO: 20, SUCCESS: 25, WARNING: 30, ERROR: 40 };

let seq = 0;

/** log('INFO', 'yt-dlp', '[youtube] Extracting URL: …', {jobId}) */
export function log(level, source, message, meta = {}) {
  const minLevel = LEVEL_ORDER[String(state.settings.logLevel || 'INFO').toUpperCase()] ?? 20;
  const entry = {
    id: ++seq,
    ts: Date.now(),
    level: String(level).toUpperCase(),
    source: String(source || 'panel'),
    message: String(message),
    jobId: meta.jobId || null,
  };
  if (!meta.force && LEVEL_ORDER[entry.level] < minLevel) return entry; // filtered like Python logging
  state.logs.push(entry);
  const cap = Math.max(50, state.settings.maxLogs | 0);
  if (state.logs.length > cap) state.logs.splice(0, state.logs.length - cap);
  save();
  emit('logs');
  return entry;
}

export const debug = (src, m, meta) => log('DEBUG', src, m, meta);
export const info = (src, m, meta) => log('INFO', src, m, meta);
export const success = (src, m, meta) => log('SUCCESS', src, m, { ...meta, force: true });
export const warn = (src, m, meta) => log('WARNING', src, m, { ...meta, force: true });
export const error = (src, m, meta) => log('ERROR', src, m, { ...meta, force: true });

export function filteredLogs() {
  const f = state.ui.logFilter;
  return state.logs.filter((l) => f.levels.includes(l.level)
    && (f.source === 'all' || l.source === f.source)
    && (!f.jobId || l.jobId === f.jobId));
}

export function sources() {
  return [...new Set(state.logs.map((l) => l.source))].sort();
}

export function clearLogs() {
  state.logs = [];
  save();
  emit('logs');
}

export function formatLine(l) {
  const d = new Date(l.ts);
  const stamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  return `${stamp} ${l.level.padEnd(7)} ${l.source}: ${l.message}`;
}

export function exportLogs() {
  return filteredLogs().map(formatLine).join('\n') + '\n';
}
