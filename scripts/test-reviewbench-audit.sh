#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
source "$here/scripts/lib/reviewbench-audit.sh"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

run_work="$tmp/.try-agent/runs/.run.fixture"
source_audit="$run_work/out/task/audit"
durable_audit="$tmp/audit/task/run.fixture"
expected="$tmp/expected"
mkdir -p "$source_audit" "$durable_audit" "$expected"
printf '{"schema_version":1,"status":"completed"}\n' > "$expected/metadata.json"
printf '{"findings":[]}\n' > "$expected/codex-response.json"
printf '{"pr":{},"agent":"fixture","findings":[]}\n' > "$expected/findings.json"
cp "$expected/metadata.json" "$source_audit/metadata.json"
cp "$expected/codex-response.json" "$source_audit/codex-response.json"
cp "$expected/findings.json" "$source_audit/findings.json"
printf 'must not be copied\n' > "$source_audit/.env"

archive_reviewbench_audit "$source_audit" "$durable_audit"
rm -rf -- "$run_work"
for name in metadata.json codex-response.json findings.json; do
  [ -f "$durable_audit/$name" ] || { echo "FAIL: $name did not survive scratch cleanup" >&2; exit 1; }
  cmp "$expected/$name" "$durable_audit/$name"
done
[ ! -e "$durable_audit/.env" ] || { echo "FAIL: unallowlisted .env was copied" >&2; exit 1; }

mkdir -p "$source_audit"
printf '{"status":"new"}\n' > "$source_audit/metadata.json"
if archive_reviewbench_audit "$source_audit" "$durable_audit" 2>/dev/null; then
  echo "FAIL: archive helper overwrote an existing audit" >&2
  exit 1
fi

echo "PASS: allowlisted raw/metadata/findings persist after scratch cleanup; unallowlisted files are excluded and prior audit is protected"
