#!/usr/bin/env bash
# agent-claude.yml과 같은 커밋에서 실행한다. 후보 작업 트리에 저장소 쓰기 토큰을 주지 않는다.
set -euo pipefail
[[ $ID =~ ^(T[0-9]+[A-Z]?|R[0-9]+)$ && $ISSUE =~ ^[0-9]+$ && ( -z $PR || $PR =~ ^[0-9]+$ ) ]] || exit 1
task=$(tr 'A-Z' 'a-z' <<< "$ID")
target=new
if [[ -n $PR ]]; then target="pr$PR"; fi
scope="wip/claude/$task-$ISSUE/$target"

case "$1" in
  restore)
    base=$(git rev-parse HEAD)
    if [[ -n $PR ]]; then [[ $base == "$HEAD_SHA" ]] || exit 1; fi
    wip=""
    refs=$(git for-each-ref --sort=-version:refname --format='%(refname:strip=3)' "refs/remotes/origin/$scope/")
    while IFS= read -r ref; do
      [[ ${ref#"$scope/"} =~ ^[0-9]+\.[0-9]+-([0-9a-f]{40})$ ]] || continue
      original=${BASH_REMATCH[1]}
      if [[ -n $PR && $original != "$HEAD_SHA" ]]; then continue; fi
      git merge-base --is-ancestor "$original" "refs/remotes/origin/$ref" || continue
      wip=$ref
      base=$original
      break
    done <<< "$refs"

    # 예전 신규 작업의 숫자형 WIP만 호환한다. 예전 PR WIP에는 원래 HEAD 기록이 없다.
    if [[ -z $wip && -z $PR ]]; then
      refs=$(git for-each-ref --sort=-version:refname --format='%(refname:strip=3)' "refs/remotes/origin/wip/$task-[0-9]*")
      for ref in $refs; do
        if [[ $ref =~ ^wip/$task-[0-9]+$ ]]; then wip=$ref; break; fi
      done
    fi
    if [[ -n $wip ]]; then
      git checkout -q --detach "refs/remotes/origin/$wip"
      echo "::notice::$wip 에서 재개합니다. 게시 전에 필수 검사를 다시 실행합니다."
    fi
    printf 'base=%s\nwip=%s\n' "$base" "$wip" >> "$GITHUB_OUTPUT"
    ;;
  candidate|bundle)
    [[ $BASE_SHA =~ ^[0-9a-f]{40}$ && $GITHUB_RUN_NUMBER =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 1
    git add -A
    bash .ctl/.github/agent/stage-work.sh "$GITHUB_SHA"
    if [[ $1 == candidate ]]; then
      subject="$ID: $TITLE (round $ROUND)"
      # 게시 잡에 실행 로그 경로를 전달하지 않고, 설명만 일반 텍스트로 전달한다.
      msg=""
      if [[ -n ${EXEC_FILE:-} && -f $EXEC_FILE ]]; then
        msg=$(jq -r 'if type=="array" then (map(select(.type=="result")) | last | .result) else .result end
                     | (. // "") | tostring | .[:14000]' "$EXEC_FILE" 2>/dev/null || true)
      fi
      printf '%s\n\n---\n작업 이슈: #%s · 구현: Claude · 리뷰: Codex\n' "${msg:-(최종 메시지 없음)}" "$ISSUE" > "$RUNNER_TEMP/claude-report.md"
    else
      subject="$ID: 작업 중단 (실행 $GITHUB_RUN_NUMBER.$GITHUB_RUN_ATTEMPT)"
    fi
    if ! git diff --cached --quiet || [[ -f .git/MERGE_HEAD ]]; then
      git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
        -c core.hooksPath=/dev/null commit -qm "$subject"
    fi
    git merge-base --is-ancestor "$BASE_SHA" HEAD
    if [[ $1 == bundle && $(git rev-parse HEAD) == "$BASE_SHA" ]]; then exit 0; fi
    wip="$scope/$GITHUB_RUN_NUMBER.$GITHUB_RUN_ATTEMPT-$BASE_SHA"
    git update-ref "refs/heads/$wip" HEAD
    git bundle create "$RUNNER_TEMP/claude-wip.bundle" "refs/heads/$wip"
    echo "wip=$wip" >> "$GITHUB_OUTPUT"
    ;;
  *) exit 2 ;;
esac
