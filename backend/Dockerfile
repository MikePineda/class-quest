# ClassQuest API image. Build from the REPO ROOT (not backend/), because the
# image needs schema/ and fixtures/ next to the app:
#   docker build -f backend/Dockerfile -t classquest-api .
# Dokploy: Dockerfile=backend/Dockerfile, build context=/ (repo root).
# python:3.12-slim ships linux/arm64, so it runs on the Oracle aarch64 box.
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so this layer caches across code changes.
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY schema ./schema
COPY fixtures ./fixtures

# Settings env var names are the UPPERCASE of the fields in app/config.py.
# SCHEMA_DIR / FIXTURES_DIR must be set here: config.py's defaults resolve
# relative to the repo root on disk, which does not exist inside the image.
ENV DATA_DIR=/data \
    SCHEMA_DIR=/app/schema \
    FIXTURES_DIR=/app/fixtures

# /data is the persistent volume (sqlite db + uploads). Mount it in Dokploy.
RUN mkdir -p /data/uploads

EXPOSE 8000

# python:3.12-slim has no curl, so probe with the stdlib.
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4); sys.exit(0 if r.status == 200 else 1)"]

# --workers 1 is REQUIRED, not a tuning knob:
#  - storage is a single SQLite file; multiple processes would fight over the
#    write lock and the create_all() on startup.
#  - world generation runs in an in-process background thread; a second
#    worker would not see the first worker's job state.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
