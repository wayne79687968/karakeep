#!/usr/bin/env bash
# Karakeep + Assistant — one-command runner.
#
# Wraps `docker compose` so you don't have to type the long path / flags.
# Examples:
#   ./karakeep.sh up           # first time → builds + starts everything
#   ./karakeep.sh start        # subsequent runs → just start (no rebuild)
#   ./karakeep.sh stop         # stop everything (data preserved)
#   ./karakeep.sh logs         # tail logs from all services
#   ./karakeep.sh logs web     # tail logs from just the web container
#   ./karakeep.sh rebuild      # force rebuild after code changes
#   ./karakeep.sh status       # ps-style status of all services
#   ./karakeep.sh down         # stop + remove containers (volumes kept)
#   ./karakeep.sh nuke         # remove EVERYTHING including data volumes (!)

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker/docker-compose.assistant.yml"
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No .env found at repo root."
  echo "   Run: cp docker/.env.assistant.example .env  and fill in the secrets."
  exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

case "${1:-up}" in
  up)        "${DC[@]}" up -d --build "${@:2}" ;;
  start)     "${DC[@]}" up -d "${@:2}" ;;
  stop)      "${DC[@]}" stop "${@:2}" ;;
  down)      "${DC[@]}" down "${@:2}" ;;
  rebuild)   "${DC[@]}" build --no-cache "${@:2}" && "${DC[@]}" up -d "${@:2}" ;;
  logs)      "${DC[@]}" logs -f --tail=200 "${@:2}" ;;
  status|ps) "${DC[@]}" ps ;;
  nuke)
    read -r -p "⚠️  This deletes ALL Karakeep data (DB, bookmarks, vectors). Type YES: " ans
    [ "$ans" = "YES" ] || { echo "Aborted."; exit 1; }
    "${DC[@]}" down -v
    ;;
  *)
    "${DC[@]}" "$@"
    ;;
esac
