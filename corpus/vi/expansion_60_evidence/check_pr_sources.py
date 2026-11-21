"""Verify public PR URLs without credentials; record redirects without changing snapshots."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
manifest = json.loads((ROOT / "corpus/manifest.json").read_text(encoding="utf-8"))
selection = json.loads((HERE / "selection.json").read_text(encoding="utf-8"))
previous_path = HERE / "pr_sources.json"
previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.exists() else {}
cached = {(x["nwo"], x["pr_number"]): dict(x, checked_at_utc=x.get("checked_at_utc", previous.get("checked_at_utc")))
          for x in previous.get("tasks", []) if x.get("verified")}


def check(index):
    item = manifest[index]
    prior = cached.get((item["nwo"], item["pr_number"]))
    if prior and prior["source_url"] == item["pr_url"]:
        return prior
    result = {"manifest_index": index, "nwo": item["nwo"],
              "pr_number": item["pr_number"], "source_url": item["pr_url"],
              "checked_at_utc": datetime.now(timezone.utc).isoformat()}
    request = urllib.request.Request(item["pr_url"], method="HEAD", headers={
        "User-Agent": "ReviewBench-VI-source-verification"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result.update(http_status=response.status, resolved_url=response.url,
                          verified=response.status == 200)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        result.update(verified=False, error=str(error))
        if isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
            # Windows curl uses the Windows certificate store. Keep verification enabled.
            curl = subprocess.run(["curl.exe", "--head", "--location", "--silent", "--show-error",
                                   "--max-time", "45", "--output", os.devnull,
                                   "--write-out", "%{http_code}\n%{url_effective}", item["pr_url"]],
                                  capture_output=True, text=True, timeout=50)
            if curl.returncode == 0:
                status, resolved = curl.stdout.split("\n", 1)
                result.update(http_status=int(status), resolved_url=resolved,
                              verified=int(status) == 200, transport="Windows curl with certificate verification")
                result["python_tls_error"] = result.pop("error")
            else:
                result["curl_error"] = curl.stderr.strip()
    if result.get("verified") and not re.fullmatch(
            r"https://github\.com/[^/]+/[^/]+/pull/" + str(item["pr_number"]), result.get("resolved_url", "")):
        result.update(verified=False, error="Resolved URL does not identify the expected pull request")
    return result


with ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(check, selection["indices_zero_based"]))
output = {"checked_at_utc": datetime.now(timezone.utc).isoformat(),
          "method": "Unauthenticated HTTPS HEAD; no API key or authorization header",
          "passed": sum(r["verified"] for r in results), "tasks": results}
(HERE / "pr_sources.json").write_text(
    json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"PR source URLs: {output['passed']}/{len(results)} verified")
for result in results:
    print(json.dumps(result, ensure_ascii=True))
raise SystemExit(0 if all(r["verified"] for r in results) else 1)
