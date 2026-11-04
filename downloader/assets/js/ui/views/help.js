/* ui/views/help.js — architecture, install, API reference, shortcuts, about. */

import { state } from '../../store.js';
import { t } from '../../i18n.js';
import { esc, icon, on } from '../dom.js';
import { copyText } from '../../exporters.js';
import { toast } from '../overlays.js';

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'focus link input', 'تمرکز روی ورودی لینک'],
  ['Ctrl / ⌘ + Enter', 'add & download', 'افزودن و شروع دانلود'],
  ['G then D / Q / L / S', 'go to dashboard / queue / logs / settings', 'پرش به داشبورد / صف / لاگ / تنظیمات'],
  ['Esc', 'close drawer or modal', 'بستن کشو یا پنجره'],
  ['/', 'focus search (sites view)', 'تمرکز روی جست‌وجو'],
  ['P', 'pause / resume selected job', 'توقف یا ادامه‌ی دانلود انتخابی'],
  ['R', 'retry selected job', 'تلاش مجدد'],
];

const API_ENDPOINTS = [
  ['GET', '/api/health', 'سلامت بک‌اند، نسخه‌ی موتورها و وضعیت ffmpeg'],
  ['GET', '/api/jobs', 'لیست همه‌ی کارها (queue snapshot)'],
  ['POST', '/api/jobs', 'افزودن دانلود جدید `{url, quality}`'],
  ['GET', '/api/jobs/{id}', 'جزئیات یک کار'],
  ['POST', '/api/jobs/{id}/pause|resume|cancel|retry', 'کنترل چرخه‌ی حیات'],
  ['DELETE', '/api/jobs/{id}', 'حذف کار از صف'],
  ['GET', '/api/events', 'جریان زنده‌ی رویدادها (Server-Sent Events)'],
  ['GET', '/api/logs?limit=300', 'لاگ‌های سمت سرور'],
  ['GET', '/api/stats', 'آمار تجمیعی (بایت‌ها، تعداد، سرعت)'],
  ['GET', '/api/config', 'تنظیمات فعلی (.env)'],
  ['POST', '/api/config', 'به‌روزرسانی تنظیمات'],
  ['POST', '/api/telegram/ping', 'تست زنده‌بودن ربات (getMe)'],
  ['GET', '/api/files/{id}', 'دریافت فایل دانلودشده'],
];

