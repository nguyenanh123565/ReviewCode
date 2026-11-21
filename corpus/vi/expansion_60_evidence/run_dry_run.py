"""Run the existing Bash runner unchanged, with no model/API credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
command = [r"C:\Program Files\Git\bin\bash.exe", "scripts/try-agent.sh", "unused-image",
           "--manifest", "corpus/vi/additional_30_vi.json", "--dry-run"]
manifest_path = ROOT / "corpus/vi/additional_30_vi.json"
manifest_sha256_before = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
environment = dict(os.environ)
for name in list(environment):
    if any(token in name.upper() for token in ("API_KEY", "AUTH_TOKEN", "ACCESS_TOKEN")) or name.upper() in (
            "GH_TOKEN", "GITHUB_TOKEN", "OPENAI_ADMIN_KEY"):
        environment.pop(name)
environment.update(GIT_TERMINAL_PROMPT="0", GIT_CONFIG_COUNT="3",
                   GIT_CONFIG_KEY_0="credential.helper", GIT_CONFIG_VALUE_0="",
                   GIT_CONFIG_KEY_1="http.extraHeader", GIT_CONFIG_VALUE_1="",
                   GIT_CONFIG_KEY_2="core.longpaths", GIT_CONFIG_VALUE_2="true")
log_path = HERE / "dry_run.log"
with log_path.open("w", encoding="utf-8", newline="") as log:
    process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    for line in process.stdout:
        log.write(line)
        log.flush()
        print(line, end="", flush=True)
    returncode = process.wait()
content = log_path.read_text(encoding="utf-8")
summary = re.search(r"^passed (\d+), failed (\d+);", content, flags=re.MULTILINE)
tasks = []
current = None
for line in content.splitlines():
    match = re.match(r"== \[(\d+)\] (.+)#(\d+) \((.+)\)", line)
    if match:
        current = {"index": int(match[1]), "nwo": match[2], "pr_number": int(match[3]), "key": match[4]}
        tasks.append(current)
    prepared = re.search(r"prepared: HEAD=([0-9a-f]{40}) base=([0-9a-f]{40}) diff=(\d+)B", line)
    if prepared and current is not None:
        current.update(head=prepared[1], base=prepared[2], diff_bytes=int(prepared[3]), passed=True)
result = {"command": command, "exit_code": returncode, "model_run": False, "api_keys_used": False,
          "manifest_sha256_before": manifest_sha256_before,
          "manifest_sha256_after": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
          "log_sha256": hashlib.sha256(log_path.read_bytes()).hexdigest(),
          "passed": int(summary[1]) if summary else None, "failed": int(summary[2]) if summary else None,
          "log": "corpus/vi/expansion_60_evidence/dry_run.log", "tasks": tasks}
(HERE / "dry_run.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
sys.exit(returncode)
