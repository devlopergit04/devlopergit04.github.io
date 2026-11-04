# تست‌ها

سه لایه تست که **بدون مرورگر** اجرا می‌شوند (Node ≥ 20). هیچ‌کدام روی سایت منتشرشده اثری ندارند.

```bash
npm install          # تنها وابستگی: jsdom (فقط برای تست‌های DOM)

npm test             # tests/unit.mjs   — منطق خالص
npm run test:dom     # tests/dom.mjs    — کل پنل داخل jsdom
npm run test:live    # tests/live.mjs   — پنل ↔ بک‌اند واقعی ↔ موتورهای واقعی
```

## `tests/unit.mjs` — منطق خالص (~۳۰ assertion)

بدون DOM و بدون وابستگی. بررسی می‌کند که پورتِ جاوااسکریپتیِ موتور، **هم‌رفتار** با
`downloader/engine.py` و `gui/workers.py` باشد:

- `detectUrl` / `detectUrls` (همان `URL_RE` پایتون، چند لینک در یک متن)
- `classify` و `engineFor` برای دامنه‌های `direct` / `gallery` / ویدئو و پسوندهای `FILE_EXT`
- `friendlyName`، `normalizeUrl`، `suggestedFilename`، `qualityById`
- کلیدهای `ytdlpOptions` (مطابق دیکشنری `yt_dlp.YoutubeDL(opts)` در `ytdlp.py`)
- کاتالوگ سایت‌ها و `describeUrl` (دترمینیستیک بودن متادیتای شبیه‌سازی)
- `format.js` (بایت/سرعت/زمان/ارقام فارسی/escape)
- خروجی‌گیرنده‌ها: `.env`، `docker-compose.yml`، `run.sh`، systemd، snapshot

## `tests/dom.mjs` — یکپارچگی رابط (۷۰ بررسی)

کل پنل را داخل `jsdom` بالا می‌آورد (`assets/js/app.js`) و مثل یک کاربر آن را می‌راند:

1. boot و داشبورد (splash، عنوان، نوار وضعیت)
2. مسیریابی به هر ۷ نما + highlight شدن منو
3. افزودن ۴ لینک، پیش‌نمایش مسیریابی، ساخت ۴ شغل با موتورهای درست
4. پیشرفت شبیه‌سازی، رعایت سقف همزمانی، جریان لاگ‌ها، نوار پیشرفت کلی
5. `pause` / `resume` / `cancel`
6. کشوی جزئیات (باز و بسته شدن)
7. فیلترهای کنسول لاگ (سطح + منبع)
8. تب‌های تنظیمات و ساخت همه‌ی فایل‌های خروجی
9. جست‌وجوی سایت‌ها و «مسیریاب» (`x.com → gallery-dl`)
10. شبیه‌ساز تلگرام (`/ping` و جریان کامل دانلود با `█░░░` و caption)
11. تغییر زبان (FA↔EN + RTL↔LTR) و تم (dark↔light)
12. ماندگاری در `localStorage` و سوییچ حالت demo↔live
13. میان‌برهای صفحه‌کلید (`g` سپس `l`)

`fetch` در این تست عمداً شکست می‌خورد تا مسیر **fallback** موتور HTTP (CORS → شبیه‌ساز) هم پوشش داده شود.

## `tests/live.mjs` — سرتاسری واقعی (۱۸ بررسی)

ابتدا بک‌اند را بالا بیاورید (داخل checkout پروژه‌ی `downloader-bot`):

```bash
pip install -r requirements.txt -r api/requirements.txt
python api/server.py            # → http://127.0.0.1:8787
```

سپس:

```bash
PANEL_API=http://127.0.0.1:8787 npm run test:live
```

این تست **network واقعی** را به jsdom وصل می‌کند و بررسی می‌کند که:

- `GET /api/health` از طریق دکمه‌ی «تست اتصال» در پنل موفق شود و چیپ اتصال سبز شود
- سوییچ به حالت live کار کند
- تایپ یک لینک در صف → `POST /api/jobs` → شغل در سرور ساخته و در پنل mirror شود
- موتور واقعی (HTTP) فایل را دانلود کند و پنل `completed` + حجم واقعی + مسیر سمت سرور را نشان دهد
- آمار داشبورد و لاگ‌ها از رویدادهای سرور به‌روز شوند
- بازگشت به حالت demo بدون خطا انجام شود

> برای اجرای این تست، بک‌اند باید origin جاری را در `WEBPANEL_CORS_ORIGINS` بپذیرد
> (پیش‌فرض `https://devlopergit04.github.io` است؛ برای تست محلی
> `WEBPANEL_CORS_ORIGINS=*` بگذارید).

## پوشش سمت بک‌اند

`downloader/api/server.py` را می‌توانید مستقل هم بررسی کنید (نمونه‌ی curl در
[`../downloader/docs/API.md`](../downloader/docs/API.md)): health، validation (`422`/`404`)،
دانلود واقعی، `GET /api/files/{id}` (magic bytes = `PK`)، چرخه‌ی عمر
(pause/resume/cancel/retry/delete)، `POST /api/config`، `/api/telegram/ping`،
جریان SSE و preflight پروکسی CORS.
