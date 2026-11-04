# Builds from the repository root:
#     docker build -f api/Dockerfile -t downloader-webpanel .
FROM python:3.11-slim

# ffmpeg is required by yt-dlp to merge separate video+audio streams.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r api/requirements.txt

COPY . .
RUN mkdir -p downloads

ENV WEBPANEL_HOST=0.0.0.0 \
    WEBPANEL_PORT=8787 \
    WEBPANEL_CORS_ORIGINS=https://devlopergit04.github.io \
    DOWNLOAD_DIR=/app/downloads

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1

CMD ["python", "api/server.py"]
