// ReviewBench-VI adapter: generic `codex exec`, with the verified diff kept on disk.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuditMetadata, persistRawResponse, sha256, writeAuditMetadata } from "./audit.mjs";
import { assertGenericExecInvocation, assertReviewInputTransport, runCodexPreflight } from "./cli-preflight.mjs";
import { sanitizeDiagnostic } from "./diagnostic.mjs";
import { readAndVerifyDiff } from "./diff.mjs";
import { buildCodexInvocation, buildFindingsDocument, buildReviewPrompt } from "./prompt.mjs";
import { parseReview } from "./parse.mjs";

class AgentError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

try {
  await main();
} catch (error) {
  const code = error instanceof AgentError ? error.exitCode : 1;
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`agent: ${sanitizeDiagnostic(message, process.env)}`);
  process.exitCode = code;
}

async function main() {
  const env = process.env;
  for (const name of ["RB_NWO", "RB_PR_NUMBER", "RB_BASE", "RB_HEAD", "RB_DIFF", "RB_OUT"]) {
    if (!env[name]) throw new AgentError(`missing required environment variable ${name}`, 2);
  }
  if (!env.OPENAI_API_KEY) {
    throw new AgentError("OPENAI_API_KEY is not set; provide it through the declared runtime secret", 2);
  }
  if (!/^[0-9a-f]{40}$/i.test(env.RB_BASE) || !/^[0-9a-f]{40}$/i.test(env.RB_HEAD)) {
    throw new AgentError("RB_BASE and RB_HEAD must be full 40-character commit SHAs", 2);
  }
  if (!/^\d+$/.test(env.RB_PR_NUMBER) || Number(env.RB_PR_NUMBER) < 1) {
    throw new AgentError("RB_PR_NUMBER must be a positive integer", 2);
  }

  const repo = env.RB_REPO ?? "/work/repo";
  const prPath = env.RB_PR_JSON ?? "/work/pr/pr.json";
  const agent = env.RB_AGENT ?? "codex-cli-vi";
  const model = env.RB_CONFIG_MODEL ?? "gpt-5.5";
  const effort = env.RB_CONFIG_EFFORT ?? env.RB_CONFIG_REASONING ?? "";
  const language = env.RB_CONFIG_REVIEW_LANGUAGE ?? "vi";
  const baseUrl = env.RB_MODEL_BASE_URL || "https://api.openai.com/v1";

  let pr;
  try {
    pr = JSON.parse(readFileSync(prPath, "utf8"));
  } catch {
    throw new AgentError("could not read PR metadata JSON", 2);
  }
  if (
    pr.nwo !== env.RB_NWO ||
    Number(pr.pr_number) !== Number(env.RB_PR_NUMBER) ||
    pr.base !== env.RB_BASE ||
    pr.head !== env.RB_HEAD ||
    typeof pr.repo !== "string" ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(pr.repo) ||
    typeof pr.title !== "string" ||
    typeof pr.body !== "string" ||
    !existsSync(env.RB_DIFF)
  ) {
    throw new AgentError("PR metadata or diff does not match the runner environment", 2);
  }
  if (existsSync(env.RB_OUT)) {
    throw new AgentError("RB_OUT already exists; refusing to overwrite findings", 2);
  }
  if (language !== "en" && language !== "vi") {
    throw new AgentError("RB_CONFIG_REVIEW_LANGUAGE must be 'en' or 'vi'", 2);
  }

  const headCheck = await run("git", ["rev-parse", "HEAD"], { cwd: repo, env });
  if (headCheck.status !== 0 || headCheck.stdout.trim() !== env.RB_HEAD) {
    throw new AgentError("repository HEAD does not match RB_HEAD", 2);
  }
  const baseCheck = await run("git", ["cat-file", "-e", `${env.RB_BASE}^{commit}`], { cwd: repo, env });
  if (baseCheck.status !== 0) {
    throw new AgentError("RB_BASE is not available in the checked-out repository", 2);
  }

  let diff;
  try {
    diff = readAndVerifyDiff({ diffPath: env.RB_DIFF, repo, base: env.RB_BASE, head: env.RB_HEAD, env });
  } catch (error) {
    throw new AgentError(error instanceof Error ? error.message : "could not verify RB_DIFF", 2);
  }

  const prompt = buildReviewPrompt(pr, language, env.RB_DIFF);
  const auditDir = env.RB_AUDIT_DIR || join(dirname(env.RB_OUT), "audit");
  const metadataPath = join(auditDir, "metadata.json");
  mkdirSync(auditDir, { recursive: true, mode: 0o755 });
  const audit = createAuditMetadata({
    pr,
    runId: env.RB_AUDIT_RUN_ID,
    diff,
    prompt,
    model,
    effort,
    language,
  });
  writeAuditMetadata(metadataPath, audit, { exclusive: true });
  const updateAudit = (updates) => {
    Object.assign(audit, updates, { updated_at: new Date().toISOString() });
    writeAuditMetadata(metadataPath, audit);
  };

  const schemaPath = fileURLToPath(new URL("./review-response.schema.json", import.meta.url));
  const codexHome = mkdtempSync(join(tmpdir(), "reviewbench-codex-home-"));
  const responsePath = join(codexHome, "last-message.json");
  writeFileSync(join(codexHome, "config.toml"), [
    `model = ${JSON.stringify(model)}`,
    `model_provider = "openai_api_key"`,
    "",
    "[model_providers.openai_api_key]",
    'name = "OpenAI"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n"));

  try {
    const invocation = buildCodexInvocation({
      model,
      effort,
      prompt,
      responsePath,
      schemaPath,
      repo,
      diffPath: env.RB_DIFF,
    });
    const childEnv = { ...env, CODEX_HOME: codexHome };
    assertGenericExecInvocation(invocation.args);
    assertReviewInputTransport(invocation, { prompt, diffPath: env.RB_DIFF });
    let cli;
    try {
      cli = runCodexPreflight({ env: childEnv, cwd: repo });
      updateAudit({ codex: { ...audit.codex, version: cli.version }, status: "ready" });
    } catch (error) {
      updateAudit({
        status: "preflight_failed",
        finished_at: new Date().toISOString(),
        error: sanitizeDiagnostic(error instanceof Error ? error.message : "Codex CLI preflight failed", env),
      });
      throw error;
    }
    console.error(`agent: Codex CLI syntax preflight passed (${cli.version}); no model request made by preflight`);
    console.error(`agent: reviewing ${env.RB_NWO}#${env.RB_PR_NUMBER} with codex exec (${model}, ${language}${effort ? `, ${effort}` : ""})`);
    const result = await run(invocation.command, invocation.args, {
      cwd: repo,
      env: childEnv,
      input: invocation.stdin,
      captureStdout: false,
    });
    if (result.status !== 0) {
      const detail = result.stderr.trim() || "Codex returned no diagnostic text";
      const safeDetail = sanitizeDiagnostic(detail, env);
      let failedRawResponse = null;
      let rawResponseStatus = "not_available";
      if (existsSync(responsePath)) {
        try {
          failedRawResponse = persistRawResponse(auditDir, readFileSync(responsePath), env);
          rawResponseStatus = "saved";
        } catch {
          // Keep the failure metadata useful without preserving a response that may contain credentials.
          rawResponseStatus = "withheld";
        }
      }
      updateAudit({
        status: "codex_failed",
        finished_at: new Date().toISOString(),
        raw_response: failedRawResponse,
        raw_response_status: rawResponseStatus,
        error: `Codex exec failed with exit code ${result.status}: ${safeDetail}`,
      });
      throw new AgentError(`Codex exec failed with exit code ${result.status}: ${safeDetail}`);
    }

    let responseBytes;
    try {
      responseBytes = readFileSync(responsePath);
    } catch {
      updateAudit({
        status: "response_missing",
        finished_at: new Date().toISOString(),
        raw_response_status: "not_written",
        error: "Codex exited successfully but did not write its structured response file",
      });
      throw new AgentError("Codex exited successfully but did not write its structured response file");
    }

    let rawResponse;
    try {
      rawResponse = persistRawResponse(auditDir, responseBytes, env);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "could not persist Codex response";
      updateAudit({
        status: "response_withheld",
        finished_at: new Date().toISOString(),
        raw_response_status: "withheld",
        error: sanitizeDiagnostic(detail, env),
      });
      throw new AgentError(sanitizeDiagnostic(detail, env));
    }
    updateAudit({ status: "response_saved", raw_response: rawResponse, raw_response_status: "saved", parser: { status: "pending", error: null } });

    let document;
    try {
      document = buildFindingsDocument({ pr, agent, response: responseBytes.toString("utf8"), repo, parseReview });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid response";
      const safeDetail = sanitizeDiagnostic(detail, env);
      updateAudit({
        status: "parse_failed",
        finished_at: new Date().toISOString(),
        parser: { status: "failed", error: safeDetail },
        error: safeDetail,
      });
      throw new AgentError(`Codex response failed findings validation: ${detail}`);
    }

    mkdirSync(dirname(env.RB_OUT), { recursive: true });
    const findingsBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    try {
      writeFileSync(env.RB_OUT, findingsBytes, { flag: "wx" });
    } catch {
      updateAudit({
        status: "findings_write_failed",
        finished_at: new Date().toISOString(),
        parser: { status: "passed", error: null },
        error: "could not create RB_OUT; existing findings were left untouched",
      });
      throw new AgentError("could not create RB_OUT; existing findings were left untouched", 2);
    }
    try {
      writeFileSync(join(auditDir, "findings.json"), findingsBytes, { flag: "wx", mode: 0o644 });
    } catch {
      updateAudit({
        status: "audit_findings_write_failed",
        finished_at: new Date().toISOString(),
        parser: { status: "passed", error: null },
        error: "could not persist contract-validated findings in the audit directory",
      });
      throw new AgentError("findings.json was created, but the audit copy could not be saved");
    }
    updateAudit({
      status: "completed",
      finished_at: new Date().toISOString(),
      parser: { status: "passed", error: null },
      findings: { file: "findings.json", count: document.findings.length, sha256: sha256(findingsBytes), size_bytes: findingsBytes.length },
      error: null,
    });
    console.error(`agent: wrote ${document.findings.length} finding(s)`);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const { input, captureStdout = true, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", captureStdout ? "pipe" : "ignore", "pipe"],
      windowsHide: true,
      ...spawnOptions,
    });
    let settled = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const append = (current, chunk) => {
      const limit = 1024 * 1024;
      if (current.length >= limit) return current;
      return Buffer.concat([current, chunk.subarray(0, limit - current.length)]);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    if (captureStdout) child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish({ status: -1, stdout: "", stderr: `could not start ${command}: ${error.message}` }));
    child.on("close", (status) => finish({
      status,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
    }));
    child.stdin.end(input);
  });
}
