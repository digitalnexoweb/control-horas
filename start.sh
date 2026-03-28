#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"

backend_pid=""
frontend_pid=""

port_in_use() {
  local port="$1"
  ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .
}

cleanup() {
  local exit_code=$?

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi

  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup INT TERM EXIT

if port_in_use "$BACKEND_PORT"; then
  echo "El puerto $BACKEND_PORT ya esta en uso. Libera ese puerto o cambia BACKEND_PORT."
  exit 1
fi

if port_in_use "$FRONTEND_PORT"; then
  echo "El puerto $FRONTEND_PORT ya esta en uso. Libera ese puerto o cambia FRONTEND_PORT."
  exit 1
fi

echo "Levantando backend en http://127.0.0.1:$BACKEND_PORT"
(
  cd "$BACKEND_DIR"
  npm start
) &
backend_pid=$!

echo "Levantando frontend en http://127.0.0.1:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR"
  python3 -m http.server "$FRONTEND_PORT" --bind 0.0.0.0
) &
frontend_pid=$!

echo "Proyecto activo."
echo "Frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "Backend:  http://127.0.0.1:$BACKEND_PORT"
echo "Presiona Ctrl+C para detener ambos procesos."

wait "$backend_pid" "$frontend_pid"
