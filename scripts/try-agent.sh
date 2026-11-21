#!/usr/bin/env bash
#
# Runs your agent image on the test set (or the full set) exactly the way the
# benchmark does: one fresh container per pull request, the same mounts and
# variables, and the same checks on the findings file. It does not score; a
# test run in the portal does that.
#
#   scripts/try-agent.sh <image> [--set test|full | --manifest PATH] [--pr <index>] [--dry-run] [-e NAME[=VALUE] ...]
#
#   scripts/try-agent.sh my-reviewer:dev --pr 0
#   scripts/try-agent.sh my-reviewer:dev -e OPENAI_API_KEY -e RB_CONFIG_MODEL=gpt-5.5
#   scripts/try-agent.sh my-reviewer:dev --set full -e OPENAI_API_KEY
#   scripts/try-agent.sh codex-cli-vi:dev --manifest corpus/vi/test_vi.json --pr 0
#
# --set test (the default) runs the 25 pull requests in corpus/test/test.json.
# --set full runs the full set of 219 in corpus/manifest.json.
# --manifest selects another JSON task manifest; use it instead of --set.
# --pr is a zero-based index. --dry-run fetches and prepares the checkout and
# PR metadata without starting Docker or a model.
#
# Needs docker, git and jq. Findings land in ./findings/<pr key>.json.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/try-agent.sh <image> [--set test|full | --manifest PATH] [--pr <index>] [--dry-run] [-e NAME[=VALUE] ...]

Choose one task set: --set test|full or --manifest PATH. --pr is a zero-based
index. -e passes an environment variable into the container.
USAGE
  exit 2
}
[ $# -ge 1 ] || usage
image="$1"; shift
only=""
set_name=test
set_was_set=0
manifest_arg=""
dry_run=0
env_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    # Each option takes a value; without one, show the usage instead of an unbound-variable error.
    --set) [ $# -ge 2 ] || usage; set_name="$2"; set_was_set=1; shift 2 ;;
    --manifest) [ $# -ge 2 ] || usage; manifest_arg="$2"; shift 2 ;;
    --pr) [ $# -ge 2 ] || usage; only="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -e) [ $# -ge 2 ] || usage; env_args+=(-e "$2"); shift 2 ;;
    *) usage ;;
  esac
done

