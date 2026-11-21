import { createHash, randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuditMetadata({ pr, runId, diff, prompt, model, effort, language }) {
  const diffBytes = Buffer.isBuffer(diff) ? diff : Buffer.from(diff);
  const promptBytes = Buffer.isBuffer(prompt) ? prompt : Buffer.from(prompt, "utf8");
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    run_id: runId || randomUUID(),
    started_at: now,
    updated_at: now,
    finished_at: null,
    pr: {
      repo: pr.repo,
      nwo: pr.nwo,
      pr_number: Number(pr.pr_number),
      base: pr.base,
      head: pr.head,
    },
    diff: { sha256: sha256(diffBytes), size_bytes: diffBytes.length },
    prompt: { sha256: sha256(promptBytes), size_bytes: promptBytes.length },
    codex: { version: null, model, reasoning_effort: effort || null },
    review_language: language,
    status: "preflight_pending",
    raw_response: null,
    raw_response_status: "not_available",
    parser: { status: "not_started", error: null },
    findings: null,
    error: null,
  };
}

export function persistRawResponse(auditDir, rawBytes, env = process.env) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  assertNoCredentials(raw, env);
  const file = "codex-response.json";
  writeFileSync(join(auditDir, file), raw, { flag: "wx", mode: 0o644 });
  return { file, sha256: sha256(raw), size_bytes: raw.length };
}

export function writeAuditMetadata(path, metadata, { exclusive = false } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (exclusive) {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
    return;
  }

  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o644 });
    renameSync(temporaryPath, path);
  } finally {
    try { unlinkSync(temporaryPath); } catch { /* rename consumed it or cleanup is best effort */ }
  }
}

export function assertNoCredentials(rawBytes, env = process.env) {
  const text = Buffer.isBuffer(rawBytes) ? rawBytes.toString("utf8") : String(rawBytes);
  for (const [name, value] of Object.entries(env)) {
    if (/(?:API[_-]?KEY|TOKEN|BEARER|SECRET|PASSWORD|CREDENTIAL)/i.test(name) &&
        typeof value === "string" && value.length >= 8 && text.includes(value)) {
      throw new Error("raw Codex response contains a configured credential; response withheld from audit");
    }
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(text) ||
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/.test(text)) {
    throw new Error("raw Codex response contains a credential pattern; response withheld from audit");
  }
}
