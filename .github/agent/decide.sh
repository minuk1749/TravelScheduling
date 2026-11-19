#!/bin/bash
# 리뷰 결과 판정: 머지 / 작성자에게 피드백 / 사람에게 넘김 / 일시중단.
# agent-review(Claude가 리뷰한 경우, 테스트 실패)와 agent-verdict(Codex가 리뷰한 경우)가 함께 쓴다.
#
# 입력 환경 변수
#   PR TASK ISSUE ROUND MAX_ROUNDS   작업 식별과 라운드
#   OWNER      구현 담당: gpt(Codex, Mac 러너) | claude(Claude, agent-claude)
#   REVIEWER   리뷰 담당 표시 이름: Claude | Codex
#   PASSED     테스트 통과 여부(true/false)
#   R_TEST R_REVIEW   앞 단계 결과(success/failure/skipped/cancelled)
#   REVIEW_JSON       리뷰 결과 JSON(verdict, summary, issues, notes, refactor)
#   HEAD_SHA   테스트·리뷰 대상 커밋
#   EXECUTOR USER_PAT REFACTOR_MODE RUN_URL RUNNER_TEMP GH_TOKEN
set -euo pipefail
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
T="node .github/agent/tasks.mjs"
REVIEWER="${REVIEWER:-Claude}"
OWNER="${OWNER:-gpt}"

pause() {
  printf '%s\n\n- 작업: `%s`, PR #%s, 라운드 %s\n- 실행 기록: %s\n- 결과: test=%s, review=%s\n\n구독 한도 소진, 토큰 만료, 일시적 장애일 수 있습니다. **원인을 해결한 뒤 이 이슈를 닫으면 PR #%s 의 테스트와 리뷰가 자동으로 다시 실행됩니다.**\n\n<!-- resume:review pr=%s -->\n' \
    "$1" "$TASK" "$PR" "$ROUND" "${RUN_URL:-}" "$R_TEST" "$R_REVIEW" "$PR" "$PR" > "$RUNNER_TEMP/i.md"
  gh issue create --title "자동 루프 일시중단: $TASK (PR #$PR)" --label agent-paused --body-file "$RUNNER_TEMP/i.md"
}
IS_REFACTOR=false; case "$TASK" in R*) IS_REFACTOR=true;; esac
update_tasks() { # 상태 (리팩터링 작업은 작업표에 없음)
  if [ "$IS_REFACTOR" = true ]; then return 0; fi
  $T set "$TASK" "상태=$1" "PR=#$PR"
  git add docs/tasks.md
  git commit -q -m "$TASK $1 (PR #$PR)"
  push_develop
}
push_develop() { # 다른 작업이 동시에 develop을 갱신할 수 있으므로 재시도
  local k
  for k in 1 2 3 4; do
    git pull -q --rebase origin develop && git push -q origin develop && return 0
    sleep $((k * 5))
  done
  echo "::error::develop 푸시 실패"; return 1
}
next_task() { gh workflow run agent-start.yml --ref develop; }
# 오래된 실행은 새 커밋의 리뷰 큐나 상태를 건드리지 않는다.
current_pr() {
  gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" | jq -e --arg head "$HEAD_SHA" --arg task "$TASK" --arg repo "$GITHUB_REPOSITORY" '
    .state == "open" and .draft == false and .base.ref == "develop" and .head.sha == $head and .head.repo.full_name == $repo
    and (.title | startswith($task + ": ")) and ([.labels[].name] | index("needs-human") == null)
  ' >/dev/null
}
if ! current_pr; then
  echo "::notice::PR 상태 또는 최신 커밋이 바뀌어 판정하지 않음"
  exit 0
fi

if [[ "$R_TEST" != success && ( "$R_TEST" != failure || "$PASSED" != false ) ]] \
  || [[ "$R_REVIEW" = failure || "$R_REVIEW" = cancelled ]]; then
  pause "테스트 또는 리뷰 실행에 문제가 있어 자동 루프를 멈췄습니다."; exit 0
