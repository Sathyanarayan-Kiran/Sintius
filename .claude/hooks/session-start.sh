#!/bin/bash
# SessionStart hook for Claude Code on the web: installs dependencies and starts a local
# PostgreSQL that matches compose.yaml (127.0.0.1:54329, database `sintius`, superuser
# `sintius_admin`, trust authentication for local development only), then applies migrations.
# Cloud containers have no Docker, so the preinstalled PostgreSQL server binaries are used.
# Idempotent: an existing cluster is reused and only started if it is not running.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

PG_DIR="${SINTIUS_PG_DIR:-/var/lib/sintius-pg}"
PG_PORT=54329

# Newest installed server version; install one if the image has none.
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PG_BIN" ]; then
  echo "session-start: installing PostgreSQL" >&2
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
fi

as_postgres() { su postgres -s /bin/bash -c "$1"; }

mkdir -p "$PG_DIR"
chown postgres:postgres "$PG_DIR"
if [ ! -f "$PG_DIR/data/PG_VERSION" ]; then
  as_postgres "'$PG_BIN/initdb' -D '$PG_DIR/data' -U sintius_admin --auth=trust" >/dev/null
fi
if ! as_postgres "'$PG_BIN/pg_ctl' -D '$PG_DIR/data' status" >/dev/null 2>&1; then
  as_postgres "'$PG_BIN/pg_ctl' -D '$PG_DIR/data' -w -o '-p $PG_PORT -k $PG_DIR -c listen_addresses=127.0.0.1' -l '$PG_DIR/pg.log' start" >/dev/null
fi
if ! as_postgres "'$PG_BIN/psql' -h 127.0.0.1 -p $PG_PORT -U sintius_admin -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = 'sintius'\"" | grep -q 1; then
  as_postgres "'$PG_BIN/createdb' -h 127.0.0.1 -p $PG_PORT -U sintius_admin sintius"
fi

# npm install (not ci) so the cached container state is reused between sessions.
npm install --no-audit --no-fund >/dev/null
npm run -s db:migrate
