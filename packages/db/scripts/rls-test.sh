#!/usr/bin/env bash
# RLS test runner.
#
# Applies all migrations to the running local Supabase stack, loads
# fixtures, and runs every *_test.sql file under tests/rls/. Exits
# non-zero on the first assertion failure.
#
# Pre-req: the local Supabase stack is running (`pnpm db:start` in this
# package). This script does NOT boot/tear the stack — that is the
# caller's responsibility (locally: manual; CI: the rls-tests workflow
# job).
#
# Connection parameters are the Supabase CLI defaults documented in
# config.toml (port 54322, user/pw postgres/postgres).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54322}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

psql_run() {
  # -v ON_ERROR_STOP=1 so any raised exception aborts the file.
  # -X disables psqlrc so a dev's local config can't skew behavior.
  psql -X -v ON_ERROR_STOP=1 -q "$@"
}

echo "==> RLS tests: loading helpers"
psql_run -f "$PKG_DIR/tests/rls/_helpers.sql"

echo "==> RLS tests: loading fixtures"
psql_run -f "$PKG_DIR/tests/rls/_setup.sql"

TEST_COUNT=0
for f in "$PKG_DIR"/tests/rls/*_test.sql; do
  NAME="$(basename "$f")"
  echo "==> RLS tests: running $NAME"
  psql_run -f "$f"
  TEST_COUNT=$((TEST_COUNT + 1))
done

echo "==> RLS tests: $TEST_COUNT file(s) passed"