fi
verdict=$(printf '%s' "${REVIEW_JSON:-}" | jq -r '.verdict // empty' 2>/dev/null || true)
if [ "$PASSED" = true ] && [[ "$R_TEST" != success || "$R_REVIEW" != success || -z "$verdict" ]]; then
  pause "$REVIEWER 리뷰 또는 테스트 완료 기록을 확인하지 못했습니다."; exit 0
fi
gh pr edit "$PR" --remove-label needs-codex-review >/dev/null 2>&1 || true

if [ "$verdict" = needs_human ]; then
  gh pr edit "$PR" --add-label needs-human
  jq -r '"**사람 확인 필요**\n\n" + .summary + ([.evidence[] | select(.status == "unverified") |
    "\n- " + .criterion + " — " + .source] | join(""))' <<<"$REVIEW_JSON" > "$RUNNER_TEMP/c.md"
  gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md"
  exit 0
fi

# 승인 + 테스트 통과 → 머지
if [ "$PASSED" = true ] && [ "$verdict" = approve ]; then
  if ! gh pr merge "$PR" --squash --delete-branch --match-head-commit "$HEAD_SHA"; then
    # 커밋이 바뀌면 새 실행이 처리한다. 실제 충돌만 작성자에게 보낸다.
    if ! current_pr; then exit 0; fi
    if [ "$(gh pr view "$PR" --json mergeable --jq .mergeable)" != CONFLICTING ]; then
      pause "GitHub가 머지를 거부했습니다. 머지 조건과 실행 로그를 확인해 주세요."; exit 0
    fi
    MERGE_CONFLICT=true
  else
    MERGE_CONFLICT=false
  fi