here="$(cd "$(dirname "$0")/.." && pwd)"
source "$here/scripts/lib/reviewbench-audit.sh"
if [ -n "$manifest_arg" ]; then
  [ "$set_was_set" -eq 0 ] || usage
  if [[ "$manifest_arg" = /* ]]; then manifest="$manifest_arg"; else manifest="$PWD/$manifest_arg"; fi
else
  case "$set_name" in
    test) manifest="$here/corpus/test/test.json" ;;
    full) manifest="$here/corpus/manifest.json" ;;
    *) usage ;;
  esac
fi
[ -f "$manifest" ] || { echo "manifest not found: $manifest" >&2; exit 2; }
if [ -n "$only" ] && [[ ! "$only" =~ ^[0-9]+$ ]]; then usage; fi
work="${TRY_AGENT_WORK:-$PWD/.try-agent}"
out_dir="${TRY_AGENT_OUT:-$PWD/findings}"
audit_root="${TRY_AGENT_AUDIT:-$PWD/audit}"
mkdir -p "$work/runs" "$out_dir" "$audit_root"
run_work="$(mktemp -d "$work/runs/.run.XXXXXX")"
run_id="${run_work##*/}"
trap 'rm -rf -- "$run_work"' EXIT
mkdir -p "$run_work/repos" "$run_work/pr" "$run_work/out"
mirror_org="${MIRROR_ORG:-review-bench}"

has_commits() {
  local dir="$1"; shift
  local sha
  for sha in "$@"; do
    GIT_NO_LAZY_FETCH=1 git -C "$dir" cat-file -e "$sha^{commit}" 2>/dev/null || return 1
  done
}

count=$(jq length "$manifest")
indices=$(if [ -n "$only" ]; then echo "$only"; else seq 0 $((count - 1)); fi)
passed=0; failed=0

for i in $indices; do
  entry=$(jq -c ".[$i]" "$manifest")
  if [ "$entry" = "null" ]; then
    echo "   FAIL: manifest has no task at index $i" >&2; failed=$((failed + 1)); continue
  fi
  nwo=$(jq -r .nwo <<<"$entry"); pr=$(jq -r .pr_number <<<"$entry")
  base=$(jq -r .base <<<"$entry"); head=$(jq -r .head <<<"$entry")
  key="${nwo/\//_}_${pr}-${head:0:8}"
  repo="$run_work/repos/${nwo/\//_}"
  echo "== [$i] $nwo#$pr ($key)" >&2

  # A checkout at head with base reachable, like the one the benchmark mounts.
  # Fetch from the review-bench mirror (the snapshot the judge also uses), and
  # only fall back to upstream if the mirror lacks a commit. Upstream repos can
  # be deleted or force-pushed, so the mirror is the source of truth.
  if [ ! -d "$repo/.git" ]; then
    git init -q "$repo"
  fi
  # origin is the mirror, as in the benchmark's checkout; reset it on caches made by older versions.
  git -C "$repo" remote remove origin 2>/dev/null || true
  git -C "$repo" remote remove upstream 2>/dev/null || true
  git -C "$repo" remote add origin "https://github.com/$mirror_org/${nwo/\//_}.git"
  git -C "$repo" remote add upstream "https://github.com/$nwo.git"
  if ! has_commits "$repo" "$base" "$head"; then
    GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" fetch -q --filter=blob:none origin "$base" "$head" 2>/dev/null || true
  fi
  if ! has_commits "$repo" "$base" "$head"; then
    echo "   mirror $mirror_org/${nwo/\//_} lacks $base or $head; trying upstream" >&2
    GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" fetch -q --filter=blob:none upstream "$base" "pull/$pr/head" 2>/dev/null \
      || GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" fetch -q --filter=blob:none upstream "$base" "$head" 2>/dev/null || true
  fi
  if ! has_commits "$repo" "$base" "$head"; then
    echo "   FAIL: could not fetch base $base and head $head" >&2; failed=$((failed + 1)); continue
  fi
  GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" checkout -q --force --detach "$head"
  git -C "$repo" clean -qfdx
  checked_out=$(git -C "$repo" rev-parse HEAD)
  if [ "$checked_out" != "$head" ]; then
    echo "   FAIL: checkout is $checked_out, expected $head" >&2; failed=$((failed + 1)); continue
  fi

  pr_dir="$run_work/pr/$key"; out="$run_work/out/$key"
  mkdir -p "$pr_dir" "$out"
  git -C "$repo" diff "$base...$head" > "$pr_dir/diff.patch"
  jq '{repo, pr_number: (.pr_number | tonumber), base, head, nwo, title, body}' <<<"$entry" > "$pr_dir/pr.json"

  if ! jq -e --arg base "$base" --arg head "$head" --arg nwo "$nwo" --argjson pr "$pr" \
    '.base == $base and .head == $head and .nwo == $nwo and .pr_number == $pr and (.title | type) == "string" and (.body | type) == "string"' \
    "$pr_dir/pr.json" >/dev/null; then
    echo "   FAIL: generated PR metadata does not match the selected manifest entry" >&2; failed=$((failed + 1)); continue
  fi

  if [ "$dry_run" -eq 1 ]; then
    diff_bytes=$(wc -c < "$pr_dir/diff.patch" | tr -d ' ')
    echo "   prepared: HEAD=$checked_out base=$base diff=${diff_bytes}B; PR title/body are in pr.json (Docker and model API not run)" >&2
    passed=$((passed + 1)); continue
  fi

  task_audit_root="$audit_root/$key"
  mkdir -p "$task_audit_root"
  audit_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  audit_dir=$(mktemp -d "$task_audit_root/run.$audit_timestamp.XXXXXX")
  audit_run_id="${audit_dir##*/}"
  audit_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  status=0
  docker run --rm --platform linux/amd64 \
    -v "$repo:/work/repo" -v "$pr_dir:/work/pr:ro" -v "$out:/work/out" \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    -e RB_NWO="$nwo" -e RB_PR_NUMBER="$pr" -e RB_BASE="$base" -e RB_HEAD="$head" \
    -e RB_AGENT=try-agent -e RB_REPO=/work/repo \
    -e RB_DIFF=/work/pr/diff.patch -e RB_PR_JSON=/work/pr/pr.json -e RB_OUT=/work/out/findings.json \
    -e RB_AUDIT_DIR=/work/out/audit -e RB_AUDIT_RUN_ID="$audit_run_id" \
    -e RB_ATTEMPT=1 \
    ${env_args[@]+"${env_args[@]}"} "$image" || status=$?
  container_status=$status

  archive_status=none
  archive_failed=0
  if ! archive_reviewbench_audit "$out/audit" "$audit_dir"; then
    archive_status=failed
    archive_failed=1
    status=1
  fi
  archived_files='[]'
  for artifact in metadata.json codex-response.json findings.json; do
    if [ -f "$audit_dir/$artifact" ] && [ ! -L "$audit_dir/$artifact" ]; then
      archived_files=$(jq --arg artifact "$artifact" '. + [$artifact]' <<<"$archived_files")
    fi
  done
  artifact_count=$(jq 'length' <<<"$archived_files")
  if [ "$archive_failed" -eq 0 ]; then
    if [ "$artifact_count" -gt 0 ]; then archive_status=partial; fi
    if [ "$artifact_count" -eq 3 ]; then archive_status=complete; fi
  fi
  audit_finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [ "$status" -eq 0 ] && ! jq -e '(. | index("metadata.json")) and (. | index("codex-response.json")) and (. | index("findings.json"))' <<<"$archived_files" >/dev/null; then
    archive_status=incomplete
    if [ "${RB_ALLOW_INCOMPLETE_AUDIT:-0}" = "1" ]; then
      echo "   WARN: legacy adapter without full audit" >&2
    else
      status=1
    fi
  fi
  runner_result=completed
  if [ "$status" -ne 0 ]; then runner_result=failed; fi
  jq -n \
    --arg run_id "$audit_run_id" --arg started_at "$audit_started_at" --arg finished_at "$audit_finished_at" \
    --arg nwo "$nwo" --argjson pr_number "$pr" --arg base "$base" --arg head "$head" \
    --arg result "$runner_result" --arg archive_status "$archive_status" \
    --argjson container_exit_code "$container_status" --argjson artifacts "$archived_files" \
    '{schema_version:1,run_id:$run_id,started_at:$started_at,finished_at:$finished_at,task:{nwo:$nwo,pr_number:$pr_number,base:$base,head:$head},result:$result,audit_archive:$archive_status,container_exit_code:$container_exit_code,artifacts:$artifacts}' \
    > "$audit_dir/runner.json"
  chmod 600 "$audit_dir/runner.json"
  echo "   audit: $audit_dir (artifacts: $(jq -r 'join(", ")' <<<"$archived_files"))" >&2

  file="$out/findings.json"
  if [ "$status" -ne 0 ]; then
    echo "   FAIL: exit code $status" >&2; failed=$((failed + 1)); continue
  fi
  if ! jq -e . "$file" >/dev/null 2>&1; then
    echo "   FAIL: no valid JSON at RB_OUT" >&2; failed=$((failed + 1)); continue
  fi
  problem=$(jq -r --arg head "$head" --argjson pr "$pr" '
    if .pr.head != $head then "pr.head is not RB_HEAD"
    elif (.pr.pr_number | tonumber? // null) != $pr then "pr.pr_number is not RB_PR_NUMBER"
    elif (.findings | type) != "array" then "findings is not an array"
    else ([.findings[] | select((.file | type) != "string" or (.start_line | type) != "number" or (.end_line | type) != "number" or (.message | type) != "string" or (.file | startswith("./") or startswith("/")))] | length) as $bad
      | if $bad > 0 then "\($bad) finding(s) miss file, start_line, end_line or message, or use a ./ or / path" else "" end
    end' "$file")
  if [ -n "$problem" ]; then
    echo "   FAIL: $problem" >&2; failed=$((failed + 1)); continue
  fi
  destination="$out_dir/$key.json"
  if [ -e "$destination" ]; then
    destination="$out_dir/$key.$run_id.json"
    suffix=1
    while [ -e "$destination" ]; do
      suffix=$((suffix + 1))
      destination="$out_dir/$key.$run_id-$suffix.json"
    done
  fi
  cp "$file" "$destination"
  echo "   ok: $(jq '.findings | length' "$file") finding(s); saved to $destination" >&2
  passed=$((passed + 1))
done

echo "passed $passed, failed $failed; findings in $out_dir" >&2
[ "$failed" -eq 0 ]
