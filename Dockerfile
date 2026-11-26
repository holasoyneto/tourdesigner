# Stage 1: Build static web & PWA bundle
FROM node:25-slim AS web
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN mkdir -p /build/backend/static/v3 && npm run build

# Stage 2: Stateless Python API + static asset runtime
FROM python:3.12-slim
ARG BUILD_SHA=""
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    BUILD_SHA=${BUILD_SHA} \
    REPO_BACKEND=sqlite \
    FILE_STORAGE_BACKEND=local \
    LOCAL_DB_PATH=/app/data/tour-designer-v2.sqlite3 \
    FILE_VAULT_LOCAL_PATH=/app/data/vault

WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/scripts ./scripts
COPY docs ./docs
RUN pip install --no-cache-dir ".[gcp]" && mkdir -p /app/data/vault
COPY --from=web /build/backend/static ./static

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
