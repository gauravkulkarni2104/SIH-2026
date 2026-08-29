#!/usr/bin/env bash
# Convenience script: starts backend (port 8000) and frontend dev server (port 5173).
set -e
cd "$(dirname "$0")"

echo "Starting backend..."
(cd backend && [ -d venv ] || python3 -m venv venv)
source backend/venv/bin/activate
pip install -q -r backend/requirements.txt
(cd backend && uvicorn app.main:app --port 8000 &)

echo "Starting frontend..."
(cd frontend && [ -d node_modules ] || npm install)
(cd frontend && npm run dev)
