#!/bin/bash
# Mac 러너: 한 번 실행에 한 가지 일만 하고 끝난다. launchd가 1시간마다 실행한다.
#
#   1) 열린 작업 PR에 아직 반영하지 않은 자동 피드백이 있으면 → Codex CLI로 수정 후 푸시
#   2) 작업 PR이 없고 열린 작업 이슈(agent-task)가 있으면 → Codex CLI로 구현, 브랜치 푸시, PR 생성
#   3) 그 밖에는 아무것도 하지 않음 (리뷰 대기 중이거나 할 작업 없음)
#
# 테스트와 Claude 리뷰, 머지는 GitHub Actions(agent-review)가 한다.
# Codex 사용 한도에 걸리면 이번 실행은 실패하고, 다음 실행에서 다시 시도한다.
#
# 환경 변수
#   AGENT_WORKDIR  러너 전용 클론 위치 (기본: ~/agent-work/TravelScheduling). 이 폴더에서 직접 작업하지 말 것.
#   AGENT_REPO     기본: minuk1749/TravelScheduling
#   CODEX_MODEL    비우면 Codex 기본 모델
#
# macOS 기본 bash(3.2)에서 동작하도록 작성했다. 스크립트가 실행 중에 git pull로 바뀌어도
# 안전하도록 전체를 main 함수 안에 두고 마지막에 호출한다.

