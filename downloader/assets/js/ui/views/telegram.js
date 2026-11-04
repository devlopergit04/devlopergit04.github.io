/* ui/views/telegram.js — bot status + a faithful simulator of the Telegram
   conversation (handlers/commands.py + handlers/messages.py). */

import { state, save, updateSettings } from '../../store.js';
import { detectUrl, engineLabel, kindFor } from '../../engine.js';
import { describeUrl } from '../../sites.js';
import { telegramBar } from '../../sim.js';
import { addText } from '../../jobs.js';
import { fmtBytes, digits, fmtClock } from '../../format.js';
import { t } from '../../i18n.js';
import { esc, icon, on } from '../dom.js';
import { toast } from '../overlays.js';
import { sharedClient } from '../../api.js';
import * as L from '../../logs.js';

let rootEl = null;
let sim = { active: false, cancelled: false };

/* exact strings from handlers/commands.py */
const HELP_TEXT = `🤖 ربات دانلود

ربات از هزاران سایت دنیا (ویدئو، صدا، تصویر و فایل) با کیفیت کامل دانلود می‌کند.

کاربرد:
• یک لینک بفرست — ربات نوع فایل را شناسایی می‌کند.
• کیفیت بهترین (best) همیشه انتخاب می‌شود.
• پیشرفت دانلود به صورت زنده نمایش می‌شود.
• تک‌تک لینک‌ها پشتیبانی می‌شوند.

مثال:
https://youtu.be/xxxx

دستورها:
/start — شروع
/help — کمک
/ping — تست ربات
/cancel — لغو دانلود فعلی`;

const COMMANDS = [
  { cmd: '/start', fa: 'شروع کار', reply: 'سلام 👋 ربات دانلودی آماده‌ست.\nفقط یک لینک بفرست تا برات دانلود کنه.' },
  { cmd: '/help', fa: 'نمایش دستورالعمل', reply: HELP_TEXT },
  { cmd: '/ping', fa: 'تست زنده‌بودن ربات', reply: '✅ ربات زنده‌ست و آماده.' },
  { cmd: '/cancel', fa: 'لغو دانلود فعلی', reply: '🚫 دانلود لغو شد.' },
];

