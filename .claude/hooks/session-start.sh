#!/bin/bash
set -euo pipefail

# Only applies to Claude Code on the web — a local session already has the
# developer's own git identity and an installed node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The remote container ships with its own git identity (Claude
# <noreply@anthropic.com>) and an SSH commit-signing key belonging to the
# container rather than to this repo's author. Left alone, commits land
# attributed to Claude and GitHub marks them "Unverified", because it cannot
# tie that signing key to the author's account. Pin both to match the rest of
# the history. Repo-local, so nothing outside this checkout is affected.
git config --local user.name "Safwan Ahmed"
git config --local user.email "s4fw4n4hmed@gmail.com"
git config --local commit.gpgsign false

# AGENTS.md requires reading the bundled Next.js guides under
# node_modules/next/dist/docs/ before writing code, and lint, type-check, test
# and build all need the dependency tree, so install it up front.
#
# --no-save keeps the install from rewriting package-lock.json. The container's
# npm normalises metadata the committed lockfile doesn't carry (peer flags,
# platform-specific optional deps), so without it every session would start
# with a dirty working tree that has nothing to do with the work being done.
npm install --no-save --no-audit --no-fund
