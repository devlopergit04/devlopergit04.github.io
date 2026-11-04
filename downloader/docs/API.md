# مستندات API پنل

قرارداد بین پنل گرافیکی آنلاین (`assets/js/api.js`) و بک‌اند اختیاری (`api/server.py`).
همه‌ی پاسخ‌ها `application/json` هستند؛ احراز هویت اختیاری با
`Authorization: Bearer <WEBPANEL_TOKEN>` (برای `EventSource` که هدر نمی‌فرستد،
پارامتر `?token=…` نیز پذیرفته می‌شود).

- Base URL نمونه: `http://127.0.0.1:8787`
- Swagger زنده: `GET /api/docs` · OpenAPI: `GET /api/openapi.json`
- CORS: پیش‌فرض فقط `https://devlopergit04.github.io` (`WEBPANEL_CORS_ORIGINS`)

---

## `GET /api/health`

سلامت بک‌اند و نسخه‌ی موتورها. پنل از این endpoint برای «تست اتصال» و کارت سلامت داشبورد استفاده می‌کند.

```json
{
  "ok": true,
  "bot": "downloader-bot",
  "panel_api": "1.0.0",
  "uptime_sec": 128.4,
  "mode": "live",
  "telegram_configured": false,
  "engines": { "ytdlp": "2026.10.26", "gallerydl": "1.32.19", "ffmpeg": "/usr/bin/ffmpeg", "aiohttp": "3.14.5" },
  "download_dir": "/app/downloads",
  "disk_free_bytes": 20501614592,
  "concurrency": 3,
  "time": "2026-11-04T18:37:53+00:00"
}
```

## `GET /api/stats`

```json
{ "total": 4, "active": 1, "queued": 2, "completed": 1, "failed": 0,
  "cancelled": 0, "total_bytes": 64514, "speed_bps": 0, "uptime_sec": 128.4 }
```

## `GET /api/jobs` → `{ "jobs": [Job, …] }`

## `POST /api/jobs`

```json
{ "url": "https://youtu.be/dQw4w9WgXcQ", "quality": "best" }
```

`201` + آبجکت Job. خطاها: `422` برای URL نامعتبر یا خالی.
`quality` یکی از: `best | 2160 | 1440 | 1080 | 720 | 480 | audio | image`.

## `GET /api/jobs/{id}` · `DELETE /api/jobs/{id}` (204)

## `POST /api/jobs/{id}/pause | resume | retry | cancel`

هر کدام Job به‌روزشده را برمی‌گردانند؛ در وضعیت نامناسب `409`.

| عمل | رفتار واقعی |
|---|---|
| `pause` | لغو تسک + نگه‌داشتن وضعیت (`paused`) |
| `resume` | اجرای مجدد همان لینک (yt-dlp فایل نیمه‌کاره را ادامه می‌دهد) |
| `retry` | صفرکردن پیشرفت و اجرای دوباره |
| `cancel` | لغو تسک و وضعیت `cancelled` |

## `GET /api/logs?limit=300`

```json
{ "log_level": "INFO",
  "logs": [ { "ts": 1793817549.0, "level": "SUCCESS", "source": "HTTP",
              "message": "done → /app/downloads/x.zip (64514 bytes)", "job_id": "5eee2de648ca" } ] }
```

## `GET /api/config` · `POST /api/config`

`POST` فقط تنظیمات **زمان اجرا** را تغییر می‌دهد (فایل `.env` روی دیسک دست‌نخورده می‌ماند):

```json
{ "download_dir": "/data/dl", "max_upload_mb": 80, "ytdlp_retries": 5,
  "ytdlp_concurrent": 6, "log_level": "DEBUG", "extra_formats": "bestvideo*+bestaudio/best" }
```

## `POST /api/telegram/ping`

`getMe` روی Bot API. بدون توکن: `{"ok": false, "configured": false, "detail": "TELEGRAM_BOT_TOKEN is empty"}`.

## `GET /api/files/{id}`

فایل دانلودشده را با `Content-Disposition` برمی‌گرداند.
`409` اگر کار تمام نشده، `410` اگر فایل از دیسک پاک شده باشد.

## `GET /api/events` — Server-Sent Events

جریان زنده‌ی رویدادها. `api.js` ابتدا SSE را امتحان می‌کند و در صورت شکست به
polling روی `GET /api/jobs` برمی‌گردد.

```
event: message
data: {"type":"hello","ts":1793817549.0}

data: {"type":"snapshot","jobs":[ … ]}

data: {"type":"job","job_id":"5eee2de648ca","job":{ … }}

data: {"type":"log","level":"INFO","source":"yt-dlp","message":"…","job_id":"…"}

: keep-alive
```

هر ۵ ثانیه یک `snapshot` کامل ارسال می‌شود تا پنل همیشه همگام بماند.

---

## مدل Job

```jsonc
{
  "id": "5eee2de648ca",
  "url": "https://github.com/…/main.zip",
  "quality": "best",
  "status": "queued|downloading|processing|paused|completed|error|cancelled",
  "phase": "extracting|downloading|processing|",
  "progress": 42.5,             // درصد
  "done_bytes": 0, "total_bytes": 0,   // در حالت زنده پس از اتمام پر می‌شود
  "speed_bps": 0.0, "eta_sec": null,
  "engine": "yt-dlp|gallery-dl|HTTP",
  "kind": "video|audio|image|file",
  "title": "…", "path": "/app/downloads/….zip", "size_bytes": 64514,
  "error": "", "attempts": 1,
  "created_at": 1793817540.1, "started_at": 1793817541.0, "finished_at": 1793817549.0,
  "meta": { "filename": "main.zip", "seconds": 8.0 }
}
```

`assets/js/jobs.js::mapRemote()` دقیقاً همین فیلدها را به مدل داخلی پنل نگاشت می‌کند.

## تست سریع با curl

```bash
B=http://127.0.0.1:8787
curl -s $B/api/health | jq
ID=$(curl -s -X POST $B/api/jobs -H 'Content-Type: application/json' \
      -d '{"url":"https://github.com/devlopergit04/downloader-bot/archive/refs/heads/main.zip"}' | jq -r .id)
watch -n1 "curl -s $B/api/jobs/$ID | jq '{status,progress,engine,size_bytes}'"
curl -OJ $B/api/files/$ID
```
