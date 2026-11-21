"""Validate the 30-to-60 expansion against the actual source and frozen hashes."""
import hashlib
import json
from pathlib import Path
import re
import sys

from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(item):
    return item["nwo"], item["pr_number"]


def golden_path(item):
    return f"golden/{item['nwo'].replace('/', '_')}_{item['pr_number']}-{item['head'][:8]}.json"


def protected(text):
    # Preserve fenced blocks byte-for-byte, including the original line endings.
    fence_re = r"(?ms)^([ \t]*)(`{3,}|~{3,})[^\r\n]*(?:\r?\n).*?^\1\2[^\r\n]*(?:\r?\n|$)"
    fences = [m.group(0) for m in re.finditer(fence_re, text)]
    return {
        "fenced_blocks": fences,
        "inline_code": re.findall(r"(?<!`)(`+)([^`\r\n]+?)\1(?!`)", text),
        "urls": re.findall(r"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s<>\[\]()`]+", text),
        "markdown_link_targets": re.findall(r"\]\(([^)\r\n]+)\)", text),
        "checklist_states": re.findall(r"(?m)^\s*[-*+]\s+\[([ xX])\]", text),
        # Japanese source may put digits immediately next to letters (22テスト).
        "numeric_tokens": re.findall(r"\d+(?:[.,]\d+)*", text),
    }


errors = []
checks = []


def require(condition, message):
    (checks if condition else errors).append(message)


manifest = read("corpus/manifest.json")
old = read("corpus/vi/pilot_30_vi.json")
new = read("corpus/vi/additional_30_vi.json")
combined = read("corpus/vi/pilot_60_vi.json")
schema = read("schema/corpus-manifest.schema.json")
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
for name, items in [("source", manifest), ("pilot_30", old), ("additional_30", new), ("pilot_60", combined)]:
    schema_errors = sorted(validator.iter_errors(items), key=lambda e: str(e.path))
    require(not schema_errors, f"{name}: valid JSON and source schema")
    errors.extend(f"{name}: {e.json_path}: {e.message}" for e in schema_errors)

source = {identity(x): x for x in manifest}
old_ids = [identity(x) for x in old]
new_ids = [identity(x) for x in new]
all_ids = [identity(x) for x in combined]
require(len(manifest) == len(source), "source: unique PR identities")
require(len(old) == 30 and len(new) == 30 and len(combined) == 60, "counts: 30 original, 30 additional, 60 combined")
require(not set(old_ids) & set(new_ids), "no overlap with pilot_30")
require(len(new_ids) == len(set(new_ids)), "additional_30: no duplicate PR")
require(len(all_ids) == len(set(all_ids)), "pilot_60: no duplicate PR")
require(combined == old + new, "pilot_60: exact original 30 followed by exact new 30")
selected = read("corpus/vi/expansion_60_evidence/selection.json")["indices_zero_based"]
require(new_ids == [identity(manifest[i]) for i in selected], "additional_30: selected source order preserved")
remaining = [item for item in manifest if identity(item) not in set(old_ids)]
missing_golden = [golden_path(item) for item in remaining if not (ROOT / golden_path(item)).is_file()]
require(len(remaining) == 189, "full source minus original pilot leaves 189 candidates")
require(not missing_golden, "all 189 remaining candidates have corresponding Golden files")
require(all(identity(item) in source and
            {k: v for k, v in item.items() if k not in ("title", "body")} ==
            {k: v for k, v in source[identity(item)].items() if k not in ("title", "body")}
            for item in old), "all original 30 also retain exact source non-title/body metadata")

baseline = read("corpus/vi/expansion_60_evidence/baseline.json")
changed = [p for p, expected in baseline.items() if not (ROOT / p).is_file() or digest(ROOT / p) != expected]
require(not changed, "all baseline hashes unchanged: pilot_30, manifest, schema, Golden, scripts and adapters")
errors.extend("protected file changed: " + p for p in changed)
golden_original_paths = {p for p in baseline if p.startswith("golden/")}
golden_current_paths = {p.relative_to(ROOT).as_posix() for p in (ROOT / "golden").rglob("*") if p.is_file()}
require(golden_current_paths == golden_original_paths, "Golden file set unchanged")

