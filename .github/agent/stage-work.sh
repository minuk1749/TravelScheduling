#!/usr/bin/env bash
# Restore protected index entries from the trusted develop commit, including inherited WIP changes.
set -euo pipefail
base=${1:-origin/develop}
git diff --cached --no-renames --name-only -z "$base" -- \
  .github .claude AGENTS.md CLAUDE.md docs/requirements.md docs/tasks.md scripts/agent |
while IFS= read -r -d '' file; do
  if git cat-file -e "$base:$file" 2>/dev/null; then
    git --literal-pathspecs restore --staged --worktree --source="$base" -- "$file"
  else
    git --literal-pathspecs rm -q --cached -f -- "$file"
  fi
done
