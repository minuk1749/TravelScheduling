#!/bin/bash
# Mac 러너: 한 번 실행에 한 가지 일만 하고 끝난다. launchd가 1시간마다 실행한다.
#
#   0) Claude가 만든 PR에 needs-codex-review 라벨이 있으면 → Codex CLI로 리뷰하고 판정 댓글 (agent-verdict가 판정)
#   1) Codex가 만든 열린 작업 PR에 아직 반영하지 않은 자동 피드백이 있으면 → Codex CLI로 수정 후 푸시
#   2) 작업 PR이 없고 Codex 담당 작업 이슈(agent-task, owner-claude 아님)가 있으면 → Codex CLI로 구현, 브랜치 푸시, PR 생성
#      구현 중 Codex가 실패하면(사용 한도 등) 그때까지의 변경을 wip/<작업>-<시각> 브랜치에 저장하고,
#      다음 구현 실행은 가장 최근 wip 브랜치에서 이어서 한다. PR을 올리면 그 작업의 wip 브랜치는 지운다.
#   3) 그 밖에는 아무것도 하지 않음 (리뷰 대기 중이거나 할 작업 없음)
#
# 테스트와 판정·머지는 GitHub Actions(agent-review, agent-verdict)가 한다.
# Codex 사용 한도에 걸리면 이번 실행은 실패하고, 다음 실행에서 다시 시도한다.
#
# 환경 변수
#   AGENT_WORKDIR  러너 전용 클론 위치 (기본: ~/agent-work/TravelScheduling). 이 폴더에서 직접 작업하지 말 것.
#   AGENT_REPO     기본: minuk1749/TravelScheduling
#   CODEX_MODEL    지정하면 .github/agent/models.json보다 우선 (보통 비워 둔다)
#
# macOS 기본 bash(3.2)에서 동작하도록 작성했다. 스크립트가 실행 중에 git pull로 바뀌어도
# 안전하도록 전체를 main 함수 안에 두고 마지막에 호출한다.

