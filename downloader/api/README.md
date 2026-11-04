# `api/` — بک‌اند اختیاری پنل گرافیکی آنلاین

پنل گرافیکی روی GitHub Pages یک سایت **استاتیک** است؛ برای اینکه دانلودها **واقعاً** اجرا شوند،
این پوشه یک پل REST/SSE فراهم می‌کند که همان موتورهای پایتونِ ربات
(`yt-dlp` / `gallery-dl` / `HTTP`) را به مرورگر وصل می‌کند.

```
مرورگر (devlopergit04.github.io/downloader)
        │  REST + Server-Sent Events
        ▼
api/server.py  (FastAPI, uvicorn)
        ▼
downloader/engine.py → yt-dlp · gallery-dl · HTTP
        ▼
downloads/  →  /api/files/{id}  →  ذخیره در سیستم شما
```

## نصب و اجرا

فایل‌های این پوشه را داخل مخزن [`devlopergit04/downloader-bot`](https://github.com/devlopergit04/downloader-bot)
کپی کنید (به‌شکل `api/server.py`) تا `config.py` و `downloader/` یک سطح بالاتر قرار بگیرند:

```bash
cd downloader-bot
cp -r /path/to/panel/api ./api

pip install -r requirements.txt -r api/requirements.txt
python api/server.py
#   ▶ web panel API  →  http://127.0.0.1:8787/api/docs
```

سپس در پنل: **حالت «اتصال زنده»** را روشن کنید و آدرس بک‌اند را در
`تنظیمات → بک‌اند و اتصال` بگذارید (`http://127.0.0.1:8787`).

> `TELEGRAM_BOT_TOKEN` اختیاری است. بدون آن، پنل به‌تنهایی یک دانلودر وب کامل است و
> `/api/telegram/ping` مقدار `configured: false` برمی‌گرداند.

## متغیرهای محیطی مخصوص پل وب

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `WEBPANEL_HOST` | `0.0.0.0` | آدرس گوش‌دادن |
| `WEBPANEL_PORT` | `8787` | پورت |
| `WEBPANEL_CORS_ORIGINS` | `https://devlopergit04.github.io` | origins مجاز (جدا با کاما) |
| `WEBPANEL_TOKEN` | *(خالی)* | در صورت تنظیم، پنل باید `Authorization: Bearer …` بفرستد |
| `WEBPANEL_CONCURRENCY` | `3` | حداکثر دانلود همزمان |
| `WEBPANEL_MAX_JOBS` | `200` | سقف کارهای نگهداری‌شده در حافظه |

همه‌ی متغیرهای `.env` خودِ ربات (`DOWNLOAD_DIR`، `MAX_UPLOAD_MB`، `YTDLP_RETRIES`،
`YTDLP_CONCURRENT`، `LOG_LEVEL`) نیز خوانده می‌شوند — می‌توانید همین‌ها را از تب
«خروجی گرفتن» در پنل بسازید و دانلود کنید.

## Docker

```bash
docker build -f api/Dockerfile -t downloader-webpanel .
docker run --rm -p 8787:8787 --env-file .env -v "$PWD/downloads:/app/downloads" downloader-webpanel
```

یا با `docker-compose.yml` که از خود پنل خروجی گرفته‌اید (دو سرویس: `downloader-bot` و `webpanel`).

## نکات مهم

- **pause/resume** — `yt-dlp` و `gallery-dl` واسط توقف ندارند؛ `pause` تسک را لغو می‌کند و وضعیت را
  نگه می‌دارد، `resume` همان لینک را دوباره اجرا می‌کند (yt-dlp به‌صورت پیش‌فرض فایل‌های نیمه‌کاره را ادامه می‌دهد).
- **cancel** — لغو واقعی تسک (`asyncio.CancelledError`).
- **حجم/سرعت** — هوک پیشرفتِ `downloader/engine.py` فقط درصد می‌دهد، بنابراین در حالت زنده نوار پیشرفت
  درصدی است و حجم نهایی پس از اتمام گزارش می‌شود.
- **امنیت** — این سرویس روی سیستم شما دانلود اجرا می‌کند. برای دسترسی عمومی حتماً
  `WEBPANEL_TOKEN` بگذارید و پشت TLS (nginx/caddy) قرار دهید.
- مستندات کامل endpointها: [`../docs/API.md`](../docs/API.md).