export const telegramView = {
  id: 'telegram',
  title: () => t('view.telegram.title'),
  sub: () => t('view.telegram.sub'),

  render() {
    const s = state.settings;
    const tg = state.telegram;
    return `
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>${icon('i-shield')} <span data-i18n="tg.botStatus"></span></h3>
          <span class="spacer"></span>
          <span class="badge ${s.telegramBotToken ? 'ok' : 'warn'}" id="botState">${s.telegramBotToken ? esc(t('tg.pong')) : 'no token'}</span>
        </div>
        <div class="card-pad stack" style="gap:12px">
          <div class="field">
            <label for="tgToken">TELEGRAM_BOT_TOKEN <span class="req">*</span></label>
            <div class="input-group">
              <input class="input mono" id="tgToken" type="password" value="${esc(s.telegramBotToken || '')}" placeholder="123456789:AAAA…" autocomplete="off">
              <button class="btn ghost" id="tgTokenShow" title="show">${icon('i-search')}</button>
            </div>
            <span class="hint" data-i18n="tg.tokenHint"></span>
          </div>

          <div class="field">
            <label for="tgAllowed">ALLOWED_USER_ID</label>
            <input class="input mono" id="tgAllowed" value="${esc(s.allowedUserId || '')}" placeholder="${esc(t('ui.empty'))}" autocomplete="off">
            <span class="hint" data-i18n="tg.allowedHint"></span>
          </div>

          <div class="field">
            <label for="tgUpload">MAX_UPLOAD_MB — <b id="tgUploadVal">${digits(s.maxUploadMb)}</b></label>
            <input class="input" id="tgUpload" type="range" min="0" max="2000" step="10" value="${Number(s.maxUploadMb) || 0}">
            <span class="hint">${esc(s.maxUploadMb > 0 ? `${s.maxUploadMb} MB → force_document` : '0 = unlimited')}</span>
          </div>

          <div class="row">
            <button class="btn primary" id="tgPing">${icon('i-bolt')} <span data-i18n="tg.ping"></span></button>
            <span class="grow"></span>
            <span class="muted" id="tgPingOut" style="font-size:11.5px">${tg.pingMs ? `last: ${digits(tg.pingMs)} ms` : ''}</span>
          </div>

          <dl class="kv">
            <dt>${esc(t('tg.webhook'))}</dt><dd><span class="mono">${esc(s.mode === 'live' ? (s.apiUrl || '—') : 'long polling (bot.py)')}</span></dd>
            <dt>${esc(t('tg.users'))}</dt><dd>${esc(s.allowedUserId ? `1 (${s.allowedUserId})` : 'public')}</dd>
            <dt>LOG_LEVEL</dt><dd class="mono">${esc(s.logLevel)}</dd>
            <dt>DOWNLOAD_DIR</dt><dd class="mono">${esc(s.downloadDir)}</dd>
          </dl>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon('i-send')} <span data-i18n="tg.chat"></span></h3>
          <span class="spacer"></span>
          <label class="switch" title="user id mismatch → ⛔"><input type="checkbox" id="tgAsOther" ${tg.asOtherUser ? 'checked' : ''}><span class="track"></span><span class="mono" style="font-size:11px">user_id ≠ allowed</span></label>
          <button class="btn sm ghost" id="tgClear">${icon('i-trash')}</button>
        </div>
        <div class="chat" id="tgChat"></div>
        <div class="card-foot">
          <input class="input mono grow" id="tgInput" placeholder="https://youtu.be/…  |  /start  /help  /ping  /cancel" autocomplete="off">
          <button class="btn primary" id="tgSend">${icon('i-send')} <span data-i18n="tg.send"></span></button>
        </div>
        <div class="card-foot" style="border-top:0;padding-top:0">
          <label class="switch"><input type="checkbox" id="tgAlsoQueue" checked><span class="track"></span><span style="font-size:12px">همزمان به صف پنل اضافه شود</span></label>
          <span class="grow"></span>
          <span class="muted" style="font-size:11px" data-i18n="tg.chatHint"></span>
        </div>
      </section>
    </div>

    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>${icon('i-terminal')} <span data-i18n="tg.commands"></span></h3></div>
        <div class="table-wrap cmd-tbl"><table class="tbl"><thead><tr><th>command</th><th>توضیح</th><th>پاسخ ربات</th></tr></thead><tbody>
          ${COMMANDS.map((c) => `<tr>
            <td><code>${esc(c.cmd)}</code> <button class="btn sm ghost" data-cmd="${esc(c.cmd)}">${esc(t('tg.send'))}</button></td>
            <td>${esc(c.fa)}</td>
            <td class="muted" style="font-size:11.5px;max-width:280px">${esc(c.reply.split('\n')[0])}${c.reply.includes('\n') ? ' …' : ''}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon('i-box')} handlers/messages.py</h3></div>
        <div class="card-pad">
<pre class="code"><span class="c"># مسیر یک پیام تا فایل ارسالی</span>
text → engine.detect_url(text)
     → <span class="k">if not url</span>: ignore
     → reply_text(<span class="s">"⬇️ در حال دانلود:\\n{url}\\n\\nدر حال آماده‌سازی…"</span>)
     → engine.download(url, progress)   <span class="c"># yt-dlp | gallery-dl | http</span>
     → msg.edit_text(<span class="s">f"⬇️ {_bar(pct)} {pct}%"</span>)   <span class="c"># هر ۰٫۲۵ ثانیه</span>
     → send_video / send_audio / send_photo / send_document
       caption = <span class="s">"✅ دانلود کامل\\nنوع: …\\nموتور: …\\nحجم: …"</span>
     → msg.delete()</pre>
          <div class="row" style="margin-top:10px">
            <span class="badge">${icon('i-clock')} throttle 0.25s</span>
            <span class="badge">${icon('i-shield')} allowed_user_id</span>
            <span class="badge warn">${icon('i-alert')} force_document &gt; MAX_UPLOAD_MB</span>
          </div>
        </div>
      </section>
    </div>`;
  },

  mount(root) {
    rootEl = root;
    const chat = root.querySelector('#tgChat');

    if (!state.telegram.messages.length) {
      push('in', 'سلام 👋 ربات دانلودی آماده‌ست.\nفقط یک لینک بفرست تا برات دانلود کنه.', { silent: true });
    }
    paintChat();

    root.querySelector('#tgToken').addEventListener('change', (e) => {
      updateSettings({ telegramBotToken: e.target.value.trim() });
      root.querySelector('#botState').textContent = e.target.value.trim() ? t('tg.pong') : 'no token';
      L.info('telegram', 'TELEGRAM_BOT_TOKEN updated in the panel');
      toast('ok', t('set.saved'), 'TELEGRAM_BOT_TOKEN');
    });
    root.querySelector('#tgTokenShow').addEventListener('click', () => {
      const el = root.querySelector('#tgToken');
      el.type = el.type === 'password' ? 'text' : 'password';
    });
    root.querySelector('#tgAllowed').addEventListener('change', (e) => updateSettings({ allowedUserId: e.target.value.trim() }));
    root.querySelector('#tgUpload').addEventListener('input', (e) => {
      updateSettings({ maxUploadMb: Number(e.target.value) });
      root.querySelector('#tgUploadVal').textContent = digits(e.target.value);
    });
    root.querySelector('#tgAsOther').addEventListener('change', (e) => { state.telegram.asOtherUser = e.target.checked; save(); });
    root.querySelector('#tgClear').addEventListener('click', () => { state.telegram.messages = []; save(); paintChat(); });

    const send = () => {
      const input = root.querySelector('#tgInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      handleUserMessage(text, root.querySelector('#tgAlsoQueue')?.checked ?? true);
    };
    root.querySelector('#tgSend').addEventListener('click', send);
    root.querySelector('#tgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    root.querySelector('#tgPing').addEventListener('click', async () => {
      const out = root.querySelector('#tgPingOut');
      out.innerHTML = `<span class="spin"></span>`;
      const t0 = performance.now();
      if (state.settings.mode === 'live') {
        try {
          const r = await sharedClient.telegramPing();
          const ms = Math.round(performance.now() - t0);
          state.telegram.lastPing = Date.now(); state.telegram.pingMs = ms; save();
          out.textContent = `${r?.ok ? '✅' : '❌'} ${ms} ms · ${r?.bot || 'api'}`;
          L.success('telegram', `ping ok in ${ms}ms`);
        } catch (err) {
          out.textContent = `❌ ${err.message}`;
          L.error('telegram', `ping failed: ${err.message}`);
        }
      } else {
        await new Promise((r) => setTimeout(r, 380 + Math.random() * 320));
        const ms = Math.round(performance.now() - t0);
        state.telegram.lastPing = Date.now(); state.telegram.pingMs = ms; save();
        out.textContent = `✅ ${digits(ms)} ms · simulated getMe()`;
        push('in', '✅ ربات زنده‌ست و آماده.');
        L.info('telegram', `simulated /ping in ${ms}ms`);
      }
    });

    on(root, '[data-cmd]', 'click', (_e, el) => {
      root.querySelector('#tgInput').value = el.dataset.cmd;
      handleUserMessage(el.dataset.cmd, false);
    });

    void chat;
  },

  tick() {},
  unmount() { rootEl = null; sim = { active: false, cancelled: true }; },
};

/* ═══════════════ chat engine ═══════════════ */

function push(dir, text, opts = {}) {
  const msg = { id: `m${Date.now()}${Math.random().toString(36).slice(2, 5)}`, dir, text, ts: Date.now(), kind: opts.kind || 'text', meta: opts.meta || null };
  state.telegram.messages.push(msg);
  if (state.telegram.messages.length > 60) state.telegram.messages.shift();
  if (!opts.silent) save();
  return msg;
}

function paintChat() {
  const chat = rootEl?.querySelector('#tgChat');
  if (!chat) return;
  chat.innerHTML = state.telegram.messages.map((m) => `
    <div class="msg ${m.dir}">
      <span class="av">${icon(m.dir === 'out' ? 'i-send' : 'i-gauge')}</span>
      <span class="bubble">${m.kind === 'file' ? `${icon('i-file')} ` : ''}${esc(m.text)}<time>${esc(fmtClock(m.ts))}</time></span>
    </div>`).join('');
  chat.scrollTop = chat.scrollHeight;
}

async function handleUserMessage(text, alsoQueue) {
  const s = state.settings;
  push('out', text);
  paintChat();
  await sleep(220 + Math.random() * 260);

  /* access control (handlers/messages.py) */
  if (s.allowedUserId && state.telegram.asOtherUser) {
    push('in', '⛔ این ربات مخصوص کاربر مجاز است.');
    paintChat();
    L.warn('telegram', 'rejected: user id is not in ALLOWED_USER_ID');
    return;
  }

  /* commands (handlers/commands.py) */
  const cmd = text.trim().toLowerCase().split('@')[0];
  if (cmd === '/start' || cmd === '/help' || cmd === '/ping') {
    const c = COMMANDS.find((x) => x.cmd === cmd);
    push('in', c.reply);
    paintChat();
    return;
  }
  if (cmd === '/cancel') {
    if (sim.active) { sim.cancelled = true; push('in', '🚫 دانلود لغو شد.'); }
    else push('in', '⚠️ هیچ دانلودی در جریان نیست.');
    paintChat();
    return;
  }

  const url = detectUrl(text);
  if (!url) return;                       // the bot ignores non-URL text

  const meta = describeUrl(url, s.quality);
  const engine = engineLabel(url).label;
  const kind = kindFor(url, s.quality);
  const kindLabel = { video: 'ویدیو', audio: 'صوت', image: 'تصویر', file: 'فایل' }[kind] || 'فایل';

  if (alsoQueue) addText(url, { quality: s.quality });

  const progressMsg = push('in', `⬇️ در حال دانلود:\n${url}\n\nدر حال آماده‌سازی…`);
  paintChat();
  L.info('telegram', `message → ${url} (engine ${engine})`);

  sim = { active: true, cancelled: false };
  const total = meta.sizeBytes;
  const limitBytes = s.maxUploadMb > 0 ? s.maxUploadMb * 1024 * 1024 : 0;
  let pct = 0;
  const started = Date.now();
  const duration = 2600 + Math.min(6000, total / (45 * 1e6 / 8) * 1000);

  while (pct < 100) {
    await sleep(Math.max(120, duration / 42));
    if (sim.cancelled) {
      progressMsg.text = '🚫 دانلود لغو شد.';
      progressMsg.ts = Date.now();
      paintChat(); save();
      sim.active = false;
      L.warn('telegram', 'download cancelled by /cancel');
      return;
    }
    const elapsed = Date.now() - started;
    pct = Math.min(100, Math.round((elapsed / duration) * 100 * (0.85 + Math.random() * 0.3)));
    progressMsg.text = `⬇️ ${telegramBar(pct)} ${pct}%`;
    progressMsg.ts = Date.now();
    paintChat();
  }

  /* final caption + the "sent file" bubble (messages.py::_send_file) */
  state.telegram.messages = state.telegram.messages.filter((m) => m.id !== progressMsg.id);
  const caption = `✅ دانلود کامل\nنوع: ${kindLabel}\nموتور: ${engine}\nحجم: ${fmtBytes(total)}`;
  if (limitBytes && total > limitBytes) {
    push('in', `${caption}\n\n⚠️ بزرگ‌تر از MAX_UPLOAD_MB (${s.maxUploadMb}) → ارسال به‌صورت document`);
  } else {
    push('in', caption, { kind: 'file', meta: { name: meta.title, size: total } });
  }
  paintChat();
  save();
  sim.active = false;
  L.success('telegram', `sent ${kindLabel} ${fmtBytes(total)} to chat`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
