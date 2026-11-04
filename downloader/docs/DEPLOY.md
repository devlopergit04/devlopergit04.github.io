# استقرار (Deploy)

دو بخش مستقل وجود دارد:

| بخش | چیست | کجا اجرا می‌شود |
|---|---|---|
| **پنل گرافیکی** | سایت استاتیک (HTML/CSS/ES Modules) | GitHub Pages — `devlopergit04.github.io/downloader/` |
| **بک‌اند (`api/server.py`)** | موتورهای واقعی دانلود | سیستم شما، Docker، Railway/Fly/VPS |

پنل بدون بک‌اند هم کامل کار می‌کند (حالت **شبیه‌سازی** + دانلود واقعی مرورگر برای لینک‌های مستقیم).

---

## ۱) GitHub Pages

مخزن `devlopergit04.github.io` یک *user site* است، بنابراین هر چیزی که روی شاخه‌ی اصلی
(root) باشد در `https://devlopergit04.github.io/` منتشر می‌شود و پوشه‌ی `downloader/`
به‌طور خودکار در `https://devlopergit04.github.io/downloader/` در دسترس است.

```bash
git checkout -b feat/online-panel
git add downloader index.html .nojekyll
git commit -m "feat: online graphical panel for downloader-bot"
git push origin feat/online-panel     # سپس Pull Request → merge به main
```

نکات:

- فایل `.nojekyll` در ریشه مخزن لازم است تا GitHub Pages هیچ پردازشی روی فایل‌ها انجام ندهد.
- هیچ step ساختی وجود ندارد: مسیرها **نسبی** هستند، بنابراین پنل روی هر مسیر پایه‌ای
  (`/downloader/`، `http://localhost:8080/downloader/` یا حتی `/`) کار می‌کند.
- ناوبری با **hash routing** (`#/queue`) انجام می‌شود تا به rewrite سمت سرور نیاز نباشد.
- `manifest.webmanifest` + `sw.js` پنل را به یک PWA آفلاین تبدیل می‌کنند
  (کش network-first برای ناوبری و stale-while-revalidate برای دارایی‌ها).

### تست محلی

```bash
cd devlopergit04.github.io
python3 -m http.server 8080
# → http://localhost:8080/downloader/
```

---

## ۲) بک‌اند روی همان دستگاه (ساده‌ترین حالت)

```bash
cd downloader-bot
cp -r /path/to/panel/api ./api
pip install -r requirements.txt -r api/requirements.txt
WEBPANEL_CORS_ORIGINS=https://devlopergit04.github.io python api/server.py
```

در پنل: حالت «اتصال زنده» + `http://127.0.0.1:8787`.

> مرورگر اجازه‌ی mixed content نمی‌دهد: صفحه‌ی HTTPS نمی‌تواند به `http://127.0.0.1`
> درخواست بزند **مگر** اینکه مرورگر آن را «potentially trustworthy» بداند —
> کروم و فایرفاکس `http://127.0.0.1` و `http://localhost` را استثنا می‌کنند، بنابراین این حالت کار می‌کند.
> برای هر آدرس دیگری (LAN، دامنه‌ی واقعی) حتماً TLS بگذارید.

---

## ۳) Docker Compose (ربات + پنل در یک میزبان)

از تب **تنظیمات → خروجی گرفتن** فایل `docker-compose.yml` را دانلود کنید:

```bash
docker compose up -d --build
docker compose logs -f webpanel
```

دو سرویس ساخته می‌شود: `downloader-bot` (ربات تلگرام) و `webpanel` (پل REST روی پورت ۸۷۸۷)،
هر دو با همان `.env` و همان پوشه‌ی `./downloads`.

---

## ۴) VPS با systemd + nginx (TLS)

از پنل خروجی `downloader-webpanel.service` را بگیرید و در
`/etc/systemd/system/` بگذارید:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now downloader-webpanel
```

nginx (یا caddy) را جلوی آن بگذارید و **حتماً** `WEBPANEL_TOKEN` تنظیم کنید:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;          # برای Server-Sent Events ضروری است
    proxy_read_timeout 3600s;
}
```

سپس در پنل: `https://api.example.com` به‌عنوان API Base URL + توکن در فیلد مربوطه.

---

## ۵) Railway / Fly.io / Render

- **Build command:** `pip install -r requirements.txt -r api/requirements.txt`
- **Start command:** `python api/server.py`
- **Port:** `8787` (یا از `$PORT` با `WEBPANEL_PORT=$PORT`)
- **Volume:** یک دیسک برای `/app/downloads`
- **Env:** `TELEGRAM_BOT_TOKEN` (اختیاری)، `DOWNLOAD_DIR=/app/downloads`،
  `WEBPANEL_TOKEN=<یک رشته‌ی تصادفی>`، `WEBPANEL_CORS_ORIGINS=https://devlopergit04.github.io`

روی Railway دکمه‌ی «Run on Railway» در README ربات هم همین تصویر را می‌سازد؛
تنها تفاوت، Start command است (`python api/server.py` به‌جای `python bot.py`).

---

## چک‌لیست امنیتی

- [ ] `WEBPANEL_TOKEN` تنظیم شده (وگرنه هر کسی می‌تواند روی ماشین شما دانلود اجرا کند)
- [ ] `WEBPANEL_CORS_ORIGINS` فقط دامنه‌های مورد نظر شما
- [ ] TLS فعال است
- [ ] `DOWNLOAD_DIR` روی volume پایدار و با فضای کافی
- [ ] `MAX_UPLOAD_MB` متناسب با سقف ۵۰ مگابایتی Bot API تلگرام
- [ ] `ffmpeg` نصب است (برای ادغام ویدئو+صدا و خروجی MP3)
