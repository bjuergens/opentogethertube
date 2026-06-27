#!/bin/bash
# Installs JS dependencies so tests and linters can run in Claude Code on the web.
#
# Why bun instead of yarn: in the remote container, `yarn install` against the
# npm registry repeatedly aborts pending requests / times out. `bun install`
# (compatible with the workspaces in package.json) reliably installs all
# packages in ~25s, after which the existing vitest suites run unmodified.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if command -v bun >/dev/null 2>&1; then
  bun install
else
  # Fallback for environments without bun: reduce yarn's network concurrency
  # to lessen the aborted-request failures seen with the default settings.
  corepack enable || true
  YARN_NETWORK_CONCURRENCY=4 yarn install
fi