per_item = []
for i, item in enumerate(new):
    key = identity(item)
    original = source.get(key)
    if original is None:
        errors.append(f"{key}: not in source manifest")
        continue
    metadata_equal = ({k: v for k, v in item.items() if k not in ("title", "body")} ==
                      {k: v for k, v in original.items() if k not in ("title", "body")})
    require(set(item) == set(original) and metadata_equal, f"{key}: only title/body may differ; all 13 source fields retained")
    require(item["repo"] == "https://github.com/" + item["nwo"], f"{key}: repo matches nwo")
    require(item["pr_url"] == f"{item['repo']}/pull/{item['pr_number']}", f"{key}: PR URL matches identity")
    title_ok = item["title"] != original["title"] or bool(re.fullmatch(r"v?\d+(?:\.\d+)+", original["title"]))
    require(title_ok, f"{key}: title translated or technical-only release version retained")
    require(item["body"] != original["body"], f"{key}: body translated")
    protected_checks = {}
    for field in ("title", "body"):
        before = protected(original[field])
        after = protected(item[field])
        for kind in before:
            equal = before[kind] == after[kind]
            protected_checks[f"{field}.{kind}"] = equal
            require(equal, f"{key} {field}: {kind} preserved in order")
            if not equal:
                errors.append(f"{key} {field}.{kind}: source={before[kind]!r}; vi={after[kind]!r}")
    gp = golden_path(original)
    exists = (ROOT / gp).is_file()
    require(exists, f"{key}: matching Golden exists")
    golden_ok = False
    if exists:
        golden = read(gp)
        pr = golden.get("pr", {})
        golden_ok = all(pr.get(k) == original[k] for k in ("repo", "pr_number", "base", "head"))
        require(golden_ok, f"{key}: Golden PR identity matches original base/head/repo/number")
        require(digest(ROOT / gp) == baseline[gp], f"{key}: Golden SHA-256 unchanged")
    per_item.append({"manifest_index": selected[i], "nwo": item["nwo"], "pr_number": item["pr_number"],
                     "source_manifest": "corpus/manifest.json", "source_pr": item["pr_url"],
                     "metadata_unchanged": metadata_equal, "golden": gp,
                     "golden_identity_matches": golden_ok, "protected_content": protected_checks})

sources_path = HERE / "pr_sources.json"
if sources_path.exists():
    sources = read("corpus/vi/expansion_60_evidence/pr_sources.json")
    require(len(sources["tasks"]) == 30 and all(x["verified"] for x in sources["tasks"]), "30 public PR source URLs verified by HTTP 200")
    require([(x["nwo"], x["pr_number"]) for x in sources["tasks"]] == new_ids, "public PR verification matches selected 30")
    require(all(re.fullmatch(r"https://github\.com/[^/]+/[^/]+/pull/" + str(x["pr_number"]), x.get("resolved_url", ""))
                for x in sources["tasks"]), "all public PR redirects still resolve to the same PR number")
else:
    errors.append("PR source verification evidence is missing")

review_path = HERE / "translation_review.json"
if review_path.exists():
    reviews = read("corpus/vi/expansion_60_evidence/translation_review.json")
    require(len(reviews) == 30 and [(x["nwo"], x["pr_number"]) for x in reviews] == new_ids,
            "30 semantic translation reviews correspond to the selected PRs")
    for item, review in zip(new, reviews):
        require(review.get("result") == "pass" and review.get("translated_sha256") ==
                hashlib.sha256(json.dumps({k: item[k] for k in ("title", "body")}, ensure_ascii=False,
                                          separators=(",", ":")).encode("utf-8")).hexdigest(),
                f"{identity(item)}: semantic review bound to final title/body hash")
else:
    errors.append("Semantic translation review evidence is missing")

dry_run_path = HERE / "dry_run.json"
if dry_run_path.exists():
    dry = read("corpus/vi/expansion_60_evidence/dry_run.json")
    require(dry.get("manifest_sha256_before") == dry.get("manifest_sha256_after") == digest(ROOT / "corpus/vi/additional_30_vi.json"),
            "dry-run input manifest unchanged throughout run and matches delivered file hash")
    require(dry.get("log_sha256") == digest(HERE / "dry_run.log"), "raw dry-run log matches its recorded SHA-256")
    require(dry.get("exit_code") == 0 and dry.get("passed") == 30 and dry.get("failed") == 0,
            "requested Bash dry-run: exit 0, passed 30, failed 0")
    require(len(dry["tasks"]) == 30 and [(x["nwo"], x["pr_number"]) for x in dry["tasks"]] == new_ids,
            "dry-run processed exactly the selected 30 PRs in order")
    for task, item in zip(dry["tasks"], new):
        require(task.get("passed") is True and task.get("head") == item["head"] and
                task.get("base") == item["base"] and task.get("diff_bytes", 0) > 0,
                f"{identity(item)}: real base/head available, HEAD exact, nonempty diff prepared")
    require(dry.get("model_run") is False and dry.get("api_keys_used") is False,
            "dry-run did not run Docker/model or use API keys")
    log = (HERE / "dry_run.log").read_text(encoding="utf-8")
    require(len(re.findall(r"^   prepared: HEAD=", log, flags=re.MULTILINE)) == 30 and
            re.search(r"^passed 30, failed 0;", log, flags=re.MULTILINE) is not None,
            "raw runner log independently contains all 30 prepared records and success summary")
else:
    errors.append("Completed Bash dry-run evidence is missing")

output = {"status": "pass" if not errors else "fail", "passed_checks": len(checks),
          "failed_checks": len(errors), "counts": {"source": len(manifest), "old": len(old), "new": len(new), "combined": len(combined)},
          "selection_audit": {"remaining_after_pilot": len(remaining), "remaining_with_golden": len(remaining) - len(missing_golden),
                              "missing_golden": missing_golden},
          "output_sha256": {p: digest(ROOT / p) for p in ("corpus/vi/additional_30_vi.json", "corpus/vi/pilot_60_vi.json")},
          "checks": checks, "errors": errors, "tasks": per_item}
(HERE / "validation.json").write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{output['status'].upper()}: {len(checks)} checks passed; {len(errors)} failed")
for error in errors:
    print(error)
sys.exit(0 if not errors else 1)
