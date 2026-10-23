#!/usr/bin/env bash
# MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
# Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
# Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
#
# Encrypted backup of a MenuAI server (database + uploaded images + published menus).
# The archive is encrypted with age to a PUBLIC key: the server itself can never decrypt it,
# so a stolen server or backup disk exposes nothing. Keep the private key off the server.
#
# Usage (on the server, in the install directory):
#   BACKUP_AGE_RECIPIENT=age1... bash scripts/backup.sh
# Env: APP_DIR (/opt/menuai), BACKUP_DIR (/var/backups/menuai), BACKUP_KEEP_DAYS (14),
#      BACKUP_AGE_RECIPIENT (or the file $APP_DIR/.backup-recipient), COMPOSE ("docker compose")
# Create a key pair once, on your own computer:  age-keygen -o menuai-backup.key
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/menuai}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/menuai}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose}"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
if [[ -z "$RECIPIENT" && -f "$APP_DIR/.backup-recipient" ]]; then RECIPIENT="$(tr -d '[:space:]' < "$APP_DIR/.backup-recipient")"; fi

die() { echo "backup: $*" >&2; exit 1; }
[[ "$RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die "set BACKUP_AGE_RECIPIENT to an age public key (age1...)"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_DAYS must be a number"
command -v age >/dev/null || die "age is not installed (apt-get install age)"

cd "$APP_DIR"
umask 077
mkdir -p "$BACKUP_DIR"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1. Database (custom format: compressed, restorable with pg_restore).
$COMPOSE exec -T db pg_dump -U menuai -d menuai --format=custom --no-owner > "$work/db.dump"

# 2. Released images and published menus (the quarantine folder is never backed up).
$COMPOSE exec -T api sh -c 'cd /var/lib/menuai && mkdir -p published uploads/public && tar -cf - published uploads/public' > "$work/files.tar"

# 3. Manifest, then one encrypted archive, written atomically.
{
  echo "menuai-backup 1"
  echo "created $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  ( cd "$work" && sha256sum db.dump files.tar )
} > "$work/MANIFEST"

name="menuai-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
tar -C "$work" -cf - MANIFEST db.dump files.tar | age -r "$RECIPIENT" > "$BACKUP_DIR/.$name.partial"
mv "$BACKUP_DIR/.$name.partial" "$BACKUP_DIR/$name"

# 4. Retention: keep the last BACKUP_KEEP_DAYS days.
find "$BACKUP_DIR" -maxdepth 1 -name 'menuai-*.tar.age' -type f -mtime +"$KEEP_DAYS" -delete

echo "backup: $BACKUP_DIR/$name ($(du -h "$BACKUP_DIR/$name" | cut -f1)). Copy it off this server (e.g. rsync or object storage)."
