# devlopergit04.github.io

وب‌سایت پروژه‌های [`devlopergit04`](https://github.com/devlopergit04) روی GitHub Pages.

| پروژه | نشانی | توضیح |
|---|---|---|
| 🎛️ **پنل گرافیکی آنلاین Downloader Bot** | <https://devlopergit04.github.io/downloader/> | رابط وبِ [`downloader-bot`](https://github.com/devlopergit04/downloader-bot): صف دانلود زنده، تشخیص خودکار موتور (`yt-dlp` / `gallery-dl` / `HTTP`)، کنسول لاگ، پل تلگرام، سازنده‌ی `.env` و بک‌اند اختیاری FastAPI |

## ساختار مخزن

```
.
├── index.html          صفحه‌ی فرود (معرفی پروژه‌ها)
├── .nojekyll           غیرفعال‌کردن پردازش Jekyll روی GitHub Pages
├── downloader/         پنل گرافیکی آنلاین (SPA استاتیک + PWA)
│   ├── index.html
│   ├── assets/         css · js (ES Modules) · img (SVG)
│   ├── api/            بک‌اند اختیاری FastAPI برای اجرای واقعی دانلودها
│   └── docs/           مستندات API و استقرار
├── tests/              unit · dom (jsdom) · live (سرتاسری با بک‌اند واقعی)
└── package.json        فقط برای ابزار توسعه (npm test / npm run serve)
```

## اجرای محلی

```bash
python3 -m http.server 8080     # یا: npm run serve
# → http://localhost:8080/downloader/
```

هیچ step ساختی وجود ندارد — فایل‌ها مستقیماً سرو می‌شوند.

## تست‌ها

```bash
npm install      # تنها وابستگی توسعه: jsdom
npm test         # منطق خالص (پورت موتور، قالب‌بندی، خروجی‌گیرنده‌ها)
npm run test:dom # کل پنل داخل jsdom — ۷۰ بررسی
npm run test:live# سرتاسری با بک‌اند واقعی (نیاز به اجرای api/server.py)
```

جزئیات در [`tests/README.md`](tests/README.md).

## لایسنس

MIT