export const helpView = {
  id: 'help',
  title: () => t('view.help.title'),
  sub: () => t('view.help.sub'),

  render() {
    return `
    <div class="stack">
      <section class="card">
        <div class="card-head"><h3>${icon('i-box')} <span data-i18n="help.arch"></span></h3>
          <span class="spacer"></span>
          <a class="btn sm ghost" href="https://github.com/devlopergit04/downloader-bot" target="_blank" rel="noopener">${icon('i-github')} downloader-bot</a>
        </div>
        <div class="arch"><img src="assets/img/architecture.svg" alt="معماری ربات و پنل" loading="lazy"></div>
        <div class="card-pad">
          <div class="table-wrap"><table class="tbl"><thead><tr><th>لایه</th><th>مسئولیت</th><th>در این پنل</th></tr></thead><tbody>
            <tr><td><b>Downloader Engine</b></td><td>شناسایی URL، تشخیص نوع رسانه و مسیریابی</td><td class="muted">engine.js — کپی دقیق قوانین پایتون</td></tr>
            <tr><td><b>yt-dlp</b></td><td>ویدئو و صدا از YouTube، TikTok، Instagram، Twitch، Vimeo…</td><td class="muted">جدول فرمت‌ها + انتخاب کیفیت</td></tr>
            <tr><td><b>gallery-dl</b></td><td>تصویر و گالری از Instagram، X، Reddit، Behance…</td><td class="muted">شبیه‌سازی شمار فایل‌ها</td></tr>
            <tr><td><b>HTTP</b></td><td>فایل‌های مستقیم و GitHub</td><td class="muted">دانلود واقعی در مرورگر (در صورت اجازه‌ی CORS)</td></tr>
            <tr><td><b>Telegram handlers</b></td><td>/start /help /ping /cancel + ارسال فایل</td><td class="muted">شبیه‌ساز گفت‌وگو در «پل تلگرام»</td></tr>
          </tbody></table></div>
        </div>
      </section>

      <div class="grid cols-3">
        <section class="card">
          <div class="card-head"><h3>${icon('i-cpu')} <span data-i18n="help.modes"></span></h3></div>
          <div class="card-pad stack" style="gap:10px;font-size:12.5px">
            <div><span class="badge info">demo</span> <b>شبیه‌سازی</b><p class="muted" style="font-size:11.5px">موتورها در مرورگر مدل‌سازی می‌شوند: شناسایی لینک واقعی است، بایت‌ها شبیه‌سازی‌شده. مناسب دمو و توسعه‌ی رابط.</p></div>
            <div><span class="badge violet">browser</span> <b>دانلود واقعی</b><p class="muted" style="font-size:11.5px">برای لینک‌های مستقیمِ سازگار با CORS، فایل واقعاً در مرورگر شما دانلود و ذخیره می‌شود.</p></div>
            <div><span class="badge ok">live</span> <b>اتصال زنده</b><p class="muted" style="font-size:11.5px">پنل به api/server.py وصل می‌شود و همان موتورهای پایتون روی سرور/سیستم شما کار می‌کنند.</p></div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-play')} <span data-i18n="help.install"></span></h3></div>
          <div class="card-pad">
            <div class="steps">
              <div class="step"><div><b>کلون و محیط مجازی</b><p class="mono" style="font-size:11px">git clone https://github.com/devlopergit04/downloader-bot && cd downloader-bot</p></div></div>
              <div class="step"><div><b>نصب وابستگی‌ها</b><p class="mono" style="font-size:11px">pip install -r requirements.txt</p></div></div>
              <div class="step"><div><b>ساخت .env از همین پنل</b><p style="font-size:11.5px" class="muted">تنظیمات → خروجی گرفتن → دانلود .env</p></div></div>
              <div class="step"><div><b>اجرا</b><p class="mono" style="font-size:11px">python bot.py &nbsp;|&nbsp; docker compose up -d --build</p></div></div>
              <div class="step"><div><b>پل وب (اختیاری)</b><p class="mono" style="font-size:11px">python api/server.py</p></div></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-cloud')} <span data-i18n="help.deploy"></span></h3></div>
          <div class="card-pad stack" style="gap:9px;font-size:12.5px">
            <p class="muted">این پنل یک سایت استاتیک است و روی <b>GitHub Pages</b> منتشر می‌شود:</p>
            <div class="mono" style="font-size:11px">https://devlopergit04.github.io/downloader/</div>
            <div class="row" style="gap:6px">
              <span class="badge">بدون build</span><span class="badge">بدون وابستگی خارجی</span><span class="badge">PWA / آفلاین</span>
            </div>
            <p class="muted" style="font-size:11.5px">برای بک‌اند واقعی: Railway، Fly.io، VPS با systemd یا Docker Compose (خروجی‌های آماده در تب «خروجی گرفتن»).</p>
            <a class="btn sm ghost" href="docs/DEPLOY.md" target="_blank" rel="noopener">${icon('i-external')} docs/DEPLOY.md</a>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h3>${icon('i-terminal')} <span data-i18n="help.api"></span></h3>
          <span class="spacer"></span>
          <span class="badge">api/server.py</span>
          <a class="btn sm ghost" href="docs/API.md" target="_blank" rel="noopener">${icon('i-external')} مستندات کامل</a>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>method</th><th>endpoint</th><th>توضیح</th></tr></thead><tbody>
          ${API_ENDPOINTS.map(([m, p, d]) => `<tr>
            <td><span class="badge ${m === 'GET' ? 'info' : m === 'POST' ? 'ok' : 'err'}">${m}</span></td>
            <td class="mono">${esc(p)}</td><td class="muted" style="font-size:12px">${esc(d)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>

      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h3>${icon('i-bolt')} <span data-i18n="help.shortcuts"></span></h3></div>
          <div class="table-wrap"><table class="tbl"><tbody>
            ${SHORTCUTS.map(([k, en, fa]) => `<tr><td style="width:190px"><span class="kbd">${esc(k)}</span></td><td class="muted" style="font-size:12px">${esc(fa)} <span class="dim">· ${esc(en)}</span></td></tr>`).join('')}
          </tbody></table></div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('i-help')} <span data-i18n="help.about"></span></h3></div>
          <div class="card-pad stack" style="gap:10px;font-size:12.5px">
            <p><b>Downloader Bot — پنل گرافیکی آنلاین</b></p>
            <p class="muted">رابط وبِ پروژه‌ی <span class="mono">devlopergit04/downloader-bot</span>: همان موتورهای دانلود، همان تم سبز تیره‌ی پنل PyQt6، بدون نصب و در مرورگر.</p>
            <dl class="kv">
              <dt>نسخه پنل</dt><dd class="mono">1.0.0</dd>
              <dt>موتورها</dt><dd class="mono">yt-dlp · gallery-dl · HTTP</dd>
              <dt>لایسنس</dt><dd>MIT</dd>
              <dt>حالت فعلی</dt><dd><span class="badge ${state.settings.mode === 'live' ? 'ok' : 'info'}">${esc(state.settings.mode)}</span></dd>
              <dt>ذخیره‌سازی</dt><dd class="muted" style="font-size:11.5px">localStorage مرورگر شما — هیچ داده‌ای به سرور دیگری ارسال نمی‌شود.</dd>
            </dl>
            <div class="row">
              <a class="btn sm ghost" href="https://github.com/devlopergit04/downloader-bot" target="_blank" rel="noopener">${icon('i-github')} منبع ربات</a>
              <a class="btn sm ghost" href="https://github.com/devlopergit04/devlopergit04.github.io" target="_blank" rel="noopener">${icon('i-external')} منبع پنل</a>
              <button class="btn sm ghost" id="copyLink">${icon('i-copy')} کپی لینک پنل</button>
            </div>
            <p class="muted" style="font-size:11px">yt-dlp · gallery-dl · python-telegram-bot · FastAPI</p>
          </div>
        </section>
      </div>
    </div>`;
  },

  mount(root) {
    on(root, '#copyLink', 'click', async () => {
      const url = 'https://devlopergit04.github.io/downloader/';
      toast(await copyText(url) ? 'ok' : 'err', t('ui.copied'), url);
    });
    /* copyable code lines */
    on(root, '.mono', 'click', async (_e, el) => {
      const text = el.textContent.trim();
      if (text.length > 4 && text.length < 200 && !text.includes(' ')) {
        if (await copyText(text)) toast('ok', t('ui.copied'), text);
      }
    });
  },

  tick() {},
  unmount() {},
};
