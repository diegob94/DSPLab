#!/bin/sh
# Serves the app locally: ES modules don't load from file://, so open
# http://localhost:8000 instead of double-clicking index.html.
#
#   ./serve.sh           port 8000
#   ./serve.sh 9000      another port
#   HOST=0.0.0.0 ./serve.sh   reachable from other machines (default: this machine only)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
HOST="${HOST:-127.0.0.1}"
echo "DSPLab on http://localhost:$PORT  (Ctrl+C to stop)"
exec python3 -m http.server "$PORT" --bind "$HOST"
