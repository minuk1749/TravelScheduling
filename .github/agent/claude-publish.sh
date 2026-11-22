#!/usr/bin/env bash
# Sourced by claude-candidate.sh on the publish runner, after verified commit and scope checks.
set -euo pipefail
: "${USER_PAT:?USER_PAT 시크릿이 없음}"
# GH_TOKEN is the read-only Actions token, including when check-pr reads the workflow runs.
write_gh() { GH_TOKEN="$USER_PAT" gh "$@"; }
issue=$(gh issue view "$ISSUE" --json state,title)
title=$(jq -er 'select(.state == "OPEN") | .title' <<< "$issue")
[[ $title =~ ^(T[0-9]+[A-Z]?|R[0-9]+): ]] || exit 1
id=${BASH_REMATCH[1]}
[[ $(tr 'A-Z' 'a-z' <<< "$id") == "$task" ]] || exit 1
if [[ $id == T* ]]; then
  table="$control/docs/tasks.md"
  [[ $(node "$control/.github/agent/tasks.mjs" get "$id" 담당 --file "$table") == claude ]] || exit 1
  state=$(node "$control/.github/agent/tasks.mjs" get "$id" 상태 --file "$table")
  [[ $state == 진행중 || $state == 리뷰 ]] || exit 1
fi

read_remote="https://x-access-token:${GH_TOKEN}@github.com/${GH_REPO}.git"
write_remote="https://x-access-token:${USER_PAT}@github.com/${GH_REPO}.git"
remote_tip() {
  git -C "$store" ls-remote --heads "$read_remote" "refs/heads/$1" | cut -f1
}
report="$RUNNER_TEMP/archive/claude-report.md"
[[ -f $report && ! -L $report && $(wc -c < "$report") -le 65000 ]] || exit 1
existing_pr=""
if [[ -n $PR ]]; then
  pr_info=$(gh pr view "$PR" --json headRefName,headRefOid,title)
  branch=$(jq -er --arg prefix "$id:" 'select(.title | startswith($prefix)) | .headRefName' <<< "$pr_info")
  git check-ref-format "refs/heads/$branch"
  [[ $branch != main && $branch != develop && $branch != wip/* ]] || exit 1
  expected=$(jq -er .headRefOid <<< "$pr_info")
  # A retry after a successful push may only finish the metadata for that same commit.
  [[ $expected == "$base" || $expected == "$commit" ]] || exit 1
  node "$control/.github/agent/check-pr.mjs" "$GH_REPO" "$PR" "$expected" claude
  round=$(gh pr view "$PR" --json comments --jq '[.comments[] | select(.body | contains("<!-- agent-feedback"))] | length + 1')
  [[ $round =~ ^[0-9]+$ ]] || exit 1
else
  if [[ $id == R* ]]; then branch="$task-refactor"; else branch="$task-claude"; fi
  expected=$(remote_tip "$branch")
  if [[ -n $expected && $expected != "$commit" ]]; then
    branch="$branch-$GITHUB_RUN_NUMBER"
    expected=$(remote_tip "$branch")
  fi
  [[ -z $expected || $expected == "$commit" ]] || exit 1
  if [[ -n $expected ]]; then
    existing_pr=$(gh pr list --state open --base develop --head "$branch" --json number --jq '.[0].number // empty')
  fi
  round=1
fi

if [[ $commit == "$base" ]]; then
  write_gh issue comment "$ISSUE" --body "Claude가 변경 없이 종료했습니다(라운드 $round). 사람이 확인해 주세요."
  write_gh issue edit "$ISSUE" --add-label needs-human
  exit 0
fi
[[ $(remote_tip "$branch") == "$expected" ]] || exit 1
if [[ -n $PR ]]; then node "$control/.github/agent/check-pr.mjs" "$GH_REPO" "$PR" "$expected" claude; fi
if [[ $expected != "$commit" ]]; then
  git -C "$store" push -q "$write_remote" "$commit:refs/heads/$branch"
fi
if [[ -z $PR ]]; then
  if [[ -z $existing_pr ]]; then
    write_gh label create owner-claude --color fbca04 --description "Claude가 구현한 PR (Codex가 리뷰)" --force >/dev/null
    write_gh pr create --base develop --head "$branch" --title "$title" --label owner-claude --body-file "$report"
  fi
else
  write_gh pr edit "$PR" --body-file "$report" >/dev/null
  { printf '**Claude 수정 (라운드 %s)**\n\n' "$round"; cat "$report"; } | write_gh pr comment "$PR" --body-file -
fi

# Remote WIP tips included in the verified commit can be pruned within this issue/PR/base only.
scope=${WIP%/*}
patterns=("refs/heads/$scope/*-$base")
if [[ -z $PR ]]; then patterns+=("refs/heads/wip/$task-[0-9]*"); fi
refs=$(git -C "$store" ls-remote --heads "$read_remote" "${patterns[@]}")
while read -r oid ref; do
  [[ -n $ref ]] || continue
  ref=${ref#refs/heads/}
  if [[ $ref == "$scope/"* ]]; then
    [[ ${ref#"$scope/"} =~ ^[0-9]+\.[0-9]+-$base$ ]] || continue
  else
    [[ -z $PR && $ref =~ ^wip/$task-[0-9]+$ ]] || continue
  fi
  if git -C "$store" cat-file -e "$oid^{commit}" 2>/dev/null && git -C "$store" merge-base --is-ancestor "$oid" "$commit"; then
    git -C "$store" push -q "$write_remote" --delete "$ref" || true
  fi
done <<< "$refs"