fi
if [ "${MERGE_CONFLICT:-}" = false ]; then
  jq -r --arg who "$REVIEWER" --arg r "$ROUND" --arg run "${RUN_URL:-}" '
    "**" + $who + " 승인 (라운드 " + $r + ")**\n\n" + .summary + "\n\n검증 기록: " + $run
    + ([.evidence[] | "\n- " + .criterion + " [" + .method + "] — " + .source] | join(""))
    + (if (.notes // "") != "" then "\n\n참고: " + .notes else "" end)
  ' <<<"$REVIEW_JSON" > "$RUNNER_TEMP/c.md"
  gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md" || true
  git pull -q --rebase origin develop
  update_tasks 완료
  if [ -n "$ISSUE" ]; then gh issue close "$ISSUE" --comment "PR #$PR 머지로 완료"; fi

  # 리뷰가 구조적 리팩터링을 제안하면 다음 작업 전에 Claude가 리팩터링한다
  nref=$(jq -r '(.refactor // []) | length' <<<"$REVIEW_JSON")
  if [ "$IS_REFACTOR" = false ] && [ "${REFACTOR_MODE:-on}" != off ] && [ "$nref" -gt 0 ]; then
    gh label create refactor-task --color 0e8a16 --description "Claude가 수행하는 리팩터링" --force >/dev/null
    k=$(( $(gh issue list --state all --label refactor-task --json number --jq length) + 1 ))
    rid="R$k"
    rtitle=$(jq -r '.refactor[0].title' <<<"$REVIEW_JSON")
    {
      echo "$TASK (PR #$PR) $REVIEWER 리뷰에서 제안된 리팩터링입니다. Claude가 수행하고, Codex가 리뷰합니다."
      echo
      echo "## 항목"
      jq -r '.refactor[] | "- **" + .title + "**\n  - 범위: " + .scope + "\n  - 이유: " + .reason' <<<"$REVIEW_JSON"
    } > "$RUNNER_TEMP/r.md"
    url=$(gh issue create --title "$rid: $rtitle" --label refactor-task --body-file "$RUNNER_TEMP/r.md")
    gh workflow run agent-claude.yml --ref develop -f issue="${url##*/}"
    echo "::notice::리팩터링 $rid 시작 (이슈 ${url##*/})"
    exit 0
  fi
  next_task
  exit 0
fi

# 수정 필요 → 피드백 정리
{
  if [ "${MERGE_CONFLICT:-}" = true ]; then
    echo "### 머지 충돌"
    echo "리뷰는 승인됐지만, 그사이 develop에 다른 작업이 머지되어 이 PR이 충돌합니다. develop을 이 브랜치에 병합하고 충돌을 해결해 주세요(승인된 변경 내용은 유지)."
  elif [ "$PASSED" != true ]; then
    echo "### 테스트 실패 (npm ci / lint / typecheck / build / test 중 하나)"
    echo '```'
    cat "$RUNNER_TEMP/test-tail.log" 2>/dev/null || echo "(로그 없음)"
    echo '```'
  else
    echo "### $REVIEWER 리뷰: 수정 요청"
    jq -r '.summary + "\n" + ([.issues[] | "\n- **" + .file + "**: " + .problem + "\n  - 수정 방향: " + .fix] | join(""))' <<<"$REVIEW_JSON"
  fi
} > "$RUNNER_TEMP/fb.md"

# 라운드 기록(작업 이슈에 남겨 PR이 바뀌어도 이어서 센다)
if [ -n "$ISSUE" ]; then
  printf '<!-- agent-review -->\nPR #%s 라운드 %s: 수정 요청\n' "$PR" "$ROUND" | gh issue comment "$ISSUE" --body-file -
fi

if [ "$ROUND" -ge "$MAX_ROUNDS" ]; then
  { echo "**자동 피드백 (라운드 $ROUND, 상한 도달)**"; echo; cat "$RUNNER_TEMP/fb.md"; echo; echo "라운드 상한에 도달해 사람 확인으로 넘깁니다. 이 작업에 의존하는 작업은 건너뜁니다."; } > "$RUNNER_TEMP/c.md"
  gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md"
  gh pr edit "$PR" --add-label needs-human
  if [ -n "$ISSUE" ]; then
    # 없는 라벨을 지우려 하면 gh가 실패하므로 하나씩, 실패를 무시하고 지운다
    gh issue edit "$ISSUE" --add-label needs-human
    gh issue edit "$ISSUE" --remove-label agent-task >/dev/null 2>&1 || true
    gh issue edit "$ISSUE" --remove-label refactor-task >/dev/null 2>&1 || true
  fi
  update_tasks 보류
  next_task
  exit 0
fi

# Claude가 만든 PR(구현·리팩터링)의 수정은 Claude(agent-claude)가 한다
if [ "$OWNER" = claude ]; then
  { echo "<!-- agent-feedback round=$ROUND -->"; echo "**자동 피드백 (라운드 $ROUND / 최대 $MAX_ROUNDS)**"; echo; cat "$RUNNER_TEMP/fb.md"; } > "$RUNNER_TEMP/c.md"
  gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md"
  gh workflow run agent-claude.yml --ref develop -f issue="$ISSUE" -f pr="$PR"
  echo "::notice::수정 요청 → Claude(agent-claude)"
  exit 0
fi

# Codex에 수정 요청. 마커는 Mac 러너가 새 피드백을 찾는 데 쓴다.
{
  echo "<!-- agent-feedback round=$ROUND -->"
  if [ "${EXECUTOR:-local}" = cloud ]; then
    echo "@codex 아래 피드백을 반영해서 이 PR($TASK)을 수정해 줘. 이 PR 브랜치를 기준으로 작업하고, 결과 PR 제목은 반드시 \`$TASK: \`로 시작해야 해. 피드백이 타당하지 않다고 판단하면 고치지 말고 PR 설명의 '남은 이슈'에 근거를 적어 줘."
    echo
  fi
  echo "**자동 피드백 (라운드 $ROUND / 최대 $MAX_ROUNDS)**"
  echo
  cat "$RUNNER_TEMP/fb.md"
} > "$RUNNER_TEMP/c.md"
if [ "${EXECUTOR:-local}" = cloud ]; then
  GH_TOKEN="$USER_PAT" gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md"
  echo "::notice::Codex에 수정 요청함. Codex 완료 후 Codex 화면에서 PR 버튼을 눌러 주세요."
else
  gh pr comment "$PR" --body-file "$RUNNER_TEMP/c.md"
  echo "::notice::피드백을 남김. Mac 러너가 다음 실행 때 반영한다."
fi
