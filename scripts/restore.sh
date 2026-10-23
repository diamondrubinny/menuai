#!/usr/bin/env bash
# MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
# Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
# Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
#
# Restores a backup made by scripts/backup.sh. REPLACES the current database, images and
# published menus.
# Usage (on the server, in the install directory):
#   bash scripts/restore.sh /path/menuai-YYYYMMDDTHHMMSSZ.tar.age /path/menuai-backup.key --yes
# Env: APP_DIR (/opt/menuai), COMPOSE ("docker compose")
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/menuai}"
COMPOSE="${COMPOSE:-docker compose}"
die() { echo "restore: $*" >&2; exit 1; }

archive="${1:-}"; identity="${2:-}"; confirm="${3:-}"
[[ -f "$archive" && -f "$identity" ]] || die "usage: restore.sh <backup.tar.age> <age identity file> --yes"
[[ "$confirm" == "--yes" ]] || die "this replaces ALL current data (menus, users, images). Re-run with --yes to confirm."
command -v age >/dev/null || die "age is not installed (apt-get install age)"

cd "$APP_DIR"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Decrypt and check the archive completely before touching anything.
age -d -i "$identity" "$archive" 2>/dev/null | tar -C "$work" -xf - 2>/dev/null \
  || die "cannot decrypt: wrong key, or the file is not a MenuAI backup"
[[ "$(head -n1 "$work/MANIFEST")" == "menuai-backup 1" ]] || die "not a MenuAI backup"
( cd "$work" && grep -E '^[0-9a-f]{64}  ' MANIFEST | sha256sum -c --quiet - ) || die "checksum mismatch: archive is damaged"
echo "restore: $(sed -n 2p "$work/MANIFEST") from $(sed -n 3p "$work/MANIFEST")"

# Stop the API so nothing writes during the restore; the database keeps running.
$COMPOSE stop api
# shellcheck disable=SC2317  # called from the EXIT trap
restart_api() { $COMPOSE start api >/dev/null 2>&1 || true; }
trap 'restart_api; rm -rf "$work"' EXIT

$COMPOSE exec -T db pg_restore -U menuai -d menuai --clean --if-exists --no-owner --single-transaction < "$work/db.dump"
$COMPOSE run --rm --no-deps -T --entrypoint sh api -c \
  'cd /var/lib/menuai && rm -rf published/* uploads/public/* && tar -xf -' < "$work/files.tar"

$COMPOSE start api
for _ in $(seq 1 30); do
  if $COMPOSE exec -T api wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok"'; then
    echo "restore: done, the server is healthy."
    exit 0
  fi
  sleep 2
done
die "restored, but the server did not report healthy: check 'docker compose logs api'"
