#!/usr/bin/env python3
"""REST/SSE bridge between the online panel and the downloader-bot engines.

    https://devlopergit04.github.io/downloader/   ←→   this file   ←→   DownloaderEngine

Drop this file into the root of the downloader-bot repository (as ``api/server.py``),
install the extra requirements and run it::

    pip install -r api/requirements.txt
    python api/server.py                     # http://127.0.0.1:8787

Then open the panel, switch to **«اتصال زنده» (live)** and point it at this address.
Every button in the browser now drives the real ``yt-dlp`` / ``gallery-dl`` / ``HTTP``
engines on this machine, and the finished files are streamed back to the browser.

The Telegram bot is *not* required: without ``TELEGRAM_BOT_TOKEN`` the panel works as
a plain web downloader and ``/api/telegram/ping`` reports ``configured: false``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import sys
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

# ── make the repository root importable when run as `python api/server.py` ──
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from contextlib import asynccontextmanager

    from fastapi import FastAPI, HTTPException, Query, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "FastAPI/uvicorn are missing. Install them with:\n"
        "    pip install -r api/requirements.txt"
    ) from exc

try:
    from config import Settings, load_settings
    from downloader import DownloaderEngine
    from downloader.engine import DIRECT_DOMAINS, GALLERY_DOMAINS
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        f"Could not import the bot package ({exc}).\n"
        "Copy this file into the downloader-bot repository so that "
        "`config.py` and `downloader/` sit one level above `api/`."
    ) from exc

log = logging.getLogger("webpanel")

PANEL_ORIGIN = "https://devlopergit04.github.io"
HOST = os.getenv("WEBPANEL_HOST", "0.0.0.0")
PORT = int(os.getenv("WEBPANEL_PORT", "8787"))
CORS_ORIGINS = [o.strip() for o in os.getenv("WEBPANEL_CORS_ORIGINS", PANEL_ORIGIN).split(",") if o.strip()]
AUTH_TOKEN = os.getenv("WEBPANEL_TOKEN", "").strip()
MAX_JOBS = int(os.getenv("WEBPANEL_MAX_JOBS", "200"))
CONCURRENCY = int(os.getenv("WEBPANEL_CONCURRENCY", os.getenv("YTDLP_CONCURRENT", "3")))


# ══════════════════════════════════════════════════════════════════════
# settings — the bot's, but tolerant of a missing Telegram token
# ══════════════════════════════════════════════════════════════════════
def load_settings_safe() -> Settings:
    try:
        return load_settings()
    except SystemExit:
        log.warning("TELEGRAM_BOT_TOKEN not set — starting in web-panel-only mode")
        download_dir = Path(os.getenv("DOWNLOAD_DIR", "./downloads")).expanduser()
        download_dir.mkdir(parents=True, exist_ok=True)

        def _int(name: str, default: int) -> int:
            try:
                return int(os.getenv(name, default))
            except (TypeError, ValueError):
                return default

        return Settings(
            token="",
            allowed_user_id=os.getenv("ALLOWED_USER_ID", "").strip(),
            max_upload_mb=_int("MAX_UPLOAD_MB", 50),
            download_dir=download_dir,
            ytdlp_retries=_int("YTDLP_RETRIES", 10),
            ytdlp_concurrent=_int("YTDLP_CONCURRENT", 4),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        )


SETTINGS = load_settings_safe()
ENGINE = DownloaderEngine(SETTINGS)
STARTED_AT = time.time()


def classify(url: str) -> str:
    """Same rules as downloader/engine.py::_classify, kept local and public."""
    low = (url or "").lower()
    if any(domain in low for domain in DIRECT_DOMAINS):
        return "direct"
    if any(domain in low for domain in GALLERY_DOMAINS):
        return "gallery"
    return "video"


# ══════════════════════════════════════════════════════════════════════
# job model
# ══════════════════════════════════════════════════════════════════════
STATUSES = ("queued", "downloading", "processing", "paused", "completed", "error", "cancelled")


@dataclass
class Job:
    id: str
    url: str
    quality: str = "best"
    status: str = "queued"
    phase: str = ""
    progress: float = 0.0
    done_bytes: int = 0
    total_bytes: int = 0
    speed_bps: float = 0.0
    eta_sec: Optional[float] = None
    engine: str = ""
    kind: str = ""
    title: str = ""
    path: str = ""
    size_bytes: int = 0
    error: str = ""
    attempts: int = 0
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    meta: Dict[str, Any] = field(default_factory=dict)
    task: Optional[asyncio.Task] = field(default=None, repr=False)
    _stop: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    _last_emit: float = 0.0

    #: fields serialised to the panel (never asdict() — it would deepcopy the Task)
    PUBLIC_FIELDS = (
        "id", "url", "quality", "status", "phase", "progress", "done_bytes",
        "total_bytes", "speed_bps", "eta_sec", "engine", "kind", "title", "path",
        "size_bytes", "error", "attempts", "created_at", "started_at",
        "finished_at", "meta",
    )

    def public(self) -> Dict[str, Any]:
        data = {name: getattr(self, name) for name in self.PUBLIC_FIELDS}
        data["meta"] = dict(self.meta or {})
        return data


class JobStore:
    def __init__(self) -> None:
        self.jobs: Dict[str, Job] = {}
        self.order: List[str] = []
        self.semaphore = asyncio.Semaphore(max(1, CONCURRENCY))
        self.events: Deque[Dict[str, Any]] = deque(maxlen=500)
        self.logs: Deque[Dict[str, Any]] = deque(maxlen=1000)
        self.listeners: List[asyncio.Queue] = []

    # -- crud -----------------------------------------------------------
    def add(self, job: Job) -> Job:
        self.jobs[job.id] = job
        self.order.insert(0, job.id)
        while len(self.order) > MAX_JOBS:
            old = self.order.pop()
            self.jobs.pop(old, None)
        return job

    def get(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"unknown job {job_id}")
        return job

    def delete(self, job_id: str) -> None:
        job = self.jobs.pop(job_id, None)
        if job is None:
            raise HTTPException(status_code=404, detail=f"unknown job {job_id}")
        if job.task and not job.task.done():
            job.task.cancel()
        if job_id in self.order:
            self.order.remove(job_id)

    def list(self) -> List[Job]:
        return [self.jobs[i] for i in self.order if i in self.jobs]

    # -- event bus ------------------------------------------------------
    def push_log(self, level: str, source: str, message: str, job_id: str | None = None) -> None:
        entry = {
            "ts": time.time(),
            "level": level.upper(),
            "source": source,
            "message": message,
            "job_id": job_id,
        }
        self.logs.append(entry)
        self.broadcast({"type": "log", **entry})

    def broadcast(self, payload: Dict[str, Any]) -> None:
        self.events.append({**payload, "ts": time.time()})
        for q in list(self.listeners):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(payload)

    def job_event(self, job: Job, throttle: float = 0.0) -> None:
        now = time.time()
        if throttle and now - job._last_emit < throttle:
            return
        job._last_emit = now
        self.broadcast({"type": "job", "job_id": job.id, "job": job.public()})

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self.listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self.listeners:
            self.listeners.remove(q)


STORE = JobStore()


# ══════════════════════════════════════════════════════════════════════
# worker
# ══════════════════════════════════════════════════════════════════════
async def run_job(job: Job) -> None:
    """Execute one download through the bot's DownloaderEngine."""
    async with STORE.semaphore:
        if job._stop.is_set():
            return
        job.status = "downloading"
        job.phase = "extracting"
        job.attempts += 1
        job.started_at = time.time()
        job.error = ""
        job._stop.clear()
        STORE.job_event(job)
        kind = classify(job.url)
        job.engine = {"direct": "HTTP", "gallery": "gallery-dl"}.get(kind, "yt-dlp")
        job.kind = {"direct": "file", "gallery": "image"}.get(kind, "video")
        STORE.push_log("INFO", job.engine, f"start {job.url}", job.id)

        started = time.time()

        async def progress(pct: int, total: int) -> None:
            if job._stop.is_set():
                raise asyncio.CancelledError()
            job.progress = max(0.0, min(100.0, float(pct)))
            job.phase = "downloading"
            elapsed = max(0.25, time.time() - started)
            if job.total_bytes:
                job.done_bytes = int(job.total_bytes * job.progress / 100)
                job.speed_bps = job.done_bytes / elapsed
                job.eta_sec = max(0.0, (job.total_bytes - job.done_bytes) / job.speed_bps) if job.speed_bps else None
            STORE.job_event(job, throttle=0.25)

        try:
            result = await ENGINE.download(job.url, progress)
            job.status = "completed"
            job.phase = ""
            job.progress = 100.0
            job.path = str(result.path)
            job.size_bytes = int(result.size_bytes or 0)
            job.total_bytes = job.total_bytes or job.size_bytes
            job.done_bytes = job.size_bytes
            job.title = result.title
            job.kind = result.kind or job.kind
            job.finished_at = time.time()
            job.speed_bps = 0.0
            job.eta_sec = None
            job.meta = {"filename": Path(job.path).name, "seconds": round(job.finished_at - started, 2)}
            STORE.push_log("SUCCESS", job.engine, f"done → {job.path} ({job.size_bytes} bytes)", job.id)
        except asyncio.CancelledError:
            job.status = "cancelled" if not job._stop.is_set() else "paused"
            job.phase = ""
            job.speed_bps = 0.0
            job.finished_at = time.time()
            STORE.push_log("WARNING", job.engine, f"{job.status}: {job.url}", job.id)
            raise
        except Exception as exc:  # noqa: BLE001
            job.status = "error"
            job.phase = ""
            job.error = f"{type(exc).__name__}: {exc}"[:500]
            job.finished_at = time.time()
            job.speed_bps = 0.0
            STORE.push_log("ERROR", job.engine, job.error, job.id)
        finally:
            STORE.job_event(job)


