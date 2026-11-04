/* tests/unit.mjs — pure-logic checks: the engine port, the site catalogue,
   formatting and the config exporters.  Run:  node tests/unit.mjs        */
import assert from 'node:assert/strict';
import * as E from '../downloader/assets/js/engine.js';
import * as S from '../downloader/assets/js/sites.js';
import * as F from '../downloader/assets/js/format.js';
import { buildEnv, buildCompose, buildRunScript, buildSystemdUnit, buildPanelSnapshot } from '../downloader/assets/js/exporters.js';
import { DEFAULT_SETTINGS } from '../downloader/assets/js/store.js';

// engine.py parity
assert.equal(E.detectUrl('سلام این رو بگیر https://youtu.be/abc123 ممنون'), 'https://youtu.be/abc123');
assert.deepEqual(E.detectUrls('https://a.com/x\nwww.b.com/y.zip\nno link here'), ['https://a.com/x', 'https://www.b.com/y.zip']);
assert.equal(E.classify('https://github.com/u/r/releases/download/x.zip'), 'direct');
assert.equal(E.classify('https://www.instagram.com/p/AAA/'), 'gallery');
assert.equal(E.classify('https://www.tiktok.com/@a/video/1'), 'video');
assert.equal(E.engineFor('https://x.com/i/status/1'), 'gallery');
assert.equal(E.engineFor('https://cdn.example.com/pkg.exe'), 'http');
assert.equal(E.engineFor('https://raw.githubusercontent.com/u/r/main/README.md'), 'http');
assert.equal(E.kindFor('https://soundcloud.com/a/b', 'audio'), 'audio');
assert.equal(E.kindFor('https://imgur.com/gallery/x'), 'image');
assert.equal(E.friendlyName('https://example.com/files/my%20doc.pdf'), 'my doc.pdf');
assert.equal(E.normalizeUrl('www.foo.bar/x'), 'https://www.foo.bar/x');
assert.equal(E.qualityById('720').fmt, 'bestvideo[height<=?720]+bestaudio/best[height<=?720]');
assert.equal(E.suggestedFilename('https://youtu.be/x', 'My: Video/Title', 'best'), 'My_ Video_Title.mp4');
assert.deepEqual(Object.keys(E.ytdlpOptions({...DEFAULT_SETTINGS}, 'best')).sort(),
  ['concurrent_fragment_downloads','extractor_args','format','geo_bypass','merge_output_format','noplaylist','noprogress','no_warnings','outtmpl','quiet','retries'].sort());

// sites + simulator metadata
assert.ok(S.SITES.length >= 18);
assert.equal(S.matchSite('https://www.tiktok.com/@a/video/1').id, 'tiktok');
const m1 = S.describeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '1080');
assert.equal(m1.kind, 'video'); assert.equal(m1.engineLabel, 'yt-dlp');
assert.ok(m1.formats.length > 3 && m1.sizeBytes > 1024);
assert.equal(S.describeUrl('https://github.com/a/b/archive/refs/heads/main.zip').engineLabel, 'HTTP');
assert.equal(S.describeUrl('https://imgur.com/gallery/xyz').kind, 'image');
assert.deepEqual(S.describeUrl('https://youtu.be/abc'), S.describeUrl('https://youtu.be/abc'));

// formatting
assert.equal(F.fmtBytes(1536), '1.5 KB');
assert.equal(F.fmtSpeed(2 * 1024 * 1024), '2.00 MiB/s');
assert.equal(F.fmtDuration(3725), '1:02:05');
assert.equal(F.fmtEta(90), '۲m'); // Persian digits in fa
assert.equal(F.digits('12.5'), '۱۲.۵');
assert.equal(F.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');

// exporters
const env = buildEnv({ ...DEFAULT_SETTINGS, telegramBotToken: '123:ABC', maxUploadMb: 75, downloadDir: '/data/dl', logLevel: 'debug' });
for (const re of [/TELEGRAM_BOT_TOKEN=123:ABC/, /MAX_UPLOAD_MB=75/, /DOWNLOAD_DIR=\/data\/dl/, /LOG_LEVEL=DEBUG/, /YTDLP_RETRIES=10/, /YTDLP_CONCURRENT=4/, /WEBPANEL_PORT=8787/]) assert.match(env, re);
assert.match(buildCompose(DEFAULT_SETTINGS), /webpanel:/);
assert.match(buildRunScript(DEFAULT_SETTINGS), /python3 api\/server\.py/);
assert.match(buildSystemdUnit(DEFAULT_SETTINGS), /\[Service\]/);
assert.equal(JSON.parse(buildPanelSnapshot()).panel, 'downloader-bot-web-panel/1.0.0');

console.log('✔ unit smoke tests passed');
