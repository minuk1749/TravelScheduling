#!/usr/bin/env bash
# Both jobs start on a fresh runner with only the workflow's own checkout and an artifact.
set -euo pipefail
[[ $ISSUE =~ ^[0-9]+$ && ( -z $PR || $PR =~ ^[0-9]+$ ) ]] || exit 1
[[ $GITHUB_RUN_NUMBER =~ ^[0-9]+$ && $ATTEMPT =~ ^[0-9]+$ && $GITHUB_SHA =~ ^[0-9a-f]{40}$ ]] || exit 1
target=new
if [[ -n $PR ]]; then target=pr$PR; fi
[[ $WIP =~ ^wip/claude/(t[0-9]+[a-z]?|r[0-9]+)-$ISSUE/$target/$GITHUB_RUN_NUMBER\.$ATTEMPT-([0-9a-f]{40})$ ]] || exit 1
task=${BASH_REMATCH[1]}
base=${BASH_REMATCH[2]}
control="$PWD/control"
bundle="$RUNNER_TEMP/archive/claude-wip.bundle"
[[ -f $bundle && ! -L $bundle ]] || exit 1
store="$RUNNER_TEMP/candidate.git"
git init -q --bare --template='' "$store"
git -C "$store" -c fetch.fsckObjects=true fetch -q --no-tags "$bundle" "refs/heads/$WIP"
commit=$(git -C "$store" rev-parse --verify 'FETCH_HEAD^{commit}')
git -C "$store" merge-base --is-ancestor "$base" "$commit"
git -C "$store" merge-base --is-ancestor "$GITHUB_SHA" "$commit"
if [[ -z $PR ]]; then git -C "$store" merge-base --is-ancestor "$base" "$GITHUB_SHA"; fi
# The fetched branch may contain merges. Check the full final tree against the trusted dispatch commit.
git -C "$store" diff --quiet --no-ext-diff "$GITHUB_SHA" "$commit" -- \
  .github .claude AGENTS.md CLAUDE.md docs/requirements.md docs/tasks.md scripts/agent

case "$1" in
  verify)
    source_dir="$RUNNER_TEMP/source"
    mkdir "$source_dir"
    tree=$(git -C "$store" rev-parse "$commit^{tree}")
    # checkout-index includes tracked files even when attributes specify export-ignore.
    export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
    git -C "$source_dir" --git-dir="$store" --work-tree=. read-tree "$tree"
    git -C "$source_dir" --git-dir="$store" --work-tree=. checkout-index --all
    network=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$PG_SERVICE")
    stop_token=$(cat /proc/sys/kernel/random/uuid)
    echo "::stop-commands::$stop_token"
    trap 'echo "::$stop_token::"' EXIT
    docker run --rm --network "$network" \
      -e DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app -e "CANDIDATE_TREE=$tree" \
      -v "$source_dir:/source:ro" -v "$control/.github/agent/check-required.sh:/check-required.sh:ro" \
      -w /candidate node:24-bookworm bash -ec \
      'cp -a --no-preserve=ownership /source/. . && git init -q && git add -f -A && test "$(git write-tree)" = "$CANDIDATE_TREE" && bash /check-required.sh --e2e'
    echo "commit=$commit" >> "$GITHUB_OUTPUT"
    ;;
  publish)
    [[ $VERIFIED_COMMIT =~ ^[0-9a-f]{40}$ && $commit == "$VERIFIED_COMMIT" ]] || { echo "검증한 커밋과 번들이 다릅니다." >&2; exit 1; }
    # This runner never checks out the candidate and runs only the pinned control checkout.
    source "$control/.github/agent/claude-publish.sh"
    ;;
  *) exit 2 ;;
esac