main() {
  set -euo pipefail

  REPO="${AGENT_REPO:-minuk1749/TravelScheduling}"   # 함수들에서 쓰므로 전역
  local WORKDIR="${AGENT_WORKDIR:-$HOME/agent-work/TravelScheduling}"
  LOCK="${WORKDIR}.lock"   # EXIT trap에서 쓰므로 전역
  FAILFILE="${WORKDIR}.codex-failures"   # Codex 연속 실패 횟수 (전역)
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

  # 0) 리뷰 모드: Claude가 만든 PR 중 Codex 리뷰를 기다리는 것
  local rpr
  rpr=$(gh pr list -R "$REPO" --state open --label needs-codex-review --json number --jq 'sort_by(.number) | first | .number // empty')
  if [ -n "$rpr" ]; then
    review_pr "$rpr"
    return $?
  fi

  # 1) 수정 모드: 열린 작업 PR 확인 (Codex가 만든 PR만)
  local pr
  pr=$(gh pr list -R "$REPO" --state open --base develop --json number,title,labels \
    --jq '[.[] | select(.title | test("^T[0-9]+[A-Z]?:")) | select([.labels[].name] | (index("needs-human") or index("owner-claude")) | not)] | sort_by(.number) | first | .number // empty')

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
    # 동시에 진행된 다른 작업을 반영한다. 충돌이 나면 충돌 표시를 남겨 Codex가 해결한다
    local merge_note=""
    if ! git merge -q --no-edit origin/develop >/dev/null 2>&1; then
      merge_note="develop을 이 브랜치에 병합했고 충돌이 있다. 충돌 표시(<<<<<<<, =======, >>>>>>>)가 있는 파일을 먼저 해결하라(양쪽 변경의 의도를 모두 유지)."
      log "develop 병합 충돌, Codex가 해결"
    fi
    install_deps
    local prompt="$TMPD/prompt.md"
    {
      echo "# 수정 지시: PR #$pr ($task)"
      echo
      echo "너는 이 저장소의 구현 담당(gpt)이다. 현재 체크아웃된 브랜치가 PR #$pr 의 브랜치다."
      echo "AGENTS.md와 docs/requirements.md를 참고해서, 아래 '자동 피드백'(테스트 실패 로그 또는 Claude 리뷰)을 해결하라."
      echo "- 지적이 타당하면 고치고, 타당하지 않다고 판단하면 고치지 말고 최종 메시지에 근거를 적어라."
      echo "- 피드백과 무관한 변경은 하지 마라."
      if [ -n "$merge_note" ]; then echo "- $merge_note"; fi
      echo "- git commit/push는 하지 마라. 스크립트가 한다."
      echo "- 수정 후 npm run lint, npm run typecheck, npm run build, npm test 를 실행해 확인하라."
      echo "- 보호 파일(.github/**, AGENTS.md, CLAUDE.md, docs/requirements.md, docs/tasks.md, scripts/agent/**)은 수정하지 마라."
      echo "- AGENTS.md의 \"작업 원칙\"을 따르고, 최종 메시지는 \"PR 설명(완료 보고) 형식\"으로 PR 전체에 대한 최신 보고를 작성하라(PR 설명을 이 메시지로 교체한다)."
      echo
      echo "## 자동 피드백"
      echo
      gh pr view "$pr" -R "$REPO" --json comments --jq '[.comments[] | select(.body | contains("<!-- agent-feedback"))] | last | .body'
    } > "$prompt"

    local msg="$TMPD/msg.md"
    run_codex "$prompt" "$msg" "$task" || { rm -f "$prompt"; return 1; }
    rm -f "$prompt"
    if ! commit_changes "$task: 리뷰 피드백 반영" && [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ]; then
      log "변경 없음. Codex 메시지를 PR에 남김"
      { echo "**Mac 러너: 변경 없이 종료**"; echo; cat "$msg" 2>/dev/null; } | gh pr comment "$pr" -R "$REPO" --body-file -
      rm -f "$msg"; return 0
    fi
    git push -q origin "HEAD:$branch"
    { echo "**Mac 러너: 피드백 반영 후 푸시**"; echo; cat "$msg" 2>/dev/null; } | gh pr comment "$pr" -R "$REPO" --body-file -
    # PR 설명도 최신 보고로 바꾼다(리뷰어가 PR 설명을 작성자의 주장으로 읽기 때문)
    if [ -s "$msg" ]; then gh pr edit "$pr" -R "$REPO" --body-file "$msg" >/dev/null || true; fi
    rm -f "$msg"
    log "PR #$pr 에 수정 푸시 완료"
    return 0
  fi

  # 2) 구현 모드: 열린 작업 이슈 확인
  local issue
  issue=$(gh issue list -R "$REPO" --state open --label agent-task --json number,labels --jq '[.[] | select([.labels[].name] | index("owner-claude") | not)] | sort_by(.number) | first | .number // empty')
  if [ -z "$issue" ]; then
    log "진행할 작업 없음"; return 0
  fi
  local ititle itask ibranch
  ititle=$(gh issue view "$issue" -R "$REPO" --json title --jq .title)
  itask=$(echo "$ititle" | grep -oE '^T[0-9]+[A-Z]?')
  ibranch="$(echo "$itask" | tr 'A-Z' 'a-z')-local"
  log "구현 모드: 이슈 #$issue ($ititle), 브랜치 $ibranch"

  # 이전 실행이 중단되며 남긴 작업이 있으면 가장 최근 것에서 이어서 한다
  local wip wip_note=""
  wip=$(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/wip/$(echo "$itask" | tr 'A-Z' 'a-z')-*" | sort -V | tail -1)
  if [ -n "$wip" ]; then
    log "이전 중단 작업($wip)에서 이어서 함"
    git checkout -q -B "$ibranch" "$wip"
    wip_note="- 이전 실행이 끝나기 전에 중단되어(사용 한도 등) 그때까지의 변경을 커밋해 두었고, 지금 그 커밋 위에서 시작한다(git log origin/develop..HEAD, git diff origin/develop 로 확인). 처음부터 다시 만들지 말고 이미 한 작업을 확인해 남은 부분을 마무리하라. 미완성이거나 충돌 표시(<<<<<<<)가 남아 있을 수 있으니 확인하라."
    if ! git merge -q --no-edit origin/develop >/dev/null 2>&1; then
      wip_note="$wip_note develop을 병합했고 충돌이 있다. 충돌 표시가 있는 파일을 먼저 해결하라(양쪽 변경의 의도를 모두 유지)."
      log "develop 병합 충돌, Codex가 해결"
    fi
  else
    git checkout -q -B "$ibranch" origin/develop
  fi
  install_deps
  local iprompt="$TMPD/prompt.md"
  {
    echo "# 실행 환경 안내 (Mac 러너)"
    if [ -n "$wip" ]; then echo "- 현재 브랜치는 이전 중단 작업($wip)에서 만든 $ibranch 이다."; else echo "- 현재 브랜치는 develop에서 새로 만든 $ibranch 이다."; fi
    if [ -n "$wip_note" ]; then echo "$wip_note"; fi
    echo "- git commit/push와 PR 생성은 하지 마라. 스크립트가 한다. PR 제목은 스크립트가 '$ititle'로 붙인다."
    echo "- 인터넷 접근이 가능하다. 새 패키지는 npm install로 설치해 package-lock.json을 갱신하라."
    echo "- 완료 전에 npm run lint, npm run typecheck, npm run build, npm test 를 실행해 통과를 확인하라."
    echo "- 이 Mac에는 PostgreSQL이 없을 수 있다. DB 테스트가 로컬에서 실패하더라도 테스트를 건너뛰게 바꾸지 말고, 최종 메시지에 그 사실을 적어라(CI에는 PostgreSQL 16이 있다)."
    echo "- scripts/agent/** 도 보호 파일이다."
    echo
    gh issue view "$issue" -R "$REPO" --json body --jq .body
  } > "$iprompt"

  local imsg="$TMPD/msg.md" rc=0
  run_codex "$iprompt" "$imsg" "$itask" || rc=$?
  rm -f "$iprompt"
  if [ "$rc" != 0 ]; then
    # 실행 실패(1)면 변경을 저장한다. 다른 모델로 실행된 결과(2)는 쓰지 않는다
    if [ "$rc" = 1 ]; then save_wip "$itask"; fi
    return 1
  fi
  # 이어서 한 작업(wip)은 이전 커밋이 있으므로 이번 실행에 새 변경이 없어도 PR을 올린다
  if ! commit_changes "$ititle" && [ -z "$wip" ]; then
    log "Codex가 변경을 만들지 못함"
    { echo "**Mac 러너: 변경 없이 종료.** 다음 실행에서 다시 시도합니다. 계속 반복되면 사람이 확인해 주세요."; echo; cat "$imsg" 2>/dev/null; } | gh issue comment "$issue" -R "$REPO" --body-file -
    rm -f "$imsg"; return 0
  fi
  # 강제 푸시는 쓰지 않는다. 같은 이름의 브랜치가 이미 있으면(이전 실패 흔적) 새 이름을 쓴다
  if git ls-remote --exit-code --heads origin "$ibranch" >/dev/null 2>&1; then
    ibranch="$ibranch-$(date +%Y%m%d%H%M%S)"
    git branch -q -m "$ibranch"
  fi
  git push -q origin "HEAD:$ibranch"
  {
    cat "$imsg" 2>/dev/null || true
    echo
    echo "---"
    echo "작업 이슈: #$issue · 구현: Codex CLI (Mac 러너) · 리뷰: Claude (agent-review)"
  } > "$imsg.body"
  gh pr create -R "$REPO" --base develop --head "$ibranch" --title "$ititle" --body-file "$imsg.body"
  rm -f "$imsg" "$imsg.body"
  # PR에 들어간 중단 작업 브랜치는 더 쓰지 않으므로 지운다
  local w
  for w in $(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/wip/$(echo "$itask" | tr 'A-Z' 'a-z')-*"); do
    git push -q origin --delete "${w#origin/}" || true
  done
  log "PR 생성 완료"
}

review_pr() { # pr
  local pr="$1" head branch task title out schema prompt used picked model effort
  head=$(gh pr view "$pr" -R "$REPO" --json headRefOid --jq .headRefOid)
  branch=$(gh pr view "$pr" -R "$REPO" --json headRefName --jq .headRefName)
  title=$(gh pr view "$pr" -R "$REPO" --json title --jq .title)
  task=$(echo "$title" | grep -oE '^(T[0-9]+[A-Z]?|R[0-9]+)' || echo "?")
  log "리뷰 모드: PR #$pr ($task), 커밋 ${head:0:7}"
  git fetch -q origin "$branch"
  git checkout -q --detach "$head"
  printf '.ctl-pr-body.md\n' >> .git/info/exclude
  gh pr view "$pr" -R "$REPO" --json body --jq .body > .ctl-pr-body.md

  schema="$TMPD/review-schema.json"
  cat > "$schema" <<'JSON'
{"type":"object","additionalProperties":false,"properties":{"verdict":{"type":"string","enum":["approve","request_changes"]},"summary":{"type":"string"},"issues":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"file":{"type":"string"},"problem":{"type":"string"},"fix":{"type":"string"}},"required":["file","problem","fix"]}},"notes":{"type":"string"},"refactor":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string"},"scope":{"type":"string"},"reason":{"type":"string"}},"required":["title","scope","reason"]}}},"required":["verdict","summary","issues","notes","refactor"]}
JSON
  prompt="$TMPD/review-prompt.md"
  {
    if gh pr view "$pr" -R "$REPO" --json labels --jq '[.labels[].name] | index("owner-claude")' | grep -q '^[0-9]'; then
      echo "저장소 $REPO, PR #$pr, 작업 $task. 구현은 Claude가 했고 너(Codex)가 리뷰한다. 기준 브랜치는 origin/develop이다."
    else
      echo "저장소 $REPO, PR #$pr, 작업 $task. 구현은 Codex의 다른 실행이 했고, 너는 **자체 리뷰** 담당이다. Claude도 별도로 리뷰하며 둘 다 승인해야 머지된다. 작성자의 설명을 믿지 말고 독립적인 시각으로 검토하라. 기준 브랜치는 origin/develop이다."
    fi
    echo "PR 설명은 .ctl-pr-body.md에 있다. 파일을 수정하지 마라. 결과는 지정된 JSON 스키마로만 반환하라(notes, refactor는 없으면 빈 값)."
    echo
    git show origin/develop:.github/agent/prompts/review.md 2>/dev/null
  } > "$prompt"

  git show origin/develop:.github/agent/models.json > "$TMPD/models.json" 2>/dev/null || true
  git show origin/develop:.github/agent/model-for.mjs > "$TMPD/model-for.mjs" 2>/dev/null || true
  picked=$(node "$TMPD/model-for.mjs" codex-review "$task" "$TMPD/models.json" 2>/dev/null || printf '\t\n')
  model=$(printf '%s' "$picked" | cut -f1); effort=$(printf '%s' "$picked" | cut -f2)
  local args=(exec -s read-only -c 'approval_policy="never"' --output-schema "$schema" --output-last-message "$TMPD/review.json")
  if [ -n "$model" ]; then args+=(--model "$model"); fi
  if [ -n "$effort" ]; then args+=(-c "model_reasoning_effort=\"$effort\""); fi
  log "Codex 리뷰 시작 (모델 ${model:-기본값}, 추론 ${effort:-기본값})"
  out="$TMPD/codex.out"
  if ! codex "${args[@]}" "$(cat "$prompt")" < /dev/null 2>&1 | tee "$out"; then
    record_failure "$task 리뷰" "$out"; return 1
  fi
  used=$(grep -m1 -E '^model: ' "$out" | sed 's/^model: //' || true)
  if [ -n "$model" ] && [ -n "$used" ] && [ "$used" != "$model" ]; then
    pause_issue "Codex 리뷰가 배정한 모델(\`$model\`)이 아니라 \`$used\`로 실행되어 결과를 쓰지 않고 멈췄습니다 (PR #$pr)." "$out"
    return 1
  fi
  if ! node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!["approve","request_changes"].includes(r.verdict)) process.exit(1)' "$TMPD/review.json" 2>/dev/null; then
    record_failure "$task 리뷰(판정 JSON 오류)" "$out"; return 1
  fi
  echo 0 > "$FAILFILE"

  # 판정 댓글: 사람이 읽을 요약 + agent-verdict가 읽을 JSON
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const lines = [`<!-- codex-review sha=${process.argv[2]} -->`, `**Codex 리뷰: ${r.verdict === "approve" ? "승인" : "수정 요청"}**`, "", r.summary];
    for (const i of r.issues || []) lines.push("", `- **${i.file}**: ${i.problem}`, `  - 수정 방향: ${i.fix}`);
    if (r.notes) lines.push("", `참고: ${r.notes}`);
    lines.push("", "<details><summary>판정 JSON</summary>", "", "```json", JSON.stringify(r, null, 2), "```", "", "</details>");
    process.stdout.write(lines.join("\n") + "\n");
  ' "$TMPD/review.json" "$head" > "$TMPD/review-comment.md"
  gh pr edit "$pr" -R "$REPO" --remove-label needs-codex-review >/dev/null
  gh pr comment "$pr" -R "$REPO" --body-file "$TMPD/review-comment.md" >/dev/null
  log "PR #$pr 에 Codex 리뷰 판정을 남김"
}

