#!/usr/bin/env bash
# 스테이징된 변경에서 보호 파일을 develop 내용으로 되돌린다(develop 병합으로 들어온 변경은 유지).
# agent-claude의 게시 전 검사가 실행한다. 실행 위치: 작업 저장소 루트, origin/develop이 있어야 한다.
set -euo pipefail
for f in $(git diff --cached --name-only | grep -E '^(\.github/|AGENTS\.md$|CLAUDE\.md$|docs/requirements\.md$|docs/tasks\.md$|scripts/agent/)' || true); do
  if git diff --cached --quiet origin/develop -- "$f"; then continue; fi
  if git cat-file -e "origin/develop:$f" 2>/dev/null; then git restore --staged --worktree --source=origin/develop -- "$f"; else git rm -q --cached -f -- "$f"; fi
done