def schedule(job: Job) -> None:
    job.task = asyncio.create_task(_guarded(job))


async def _guarded(job: Job) -> None:
    try:
        await run_job(job)
    except asyncio.CancelledError:
        pass
    except Exception as exc:  # noqa: BLE001
        log.exception("job %s crashed", job.id)
        STORE.push_log("ERROR", "webpanel", f"{type(exc).__name__}: {exc}", job.id)


# ══════════════════════════════════════════════════════════════════════
# HTTP API
# ══════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(_app: "FastAPI"):
    logging.basicConfig(
        level=getattr(logging, SETTINGS.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    STORE.push_log("INFO", "webpanel", f"listening on {HOST}:{PORT} — origins {CORS_ORIGINS}")
    STORE.push_log("INFO", "webpanel", f"download_dir={SETTINGS.download_dir} concurrency={CONCURRENCY}")
    shown_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    print(f"\n  ▶ web panel API  →  http://{shown_host}:{PORT}/api/docs")
    print(f"  ▶ open the panel →  {PANEL_ORIGIN}/downloader/   (mode: live)\n", flush=True)
    yield
    for job in STORE.list():
        if job.task and not job.task.done():
            job.task.cancel()


app = FastAPI(
    title="downloader-bot web panel API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    description="Backend for https://devlopergit04.github.io/downloader/",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or [PANEL_ORIGIN],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Disposition"],
)


class JobIn(BaseModel):
    url: str
    quality: str = "best"


class ConfigIn(BaseModel):
    download_dir: Optional[str] = None
    max_upload_mb: Optional[int] = None
    ytdlp_retries: Optional[int] = None
    ytdlp_concurrent: Optional[int] = None
    log_level: Optional[str] = None
    extra_formats: Optional[str] = None


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if AUTH_TOKEN and request.url.path.startswith("/api/"):
        supplied = request.query_params.get("token") or (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        if supplied != AUTH_TOKEN:
            return JSONResponse({"detail": "invalid or missing WEBPANEL_TOKEN"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    import shutil
    from importlib.metadata import version, PackageNotFoundError

    def ver(pkg: str) -> str:
        try:
            return version(pkg)
        except PackageNotFoundError:
            return "missing"

    free = shutil.disk_usage(SETTINGS.download_dir).free if SETTINGS.download_dir.exists() else 0
    return {
        "ok": True,
        "bot": "downloader-bot",
        "panel_api": app.version,
        "uptime_sec": round(time.time() - STARTED_AT, 1),
        "mode": "live",
        "telegram_configured": bool(SETTINGS.token),
        "engines": {
            "ytdlp": ver("yt-dlp"),
            "gallerydl": ver("gallery-dl"),
            "ffmpeg": shutil.which("ffmpeg") or "",
            "aiohttp": ver("aiohttp"),
        },
        "download_dir": str(SETTINGS.download_dir),
        "disk_free_bytes": free,
        "concurrency": CONCURRENCY,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/stats")
async def stats() -> Dict[str, Any]:
    jobs = STORE.list()
    active = [j for j in jobs if j.status in ("downloading", "processing")]
    return {
        "total": len(jobs),
        "active": len(active),
        "queued": sum(1 for j in jobs if j.status == "queued"),
        "completed": sum(1 for j in jobs if j.status == "completed"),
        "failed": sum(1 for j in jobs if j.status == "error"),
        "cancelled": sum(1 for j in jobs if j.status == "cancelled"),
        "total_bytes": sum(j.size_bytes for j in jobs),
        "speed_bps": sum(j.speed_bps for j in active),
        "uptime_sec": round(time.time() - STARTED_AT, 1),
    }


@app.get("/api/jobs")
async def list_jobs() -> Dict[str, Any]:
    return {"jobs": [j.public() for j in STORE.list()]}


@app.post("/api/jobs", status_code=201)
async def create_job(payload: JobIn) -> Dict[str, Any]:
    url = (payload.url or "").strip()
    if not url:
        raise HTTPException(status_code=422, detail="url is required")
    if not (url.startswith("http://") or url.startswith("https://") or url.startswith("www.")):
        raise HTTPException(status_code=422, detail="not a URL")
    if url.startswith("www."):
        url = "https://" + url
    job = Job(id=uuid.uuid4().hex[:12], url=url, quality=payload.quality or "best")
    STORE.add(job)
    STORE.push_log("INFO", "queue", f"queued {url}")
    STORE.job_event(job)
    schedule(job)
    return job.public()


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    return STORE.get(job_id).public()


@app.delete("/api/jobs/{job_id}", status_code=204)
async def remove_job(job_id: str) -> None:
    STORE.delete(job_id)


@app.post("/api/jobs/{job_id}/pause")
async def pause_job(job_id: str) -> Dict[str, Any]:
    job = STORE.get(job_id)
    if job.status not in ("downloading", "processing", "queued"):
        raise HTTPException(status_code=409, detail=f"job is {job.status}")
    job._stop.set()          # run_job turns a stop-flag cancel into "paused"
    if job.task and not job.task.done():
        job.task.cancel()
    job.status = "paused"
    job.phase = ""
    STORE.job_event(job)
    STORE.push_log("WARNING", "queue", f"paused {job.url}", job.id)
    return job.public()


@app.post("/api/jobs/{job_id}/resume")
async def resume_job(job_id: str) -> Dict[str, Any]:
    job = STORE.get(job_id)
    if job.status not in ("paused", "error", "cancelled", "queued"):
        raise HTTPException(status_code=409, detail=f"job is {job.status}")
    resumed_from_pause = job.status == "paused"
    job.status = "queued"
    if not resumed_from_pause:
        job.progress = 0.0
        job.done_bytes = 0
    job.error = ""
    job._stop.clear()
    STORE.job_event(job)
    STORE.push_log("INFO", "queue", f"resumed {job.url}", job.id)
    schedule(job)
    return job.public()


@app.post("/api/jobs/{job_id}/retry")
async def retry_job(job_id: str) -> Dict[str, Any]:
    job = STORE.get(job_id)
    job.status = "queued"
    job.progress = 0.0
    job.error = ""
    job._stop.clear()
    STORE.job_event(job)
    STORE.push_log("INFO", "queue", f"retry #{job.attempts + 1} {job.url}", job.id)
    schedule(job)
    return job.public()


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> Dict[str, Any]:
    job = STORE.get(job_id)
    if job.task and not job.task.done():
        job.task.cancel()
    job.status = "cancelled"
    job.phase = ""
    job.finished_at = time.time()
    STORE.job_event(job)
    STORE.push_log("WARNING", "queue", f"cancelled {job.url}", job.id)
    return job.public()


@app.get("/api/logs")
async def get_logs(limit: int = Query(300, ge=1, le=1000)) -> Dict[str, Any]:
    items = list(STORE.logs)[-limit:]
    return {"logs": items, "log_level": SETTINGS.log_level}


@app.get("/api/config")
async def get_config() -> Dict[str, Any]:
    return {
        "download_dir": str(SETTINGS.download_dir),
        "max_upload_mb": SETTINGS.max_upload_mb,
        "ytdlp_retries": SETTINGS.ytdlp_retries,
        "ytdlp_concurrent": SETTINGS.ytdlp_concurrent,
        "log_level": SETTINGS.log_level,
        "extra_formats": SETTINGS.extra_formats,
        "allowed_user_id": SETTINGS.allowed_user_id,
        "telegram_configured": bool(SETTINGS.token),
        "cors_origins": CORS_ORIGINS,
    }


@app.post("/api/config")
async def set_config(payload: ConfigIn) -> Dict[str, Any]:
    """Update the *runtime* settings object (the .env file on disk is untouched)."""
    changes: List[str] = []
    if payload.download_dir:
        new_dir = Path(payload.download_dir).expanduser()
        new_dir.mkdir(parents=True, exist_ok=True)
        object.__setattr__(SETTINGS, "download_dir", new_dir)
        object.__setattr__(ENGINE, "settings", SETTINGS)
        changes.append(f"download_dir={new_dir}")
    for name in ("max_upload_mb", "ytdlp_retries", "ytdlp_concurrent"):
        value = getattr(payload, name)
        if value is not None:
            object.__setattr__(SETTINGS, name, int(value))
            changes.append(f"{name}={value}")
    if payload.log_level:
        level = payload.log_level.upper()
        object.__setattr__(SETTINGS, "log_level", level)
        logging.getLogger().setLevel(getattr(logging, level, logging.INFO))
        changes.append(f"log_level={level}")
    if payload.extra_formats:
        object.__setattr__(SETTINGS, "extra_formats", payload.extra_formats)
        changes.append("extra_formats updated")
    STORE.push_log("INFO", "webpanel", "config updated: " + (", ".join(changes) or "no-op"))
    return await get_config()


@app.post("/api/telegram/ping")
async def telegram_ping() -> Dict[str, Any]:
    if not SETTINGS.token:
        return {"ok": False, "configured": False, "detail": "TELEGRAM_BOT_TOKEN is empty"}
    try:
        from telegram.ext import ApplicationBuilder
    except ImportError:
        return {"ok": False, "configured": True, "detail": "python-telegram-bot not installed"}

    t0 = time.time()
    try:
        application = ApplicationBuilder().token(SETTINGS.token).build()
        async with application:
            await application.initialize()
            me = await application.bot.get_me()
        ms = round((time.time() - t0) * 1000)
        STORE.push_log("SUCCESS", "telegram", f"getMe ok in {ms}ms (@{me.username})")
        return {"ok": True, "configured": True, "bot": f"@{me.username}", "id": me.id, "ms": ms}
    except Exception as exc:  # noqa: BLE001
        ms = round((time.time() - t0) * 1000)
        STORE.push_log("ERROR", "telegram", f"getMe failed: {exc}")
        return {"ok": False, "configured": True, "detail": str(exc)[:300], "ms": ms}


@app.get("/api/files/{job_id}")
async def get_file(job_id: str) -> FileResponse:
    job = STORE.get(job_id)
    if job.status != "completed" or not job.path:
        raise HTTPException(status_code=409, detail="job has no finished file")
    path = Path(job.path)
    if not path.exists():
        raise HTTPException(status_code=410, detail=f"file is gone: {path}")
    return FileResponse(path, filename=path.name)


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    """Server-Sent Events: job updates, logs and a snapshot every 5 s."""
    queue = STORE.subscribe()

    async def stream():
        try:
            yield f"event: message\ndata: {json.dumps({'type': 'hello', 'ts': time.time()})}\n\n"
            yield f"data: {json.dumps({'type': 'snapshot', 'jobs': [j.public() for j in STORE.list()]})}\n\n"
            last_snapshot = time.time()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield f"data: {json.dumps(payload, default=str)}\n\n"
                except asyncio.TimeoutError:
                    if time.time() - last_snapshot > 5:
                        last_snapshot = time.time()
                        yield f"data: {json.dumps({'type': 'snapshot', 'jobs': [j.public() for j in STORE.list()]})}\n\n"
                    else:
                        yield ": keep-alive\n\n"
        finally:
            STORE.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "service": "downloader-bot web panel API",
        "panel": PANEL_ORIGIN + "/downloader/",
        "docs": "/api/docs",
        "health": "/api/health",
    }


def main() -> int:
    uvicorn.run(app, host=HOST, port=PORT, log_level=SETTINGS.log_level.lower(), access_log=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
