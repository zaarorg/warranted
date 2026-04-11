# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM python:3.12-slim

RUN adduser --system --no-create-home sidecar

WORKDIR /app

COPY sidecar/requirements-lock.txt ./requirements-lock.txt
RUN pip install --no-cache-dir -r requirements-lock.txt

# Preserve Python package structure for sidecar.server:app
COPY sidecar/__init__.py sidecar/__init__.py
COPY sidecar/server.py sidecar/server.py

USER sidecar

ENV ED25519_SEED=""
ENV RULES_ENGINE_URL=""
ENV PORT=8100

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn sidecar.server:app --host 0.0.0.0 --port ${PORT}"]