install_deps() {
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || true
  elif [ -f package.json ]; then
    npm install --no-audit --no-fund >/dev/null 2>&1 || true
  fi
}

run_codex() { # prompt_file msg_file task
  # codex-cli 0.169 기준: 승인 없이 실행, 작업 폴더 쓰기 허용, 샌드박스 안 네트워크 허용(npm 설치용)
  local args=(exec -s workspace-write -c 'approval_policy="never"' -c sandbox_workspace_write.network_access=true --output-last-message "$2")
  # 작업별 모델: develop의 .github/agent/models.json (CODEX_MODEL 환경 변수가 있으면 모델은 그것 우선)
  local cfg="$TMPD/models.json" picked model effort
  git show origin/develop:.github/agent/models.json > "$cfg" 2>/dev/null || true
  git show origin/develop:.github/agent/model-for.mjs > "$TMPD/model-for.mjs" 2>/dev/null || true
  picked=$(node "$TMPD/model-for.mjs" codex "${3:-}" "$cfg" 2>/dev/null || printf '\t\n')
  model=$(printf '%s' "$picked" | cut -f1)
  effort=$(printf '%s' "$picked" | cut -f2)
  if [ -n "${CODEX_MODEL:-}" ]; then model="$CODEX_MODEL"; fi
  if [ -n "$model" ]; then args+=(--model "$model"); fi
  if [ -n "$effort" ]; then args+=(-c "model_reasoning_effort=\"$effort\""); fi
  log "Codex 실행 시작 (작업 ${3:-?}, 모델 ${model:-기본값}, 추론 ${effort:-기본값})"
  local out="$TMPD/codex.out" used
  if ! codex "${args[@]}" "$(cat "$1")" < /dev/null 2>&1 | tee "$out"; then
    record_failure "${3:-?}" "$out"
    return 1
  fi
  # 배정한 모델과 실제로 쓰인 모델이 다르면(자동 대체 등) 결과를 쓰지 않고 바로 멈춘다
  used=$(grep -m1 -E '^model: ' "$out" | sed 's/^model: //' || true)
  if [ -n "$model" ] && [ -n "$used" ] && [ "$used" != "$model" ]; then
    log "배정 모델($model)과 실제 모델($used)이 달라 결과를 버리고 멈춤"
    pause_issue "Codex가 배정한 모델(\`$model\`)이 아니라 \`$used\`로 실행되어, 결과를 PR로 올리지 않고 멈췄습니다 (작업 ${3:-?})." "$out"
    return 2
  fi
  echo 0 > "$FAILFILE"
  log "Codex 실행 종료"
}

