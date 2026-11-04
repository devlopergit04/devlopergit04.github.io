/* engine.js — browser port of downloader/engine.py + gui/workers.py::_engine_for
   Keeps the routing rules byte-for-byte compatible with the Python bot so the
   panel always shows the same engine the bot would pick. */

/** Same regex as engine.py::URL_RE (tolerates the shapes people paste in chat). */
export const URL_RE = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~%]+(?:\/[A-Za-z0-9\-._~%!/?#[\]@:+&=,;]*)?/gi;

/** engine.py::GALLERY_DOMAINS */
export const GALLERY_DOMAINS = [
  'instagram.com', 'x.com', 'twitter.com', 'pikabu.ru', 'behance.net',
  'deviantart.com', '500px.com', 'flickr.com', 'pinterest.com',
  'reddit.com', 'imgur.com',
];

/** engine.py::DIRECT_DOMAINS */
export const DIRECT_DOMAINS = [
  'github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
];

/** gui/workers.py::FILE_EXT — extensions that are almost certainly direct files. */
export const FILE_EXT = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm',
  '.jar', '.bin', '.iso', '.img', '.apk', '.appx',
  '.csv', '.txt', '.json', '.xml', '.yaml', '.yml',
];

/** Domains handled by the audio path of yt-dlp. */
export const AUDIO_DOMAINS = ['soundcloud.com', 'audiomack.com', 'mixcloud.com', 'bandcamp.com'];

export const ENGINES = {
  ytdlp: { id: 'yt-dlp', label: 'yt-dlp', icon: 'i-video', color: '#10b981' },
  gallery: { id: 'gallery-dl', label: 'gallery-dl', icon: 'i-image', color: '#38bdf8' },
  http: { id: 'http', label: 'HTTP', icon: 'i-file', color: '#f59e0b' },
};

/* ── quality presets → yt-dlp `format` selector ─────────────────────────── */
export const QUALITIES = [
  { id: 'best', height: null, fmt: 'bestvideo*+bestaudio/best,bestquality/best', ext: 'mp4' },
  { id: '2160', height: 2160, fmt: 'bestvideo[height<=?2160]+bestaudio/best[height<=?2160]', ext: 'mp4' },
  { id: '1440', height: 1440, fmt: 'bestvideo[height<=?1440]+bestaudio/best[height<=?1440]', ext: 'mp4' },
  { id: '1080', height: 1080, fmt: 'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]', ext: 'mp4' },
  { id: '720', height: 720, fmt: 'bestvideo[height<=?720]+bestaudio/best[height<=?720]', ext: 'mp4' },
  { id: '480', height: 480, fmt: 'bestvideo[height<=?480]+bestaudio/best[height<=?480]', ext: 'mp4' },
  { id: 'audio', height: null, fmt: 'bestaudio/best', ext: 'mp3', post: 'ffmpeg -i input -vn -acodec libmp3lame -q:a 0 output.mp3' },
];

export function qualityById(id) {
  return QUALITIES.find((q) => q.id === id) || QUALITIES[0];
}

/* ── URL helpers ────────────────────────────────────────────────────────── */

/** engine.py::DownloaderEngine.detect_url — first URL inside arbitrary text. */
export function detectUrl(text) {
  const m = (text || '').match(URL_RE);
  return m ? m[0] : null;
}

/** Every URL in a block of text (one per line, or inline). */
export function detectUrls(text) {
  const out = [];
  const src = (text || '').replace(URL_RE, (m) => { out.push(m); return ' '; });
  void src;
  // de-duplicate while preserving order
  return [...new Set(out.map(normalizeUrl))];
}

export function normalizeUrl(url) {
  if (/^www\./i.test(url)) return 'https://' + url;
  return url;
}

export function hostOf(url) {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

export function pathOf(url) {
  try { return new URL(normalizeUrl(url)).pathname; }
  catch { return ''; }
}

export function extOf(url) {
  const p = pathOf(url).toLowerCase();
  const dot = p.lastIndexOf('.');
  return dot > p.lastIndexOf('/') ? p.slice(dot) : '';
}

/** engine.py::_classify — 'direct' | 'gallery' | 'video' */
export function classify(url) {
  const low = (url || '').toLowerCase();
  if (DIRECT_DOMAINS.some((d) => low.includes(d))) return 'direct';
  if (GALLERY_DOMAINS.some((d) => low.includes(d))) return 'gallery';
  return 'video';
}

/** gui/workers.py::_engine_for — 'http' | 'gallery' | 'video' */
export function engineFor(url) {
  const low = (url || '').toLowerCase();
  const path = low.split('?')[0].split('#')[0];
  if (DIRECT_DOMAINS.some((d) => low.includes(d))) return 'http';
  if (FILE_EXT.some((ext) => path.endsWith(ext))) return 'http';
  if (GALLERY_DOMAINS.some((d) => low.includes(d))) return 'gallery';
  return 'video';
}

/** Human label of the engine that will handle a URL. */
export function engineLabel(url) {
  const e = engineFor(url);
  if (e === 'http') return ENGINES.http;
  if (e === 'gallery') return ENGINES.gallery;
  return ENGINES.ytdlp;
}

/** downloader/models.py::DownloadResult.kind */
export function kindFor(url, qualityId = 'best') {
  const e = engineFor(url);
  if (e === 'gallery') return 'image';
  if (e === 'http') return 'file';
  if (qualityId === 'audio') return 'audio';
  if (AUDIO_DOMAINS.some((d) => (url || '').toLowerCase().includes(d))) return 'audio';
  return 'video';
}

export const KIND_ICON = { video: 'i-video', audio: 'i-audio', image: 'i-image', file: 'i-file' };

/** gui/main_window.py::_friendly_name */
export function friendlyName(url) {
  try {
    const p = new URL(normalizeUrl(url)).pathname;
    const last = p.replace(/\/+$/, '').split('/').pop();
    if (last) return decodeURIComponent(last).slice(0, 60);
  } catch { /* fall through */ }
  const host = hostOf(url);
  return (host || String(url)).slice(0, 60);
}

/** Build the yt-dlp option dict the bot would use (for the detail drawer). */
export function ytdlpOptions(settings, qualityId) {
  const q = qualityById(qualityId);
  return {
    format: q.fmt,
    outtmpl: `${settings.downloadDir}/%(title)s.%(ext)s`,
    merge_output_format: q.id === 'audio' ? 'mp3' : 'mp4',
    retries: settings.ytdlpRetries,
    concurrent_fragment_downloads: settings.ytdlpConcurrent,
    noplaylist: true,
    quiet: true,
    no_warnings: true,
    noprogress: true,
    geo_bypass: true,
    extractor_args: { youtube: { player_client: 'default' } },
  };
}

export function galleryOptions(settings) {
  return {
    out: `${settings.downloadDir}/%(path)s/%(filename)s`,
    cache: true,
    recursive: true,
    continue: true,
  };
}

export function httpOptions() {
  return {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DownloaderBot/1.0)' },
    timeout: { total: null, sock_connect: 30 },
    chunk: 65536,
  };
}

/** Which option dict applies to a URL (used by the UI + exporters). */
export function optionsFor(url, settings, qualityId) {
  const e = engineFor(url);
  if (e === 'gallery') return { engine: ENGINES.gallery, options: galleryOptions(settings) };
  if (e === 'http') return { engine: ENGINES.http, options: httpOptions() };
  return { engine: ENGINES.ytdlp, options: ytdlpOptions(settings, qualityId) };
}

/** Suggest an output filename the way the bot would name it. */
export function suggestedFilename(url, title, qualityId) {
  const q = qualityById(qualityId);
  const kind = kindFor(url, qualityId);
  const safe = String(title || friendlyName(url)).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 70) || 'download';
  if (kind === 'image') return `${safe}.jpg`;
  if (kind === 'file') return extOf(url) ? `${safe}${extOf(url)}` : safe;
  if (kind === 'audio') return `${safe}.mp3`;
  return `${safe}.${q.ext}`;
}