main() {
  set -euo pipefail

  local REPO="${AGENT_REPO:-minuk1749/TravelScheduling}"
  local WORKDIR="${AGENT_WORKDIR:-$HOME/agent-work/TravelScheduling}"
  LOCK="${WORKDIR}.lock"   # EXIT trap에서 쓰므로 전역
  local PROTECTED='^(\.github/|AGENTS\.md$|CLAUDE\.md$|docs/requirements\.md$|docs/tasks\.md$|scripts/agent/)'

  log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

  # 동시 실행 방지
  mkdir -p "$(dirname "$WORKDIR")"
  # 비정상 종료로 남은 잠금(3시간 초과)은 지운다
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
    log "오래된 잠금을 지움: $LOCK"; rmdir "$LOCK" 2>/dev/null || true
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "이전 실행이 아직 진행 중이라 건너뜀 ($LOCK)"
    return 0
  fi
  # 임시 파일은 정규화된 경로의 임시 폴더에 둔다 (codex는 '..'이 들어간 경로를 거부함)
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/travelscheduling-agent.XXXXXX")
  TMPD=$(cd "$TMPD" && pwd -P)
  trap 'rm -rf "$TMPD"; rmdir "$LOCK" 2>/dev/null || true' EXIT

  local c
  for c in git gh node npm codex; do
    command -v "$c" >/dev/null 2>&1 || { log "필요한 명령이 없음: $c"; return 1; }
  done

  # 일시중단·실행 주체 확인
  if [ "$(gh issue list -R "$REPO" --label agent-paused --state open --json number --jq length)" != 0 ]; then
    log "agent-paused 이슈가 열려 있어 쉼"; return 0
  fi
  local executor
  executor=$(gh variable get AGENT_EXECUTOR -R "$REPO" 2>/dev/null || echo local)
  if [ "$executor" = cloud ]; then
    log "AGENT_EXECUTOR=cloud 라서 Mac 러너는 쉼"; return 0
  fi

  # 러너 전용 클론 준비
  if [ ! -d "$WORKDIR/.git" ]; then
    mkdir -p "$(dirname "$WORKDIR")"
    gh repo clone "$REPO" "$WORKDIR"
  fi
  cd "$WORKDIR"
  git fetch -q --prune origin
  git reset -q --hard
  git clean -qfd

  # 1) 수정 모드: 열린 작업 PR 확인
  local pr
  pr=$(gh pr list -R "$REPO" --state open --base develop --json number,title,labels \
    --jq '[.[] | select(.title | test("^T[0-9]+[A-Z]?:")) | select([.labels[].name] | index("needs-human") | not)] | sort_by(.number) | first | .number // empty')

  if [ -n "$pr" ]; then
    local fb_at head_at branch title task
    fb_at=$(gh pr view "$pr" -R "$REPO" --json comments --jq '[.comments[] | select(.body | contains("<!-- agent-feedback"))] | last | .createdAt // empty')
    head_at=$(gh pr view "$pr" -R "$REPO" --json commits --jq '.commits | last | .committedDate')
    if [ -z "$fb_at" ] || [[ "$fb_at" < "$head_at" ]]; then
      log "PR #$pr 는 리뷰 대기 중 (새 피드백 없음)"; return 0
    fi
    branch=$(gh pr view "$pr" -R "$REPO" --json headRefName --jq .headRefName)
    title=$(gh pr view "$pr" -R "$REPO" --json title --jq .title)
    task=$(echo "$title" | grep -oE '^T[0-9]+[A-Z]?')
    log "수정 모드: PR #$pr ($task), 브랜치 $branch"

    git checkout -q -B "$branch" "origin/$branch"
    install_deps
    local prompt="$TMPD/prompt.md"
    {
      echo "# 수정 지시: PR #$pr ($task)"
      echo
      echo "너는 이 저장소의 구현 담당(gpt)이다. 현재 체크아웃된 브랜치가 PR #$pr 의 브랜치다."
      echo "AGENTS.md와 docs/requirements.md를 참고해서, 아래 '자동 피드백'(테스트 실패 로그 또는 Claude 리뷰)을 해결하라."
      echo "- 지적이 타당하면 고치고, 타당하지 않다고 판단하면 고치지 말고 최종 메시지에 근거를 적어라."
      echo "- 피드백과 무관한 변경은 하지 마라."
      echo "- git commit/push는 하지 마라. 스크립트가 한다."
      echo "- 수정 후 npm run lint, npm run typecheck, npm run build, npm test 를 실행해 확인하라."
      echo "- 보호 파일(.github/**, AGENTS.md, CLAUDE.md, docs/requirements.md, docs/tasks.md, scripts/agent/**)은 수정하지 마라."
      echo "- 최종 메시지는 무엇을 고쳤는지와 남은 이슈를 한국어로 짧게 정리하라."
      echo
      echo "## 자동 피드백"
      echo
      gh pr view "$pr" -R "$REPO" --json comments --jq '[.comments[] | select(.body | contains("<!-- agent-feedback"))] | last | .body'
    } > "$prompt"

    local msg="$TMPD/msg.md"
    run_codex "$prompt" "$msg" || { rm -f "$prompt"; return 1; }
    rm -f "$prompt"
    if ! commit_changes "$task: 리뷰 피드백 반영"; then
      log "변경 없음. Codex 메시지를 PR에 남김"
      { echo "**Mac 러너: 변경 없이 종료**"; echo; cat "$msg" 2>/dev/null; } | gh pr comment "$pr" -R "$REPO" --body-file -
      rm -f "$msg"; return 0
    fi
    git push -q origin "HEAD:$branch"
    { echo "**Mac 러너: 피드백 반영 후 푸시**"; echo; cat "$msg" 2>/dev/null; } | gh pr comment "$pr" -R "$REPO" --body-file -
    rm -f "$msg"
    log "PR #$pr 에 수정 푸시 완료"
    return 0
  fi

  # 2) 구현 모드: 열린 작업 이슈 확인
  local issue
  issue=$(gh issue list -R "$REPO" --state open --label agent-task --json number --jq 'sort_by(.number) | first | .number // empty')
  if [ -z "$issue" ]; then
    log "진행할 작업 없음"; return 0
  fi
  local ititle itask ibranch
  ititle=$(gh issue view "$issue" -R "$REPO" --json title --jq .title)
  itask=$(echo "$ititle" | grep -oE '^T[0-9]+[A-Z]?')
  ibranch="$(echo "$itask" | tr 'A-Z' 'a-z')-local"
  log "구현 모드: 이슈 #$issue ($ititle), 브랜치 $ibranch"

  git checkout -q -B "$ibranch" origin/develop
  install_deps
  local iprompt="$TMPD/prompt.md"
  {
    echo "# 실행 환경 안내 (Mac 러너)"
    echo "- 현재 브랜치는 develop에서 새로 만든 $ibranch 이다."
    echo "- git commit/push와 PR 생성은 하지 마라. 스크립트가 한다. PR 제목은 스크립트가 '$ititle'로 붙인다."
    echo "- 인터넷 접근이 가능하다. 새 패키지는 npm install로 설치해 package-lock.json을 갱신하라."
    echo "- 완료 전에 npm run lint, npm run typecheck, npm run build, npm test 를 실행해 통과를 확인하라."
    echo "- 이 Mac에는 PostgreSQL이 없을 수 있다. DB 테스트가 로컬에서 실패하더라도 테스트를 건너뛰게 바꾸지 말고, 최종 메시지에 그 사실을 적어라(CI에는 PostgreSQL 16이 있다)."
    echo "- scripts/agent/** 도 보호 파일이다."
    echo
    gh issue view "$issue" -R "$REPO" --json body --jq .body
  } > "$iprompt"

  local imsg="$TMPD/msg.md"
  run_codex "$iprompt" "$imsg" || { rm -f "$iprompt"; return 1; }
  rm -f "$iprompt"
  if ! commit_changes "$ititle"; then
    log "Codex가 변경을 만들지 못함"
    { echo "**Mac 러너: 변경 없이 종료.** 다음 실행에서 다시 시도합니다. 계속 반복되면 사람이 확인해 주세요."; echo; cat "$imsg" 2>/dev/null; } | gh issue comment "$issue" -R "$REPO" --body-file -
    rm -f "$imsg"; return 0
  fi
  git push -q -f origin "HEAD:$ibranch"
  {
    cat "$imsg" 2>/dev/null || true
    echo
    echo "---"
    echo "작업 이슈: #$issue · 구현: Codex CLI (Mac 러너) · 리뷰: Claude (agent-review)"
  } > "$imsg.body"
  gh pr create -R "$REPO" --base develop --head "$ibranch" --title "$ititle" --body-file "$imsg.body"
  rm -f "$imsg" "$imsg.body"
  log "PR 생성 완료"
}

