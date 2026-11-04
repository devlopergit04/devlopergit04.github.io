# پنل گرافیکی آنلاین — Downloader Bot

🌐 **https://devlopergit04.github.io/downloader/**

رابط وبِ پروژه‌ی [`devlopergit04/downloader-bot`](https://github.com/devlopergit04/downloader-bot):
همان سه موتور دانلود (`yt-dlp` · `gallery-dl` · `HTTP`)، همان تم سبز تیره‌ی پنل PyQt6،
بدون نصب، بدون build و بدون هیچ وابستگی خارجی — فقط HTML + CSS + ES Modules.

---

## ✨ چه چیزی در این پنل هست

| بخش | توضیح |
|---|---|
| **داشبورد** | آمار زنده، نمودار سرعت ۶۰ ثانیه‌ای، سهم موتورها (donut)، سلامت سامانه، رویدادهای اخیر |
| **صف دانلود** | چند لینک با هم (هر خط یک لینک)، پیش‌نمایش زنده‌ی **مسیریابی موتور**، انتخاب کیفیت، جدول پیشرفت، pause / resume / cancel / retry / remove، نوار پیشرفت کلی |
| **کشوی جزئیات** | متادیتا، جدول فرمت‌ها مثل `yt-dlp -F`، دیکشنری گزینه‌های موتور، لاگ اختصاصی همان دانلود |
| **کنسول لاگ** | سطح‌ها (DEBUG→ERROR)، فیلتر منبع و کار، پیمایش خودکار، کپی و خروجی `.log` — سطح نمایش دقیقاً از `LOG_LEVEL` پیروی می‌کند |
| **پل تلگرام** | وضعیت ربات، `/ping`، سقف `MAX_UPLOAD_MB` و **شبیه‌ساز گفت‌وگو** با پاسخ‌های واقعیِ `handlers/` |
| **سایت‌های پشتیبانی** | ۲۱ سرویس شناسایی‌شده + جست‌وجو + «مسیریاب» که هر URL را به موتور درست نگاشت می‌کند |
| **تنظیمات** | همه‌ی متغیرهای `.env` ربات + ترجیحات پنل + اتصال بک‌اند + **خروجی گرفتن** از `.env` / `docker-compose.yml` / `run.sh` / واحد systemd |
| **راهنما** | معماری، نصب، جدول API، میان‌برهای صفحه‌کلید |

**امکانات پایه‌ای:** فارسی/انگلیسی با تغییر آنی `dir` (RTL/LTR) · تم تیره و روشن ·
PWA آفلاین (service worker) · ماندگاری وضعیت در `localStorage` · طراحی واکنش‌گرا تا موبایل ·
میان‌برهای صفحه‌کلید · کشیدن‌ورها کردن فایل `.txt` لینک‌ها روی فرم.

## 🧠 سه حالت اجرا

| حالت | چه اتفاقی می‌افتد |
|---|---|
| **`demo` — شبیه‌سازی** | قواعد‌ی شناسایی و مسیریابی **واقعی** هستند (کپی دقیق `engine.py`)، اما بایت‌ها مدل‌سازی می‌شوند: فازهای extract → download → merge، سرعت با jitter، retry، لاگ‌های واقعی‌نما. |
| **`browser` — دانلود واقعی** | برای لینک‌های مستقیمی که سرورشان CORS می‌دهد (مثل `raw.githubusercontent.com`)، پنل **واقعاً** با `fetch` استریم می‌گیرد، پیشرفت واقعی نشان می‌دهد و فایل را در مرورگر ذخیره می‌کند. اگر مرورگر بلاک کند، با یک `WARNING` به شبیه‌ساز برمی‌گردد. |
| **`live` — بک‌اند واقعی** | پنل به [`api/server.py`](api/server.py) وصل می‌شود (REST + SSE) و همان موتورهای پایتون روی ماشین/سرور شما کار می‌کنند. |

## 📁 ساختار

```
downloader/
├── index.html                  پوسته‌ی SPA (sprite آیکون‌ها، topbar، sidebar، statusbar، drawer، modal)
├── manifest.webmanifest        PWA (RTL، فارسی، shortcutها)
├── sw.js                       کش آفلاین: navigation → network-first، دارایی‌ها → SWR
├── favicon.svg
├── assets/
│   ├── css/app.css             توکن‌های طراحی، کاملاً برگرفته از gui/styles.py (QSS)
│   ├── img/                    logo.svg · hero.svg · architecture.svg (SVG متحرک)
│   └── js/
│       ├── app.js              bootstrap + حلقه‌های tick + ثبت service worker
│       ├── i18n.js             واژه‌نامه‌ی fa/en (~۲۰۰ کلید) + اعمال dir
│       ├── store.js            state observable + ماندگاری localStorage
│       ├── engine.js           ← پورت `downloader/engine.py` و `gui/workers.py::_engine_for`
│       ├── sites.js            کاتالوگ سایت‌ها + تولید متادیتای شبیه‌سازی
│       ├── sim.js              مدل سه موتور (فازها، سرعت، retry، خطا)
│       ├── net.js              موتور HTTP واقعی مرورگر (fetch stream + ذخیره‌ی Blob)
│       ├── api.js              کلاینت REST/SSE برای بک‌اند
│       ├── jobs.js             مدیر صف: افزودن/توقف/ادامه/لغو/همگام‌سازی live
│       ├── logs.js             بافر حلقوی لاگ + فیلتر سطح (مثل logging پایتون)
│       ├── format.js           بایت/سرعت/زمان + ارقام فارسی
│       ├── charts.js           sparkline · donut · bars روی canvas (بدون کتابخانه)
│       ├── exporters.js        سازنده‌ی `.env` / compose / run.sh / systemd / snapshot
│       └── ui/
│           ├── shell.js        روتر hash، topbar، وضعیت اتصال، میان‌برها
│           ├── dom.js          هلپرهای DOM + badgeها
│           ├── overlays.js     toast · drawer · modal · confirm
│           └── views/          dashboard · queue · logs · telegram · sites · settings · help
├── api/                        بک‌اند اختیاری (FastAPI) — همین‌جا مستند شده
│   ├── server.py               پل REST/SSE روی DownloaderEngine ربات
│   ├── requirements.txt        fastapi + uvicorn
│   ├── Dockerfile              image مستقل با ffmpeg و healthcheck
│   └── README.md
└── docs/
    ├── API.md                  قرارداد کامل endpointها و مدل Job
    └── DEPLOY.md               GitHub Pages · Docker · systemd+nginx · Railway
```

## 🔁 وفاداری به پروژه‌ی اصلی

این پنل «یک UI الهام‌گرفته» نیست؛ قواعد هسته‌ی ربات عیناً پورت شده‌اند:

| در ربات | در پنل |
|---|---|
| `engine.py::URL_RE` | `engine.js::URL_RE` (همان regex با فلگ `gi`) |
| `GALLERY_DOMAINS` / `DIRECT_DOMAINS` | همان آرایه‌ها، همان ترتیب |
| `workers.py::_engine_for` + `FILE_EXT` | `engine.js::engineFor` (همان اولویت‌بندی) |
| `config.py::Settings` و `.env.example` | فرم تب «متغیرهای .env» + سازنده‌ی فایل `.env` |
| `gui/styles.py` (QSS سبز تیره) | متغیرهای CSS: `#021a15 / #022c22 / #064e3b / #10b981 / #34d399 / #6ee7b7 / #a7f3d0` |
| `gui/main_window.py` (جدول، وضعیت‌ها، سقف همزمانی ۳) | `views/queue.js` + `jobs.js` |
| `workers.py::_fmt` / `_speed_from` | `format.js::fmtBytes` / `fmtSpeed` (KiB/s) |
| `handlers/commands.py` و `messages.py::_bar` | شبیه‌ساز گفت‌وگو در `views/telegram.js` |

## 🚀 اجرای محلی

```bash
cd devlopergit04.github.io
python3 -m http.server 8080
# → http://localhost:8080/downloader/
```

هیچ `npm install` لازم نیست. برای اتصال به موتورهای واقعی:

```bash
cd ../downloader-bot && pip install -r requirements.txt -r api/requirements.txt
python api/server.py      # → :8787
```

سپس در پنل: **اتصال زنده** + `http://127.0.0.1:8787`.

## 🧪 تست

دو لایه تست بدون مرورگر (Node) نوشته شده است:

1. **unit** — پورتِ موتور، کاتالوگ سایت‌ها، قالب‌بندی و خروجی‌گیرنده‌ها
   (`engine.js` در برابر نمونه‌های واقعی `engine.py`).
2. **integration** — بالاآوردن کل پنل داخل `jsdom` و راندنِ آن:
   مسیریابی بین ۷ نما، افزودن ۴ لینک، اجرای شبیه‌سازی، pause/resume/cancel،
   کشوی جزئیات، فیلتر لاگ، خروجی‌ها، جست‌وجوی سایت‌ها، شبیه‌ساز تلگرام،
   تغییر زبان/تم، ماندگاری و سوییچ حالت.

## ⌨️ میان‌برها

`Ctrl/⌘+K` ورودی لینک · `Ctrl/⌘+Enter` افزودن و دانلود · `G` سپس `D/Q/L/S/T/W/H` پرش به نماها ·
`/` جست‌وجوی سایت‌ها · `P` توقف/ادامه · `R` تلاش مجدد · `Esc` بستن کشو/پنجره

## 🔒 حریم خصوصی

هیچ داده‌ای به هیچ سرور شخص ثالثی ارسال نمی‌شود. توکن ربات و همه‌ی تنظیمات فقط در
`localStorage` همان مرورگر می‌مانند و در خروجی `panel-snapshot.json` نیز redacted می‌شوند.

## 📄 لایسنس

MIT — مانند خودِ `downloader-bot`.
