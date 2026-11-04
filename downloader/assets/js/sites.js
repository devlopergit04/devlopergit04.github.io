/* sites.js — the catalogue behind the "supported sites" view.
   Also feeds the simulator with plausible metadata (titles, formats, sizes)
   per service so the demo queue behaves like the real bot. */

import { engineFor, kindFor } from './engine.js';

/** {id, name, domain, engine, kinds[], note, sample} */
export const SITES = [
  { id: 'youtube', name: 'YouTube', domain: 'youtube.com', engine: 'yt-dlp', kinds: ['video', 'audio'], note: 'ویدئو، صدا، thumbnail و Playlist تا 8K', sample: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', short: 'youtu.be' },
  { id: 'youtu', name: 'YouTube (کوتاه)', domain: 'youtu.be', engine: 'yt-dlp', kinds: ['video', 'audio'], note: 'لینک‌های کوتاه youtu.be', sample: 'https://youtu.be/dQw4w9WgXcQ' },
  { id: 'tiktok', name: 'TikTok', domain: 'tiktok.com', engine: 'yt-dlp', kinds: ['video', 'audio'], note: 'ویدئو بدون واترمارک', sample: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' },
  { id: 'instagram', name: 'Instagram', domain: 'instagram.com', engine: 'gallery-dl', kinds: ['image', 'video'], note: 'پست، Reels و گالری چندعکسی', sample: 'https://www.instagram.com/p/C8xample1/' },
  { id: 'x', name: 'X / Twitter', domain: 'x.com', engine: 'gallery-dl', kinds: ['video', 'image'], note: 'ویدئو، GIF و تصویر از توییت', sample: 'https://x.com/i/status/1800000000000000000', short: 'twitter.com' },
  { id: 'facebook', name: 'Facebook', domain: 'facebook.com', engine: 'yt-dlp', kinds: ['video'], note: 'ویدئوی پست‌های عمومی و Reels', sample: 'https://www.facebook.com/watch/?v=1234567890' },
  { id: 'twitch', name: 'Twitch', domain: 'twitch.tv', engine: 'yt-dlp', kinds: ['video'], note: 'VOD، کلیپ و استریم زنده', sample: 'https://www.twitch.tv/videos/2000000000' },
  { id: 'vimeo', name: 'Vimeo', domain: 'vimeo.com', engine: 'yt-dlp', kinds: ['video'], note: 'ویدئوی کامل با کیفیت اصلی', sample: 'https://vimeo.com/76979871' },
  { id: 'soundcloud', name: 'SoundCloud', domain: 'soundcloud.com', engine: 'yt-dlp', kinds: ['audio'], note: 'صدا و آلبوم‌ها', sample: 'https://soundcloud.com/forss/flickermood' },
  { id: 'reddit', name: 'Reddit', domain: 'reddit.com', engine: 'gallery-dl', kinds: ['image', 'video'], note: 'تصویر و گالری از subreddit', sample: 'https://www.reddit.com/r/EarthPorn/comments/1c8xample/' },
  { id: 'imgur', name: 'Imgur', domain: 'imgur.com', engine: 'gallery-dl', kinds: ['image'], note: 'آلبوم و تصویر تکی', sample: 'https://imgur.com/gallery/xample99' },
  { id: 'behance', name: 'Behance', domain: 'behance.net', engine: 'gallery-dl', kinds: ['image'], note: 'پروژه‌های طراحی با رزولوشن کامل', sample: 'https://www.behance.net/gallery/200000000/Sample-Project' },
  { id: 'deviantart', name: 'DeviantArt', domain: 'deviantart.com', engine: 'gallery-dl', kinds: ['image'], note: 'آثار و گالری هنرمندان', sample: 'https://www.deviantart.com/sample/art/Sample-1000000000' },
  { id: 'flickr', name: 'Flickr', domain: 'flickr.com', engine: 'gallery-dl', kinds: ['image'], note: 'عکس‌های اورجینال و آلبوم', sample: 'https://www.flickr.com/photos/sample/53000000000' },
  { id: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', engine: 'gallery-dl', kinds: ['image'], note: 'پین‌ها و بردها', sample: 'https://www.pinterest.com/pin/100000000000000000/' },
  { id: '500px', name: '500px', domain: '500px.com', engine: 'gallery-dl', kinds: ['image'], note: 'عکاسی حرفه‌ای', sample: 'https://500px.com/photo/300000000/sample' },
  { id: 'pikabu', name: 'Pikabu', domain: 'pikabu.ru', engine: 'gallery-dl', kinds: ['image'], note: 'پست‌های تصویری', sample: 'https://pikabu.ru/story/sample_10000000' },
  { id: 'github', name: 'GitHub Releases', domain: 'github.com', engine: 'HTTP', kinds: ['file'], note: 'فایل Release، سورس و raw', sample: 'https://github.com/devlopergit04/downloader-bot/archive/refs/heads/main.zip' },
  { id: 'ghraw', name: 'GitHub Raw', domain: 'raw.githubusercontent.com', engine: 'HTTP', kinds: ['file'], note: 'فایل خام مخزن', sample: 'https://raw.githubusercontent.com/devlopergit04/downloader-bot/main/README.md' },
  { id: 'direct', name: 'فایل مستقیم', domain: 'any-domain.com', engine: 'HTTP', kinds: ['file'], note: 'zip, exe, pdf, iso, apk و هر لینک مستقیم دیگر', sample: 'https://speed.hetzner.de/100MB.bin' },
  { id: 'generic', name: 'هر سایت دیگر', domain: '*', engine: 'yt-dlp', kinds: ['video', 'audio'], note: 'بیش از ۱۸۰۰ استخراج‌کننده‌ی yt-dlp به‌صورت خودکار', sample: 'https://www.dailymotion.com/video/x8sample' },
];

export const SITE_BY_ID = Object.fromEntries(SITES.map((s) => [s.id, s]));

/** Which catalogue entry matches a URL (used for nicer titles in demo mode). */
export function matchSite(url) {
  const low = (url || '').toLowerCase();
  let best = null;
  for (const s of SITES) {
    if (s.domain === '*') continue;
    if (low.includes(s.domain) || (s.short && low.includes(s.short))) {
      if (!best || s.domain.length > best.domain.length) best = s;
    }
  }
  return best;
}

/** Deterministic-ish hash so the same URL always simulates the same file. */
export function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIDEO_TITLES = [
  'آموزش کامل پایتون — جلسه اول', 'Nature 4K Relaxation Film', 'Top 10 Engineering Fails',
  'Lofi Hip Hop Radio — Beats to Study', 'Build a Telegram Bot in 20 Minutes',
  'Unboxing the Fastest SSD of 2026', 'Street Food Tour — Tehran Bazaar',
  'Deep Dive: How yt-dlp Works', 'Cinematic Drone Footage (HDR)', 'Full Conference Keynote',
];
const AUDIO_TITLES = ['Midnight Drive — Single', 'Podcast #128: Open Source', 'Ambient Study Mix', 'Live Session (Mastered)'];
const IMAGE_TITLES = ['Gallery — 12 photos', 'Project Cover Art', 'Album: Summer Set', 'Wallpaper Pack 8K'];
const FILE_TITLES = ['release-assets.zip', 'installer-1.0.0.exe', 'dataset.json', 'archive.tar.gz', 'document.pdf'];

/** Format table the way `yt-dlp -F` would print it. */
function fakeFormats(rnd, kind, maxHeight) {
  const heights = [2160, 1440, 1080, 720, 480, 360, 240, 144].filter((h) => h <= maxHeight);
  const rows = [];
  if (kind === 'video') {
    heights.forEach((h, i) => {
      const vbr = Math.round((h * h) / 55 + rnd() * 400);
      rows.push({
        id: `${137 - i}`, ext: h >= 1440 ? 'mp4' : 'mp4',
        resolution: `${Math.round(h * 16 / 9)}x${h}`, height: h, fps: h >= 1080 ? 60 : 30,
        vcodec: 'avc1.640028', acodec: 'none', filesize: Math.round(vbr * 1000 * (60 + rnd() * 120) / 8),
        tbr: vbr, note: h >= 1440 ? 'HDR' : '',
      });
    });
    [0, 1].forEach((i) => rows.push({
      id: `${251 - i}`, ext: i ? 'm4a' : 'webm', resolution: 'audio only', height: 0,
      vcodec: 'none', acodec: i ? 'mp4a.40.2' : 'opus', filesize: Math.round((128 - i * 60) * 1000 * 90 / 8),
      tbr: i ? 64 : 128, note: i ? 'low' : 'best audio',
    }));
  } else if (kind === 'audio') {
    rows.push({ id: '251', ext: 'webm', resolution: 'audio only', height: 0, vcodec: 'none', acodec: 'opus', filesize: Math.round(160 * 1000 * 210 / 8), tbr: 160, note: 'best' });
    rows.push({ id: '250', ext: 'webm', resolution: 'audio only', height: 0, vcodec: 'none', acodec: 'opus', filesize: Math.round(70 * 1000 * 210 / 8), tbr: 70, note: '' });
    rows.push({ id: '140', ext: 'm4a', resolution: 'audio only', height: 0, vcodec: 'none', acodec: 'mp4a.40.2', filesize: Math.round(128 * 1000 * 210 / 8), tbr: 128, note: 'mp3 target' });
  } else {
    ['original', 'large', 'medium', 'thumb'].forEach((tag, i) => rows.push({
      id: `img-${i}`, ext: i === 0 ? 'png' : 'jpg', resolution: `${[3840, 1920, 1024, 400][i]}px`,
      height: 0, vcodec: 'none', acodec: 'none', filesize: Math.round((6 - i) * (1.2 + rnd()) * 1024 * 1024), tbr: 0, note: tag,
    }));
  }
  return rows;
}

/**
 * Build the simulated metadata for a job.
 * Returns {title, site, kind, engine, sizeBytes, durationSec, formats, filename, uploader}
 */
export function describeUrl(url, qualityId = 'best') {
  const rnd = mulberry32(hashCode(url + '|' + qualityId));
  const site = matchSite(url);
  const engine = engineFor(url);
  const kind = kindFor(url, qualityId);
  const q = { best: 2160, '2160': 2160, '1440': 1440, '1080': 1080, '720': 720, '480': 480, audio: 0, image: 4096 }[qualityId] ?? 1080;

  let title;
  if (kind === 'video') title = VIDEO_TITLES[Math.floor(rnd() * VIDEO_TITLES.length)];
  else if (kind === 'audio') title = AUDIO_TITLES[Math.floor(rnd() * AUDIO_TITLES.length)];
  else if (kind === 'image') title = site ? `${site.name} — ${IMAGE_TITLES[Math.floor(rnd() * IMAGE_TITLES.length)]}` : IMAGE_TITLES[Math.floor(rnd() * IMAGE_TITLES.length)];
  else title = decodeURIComponent((url.split('/').pop() || 'file').split('?')[0]) || FILE_TITLES[Math.floor(rnd() * FILE_TITLES.length)];

  const durationSec = kind === 'video' ? Math.round(60 + rnd() * 1500) : kind === 'audio' ? Math.round(90 + rnd() * 400) : 0;

  let sizeBytes;
  if (kind === 'video') sizeBytes = Math.round((q * q) / 900 * durationSec * (0.7 + rnd() * 0.8) * 1024);
  else if (kind === 'audio') sizeBytes = Math.round(durationSec * (320 * 1000 / 8) * (0.9 + rnd() * 0.2));
  else if (kind === 'image') sizeBytes = Math.round((1 + rnd() * 9) * 1024 * 1024);
  else sizeBytes = Math.round((0.4 + rnd() * 90) * 1024 * 1024);

  const maxHeight = kind === 'image' ? 4096 : (q || 1080);
  const formats = engine === 'http' ? [] : fakeFormats(rnd, kind, maxHeight);

  return {
    title, site: site ? site.name : hostGuess(url), kind, engine,
    engineLabel: engine === 'http' ? 'HTTP' : engine === 'gallery' ? 'gallery-dl' : 'yt-dlp',
    sizeBytes: Math.max(sizeBytes, 48 * 1024), durationSec, formats,
    uploader: site ? site.name : 'web',
    uploaderId: `${Math.floor(rnd() * 900000 + 100000)}`,
    views: Math.floor(rnd() * 4_000_000),
    resolution: kind === 'video' ? `${Math.round(maxHeight * 16 / 9)}x${maxHeight}` : kind === 'image' ? `${maxHeight}px` : '',
  };
}

function hostGuess(url) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname; } catch { return 'direct'; }
}

/** Sample links shown in the empty state / dashboard quick-add. */
export const SAMPLES = [
  { label: 'YouTube 4K', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { label: 'TikTok', url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' },
  { label: 'Instagram Reels', url: 'https://www.instagram.com/reel/C8xample1/' },
  { label: 'X / Twitter', url: 'https://x.com/i/status/1800000000000000000' },
  { label: 'SoundCloud', url: 'https://soundcloud.com/forss/flickermood' },
  { label: 'Imgur gallery', url: 'https://imgur.com/gallery/xample99' },
  { label: 'GitHub release', url: 'https://github.com/devlopergit04/downloader-bot/archive/refs/heads/main.zip' },
  { label: 'فایل مستقیم', url: 'https://speed.hetzner.de/100MB.bin' },
];