install_deps() {
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || true
  elif [ -f package.json ]; then
    npm install --no-audit --no-fund >/dev/null 2>&1 || true
  fi
}

run_codex() { # prompt_file msg_file
  # codex-cli 0.169 기준: 승인 없이 실행, 작업 폴더 쓰기 허용, 샌드박스 안 네트워크 허용(npm 설치용)
  local args=(exec -s workspace-write -c 'approval_policy="never"' -c sandbox_workspace_write.network_access=true --output-last-message "$2")
  if [ -n "${CODEX_MODEL:-}" ]; then args+=(--model "$CODEX_MODEL"); fi
  log "Codex 실행 시작"
  if ! codex "${args[@]}" "$(cat "$1")" < /dev/null; then
    log "Codex 실행 실패 (사용 한도 소진, 로그인 만료, 네트워크 문제일 수 있음). 다음 실행에서 다시 시도"
    return 1
  fi
  log "Codex 실행 종료"
}

commit_changes() { # message
  local f
  # 보호 경로 되돌리기
  git add -A
  for f in $(git diff --cached --name-only | grep -E "$PROTECTED" || true); do
    if git cat-file -e "HEAD:$f" 2>/dev/null; then git checkout -q HEAD -- "$f"; else git rm -q --cached -f -- "$f"; rm -f -- "$f"; fi
    log "보호 경로 변경을 되돌림: $f"
  done
  # lockfile 일치 보장
  if git diff --cached --name-only | grep -qx package.json; then
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 || true
    git add package-lock.json 2>/dev/null || true
  fi
  git diff --cached --quiet && return 1
  git commit -q -m "$1" -m "Codex CLI 구현, Mac 러너 자동 커밋"
}

PROTECTED='^(\.github/|AGENTS\.md$|CLAUDE\.md$|docs/requirements\.md$|docs/tasks\.md$|scripts/agent/)'
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
main "$@"