record_failure() { # task output_file
  local n
  n=$(( $(cat "$FAILFILE" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$FAILFILE"
  log "Codex 실행 실패 (연속 $n회). 사용 한도 소진, 로그인 만료, 네트워크 문제일 수 있음"
  if [ "$n" -ge 3 ]; then
    pause_issue "Codex 실행이 연속 ${n}회 실패해 자동 작업을 멈췄습니다 (작업 $1). 사용 한도 소진이면 한도가 다시 찬 뒤 재개하세요." "$2"
    echo 0 > "$FAILFILE"
  fi
}

pause_issue() { # message output_file
  gh label create agent-paused -R "$REPO" --color b60205 --description "자동 루프 일시중단" --force >/dev/null 2>&1 || true
  {
    echo "$1"
    echo
    echo "**재개 방법:** 원인을 해결한 뒤 이 이슈를 닫으면, Mac 러너의 다음 실행(1분 이내)부터 이어서 진행합니다."
    echo
    echo "<details><summary>Codex 출력 마지막 부분</summary>"
    echo
    echo '```'
    tail -n 30 "$2" 2>/dev/null || echo "(출력 없음)"
    echo '```'
    echo "</details>"
  } > "$TMPD/pause.md"
  gh issue create -R "$REPO" --title "자동 루프 일시중단: Codex" --label agent-paused --body-file "$TMPD/pause.md" >/dev/null && log "agent-paused 이슈를 열고 멈춤"
}

save_wip() { # task
  # 실패한 구현 실행의 변경을 wip/<작업>-<시각> 브랜치에 남긴다(강제 푸시 없음, 매번 새 이름)
  local w
  if ! commit_changes "$1: 중단된 작업 저장" && [ "$(git rev-list --count origin/develop..HEAD)" = 0 ]; then
    log "저장할 변경 없음"; return 0
  fi
  w="wip/$(echo "$1" | tr 'A-Z' 'a-z')-$(date +%Y%m%d%H%M%S)"
  if git push -q origin "HEAD:refs/heads/$w"; then log "중단 작업을 $w 에 저장함"; else log "중단 작업 저장 실패"; fi
}

commit_changes() { # message
  local f
  # 보호 경로 되돌리기
  git add -A
  # 보호 파일은 develop의 내용과 같아야 한다(develop 병합으로 들어온 변경은 유지)
  for f in $(git diff --cached --name-only | grep -E "$PROTECTED" || true); do
    if git diff --cached --quiet origin/develop -- "$f"; then continue; fi
    if git cat-file -e "origin/develop:$f" 2>/dev/null; then git checkout -q origin/develop -- "$f"; else git rm -q --cached -f -- "$f"; rm -f -- "$f"; fi
    log "보호 경로 변경을 되돌림: $f"
  done
  # lockfile 일치 보장
  if git diff --cached --name-only | grep -qx package.json; then
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 || true
    git add package-lock.json 2>/dev/null || true
  fi
  if git diff --cached --quiet && [ ! -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then return 1; fi
  git commit -q -m "$1" -m "Codex CLI 구현, Mac 러너 자동 커밋"
}

PROTECTED='^(\.github/|AGENTS\.md$|CLAUDE\.md$|docs/requirements\.md$|docs/tasks\.md$|scripts/agent/)'
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
main "$@"
