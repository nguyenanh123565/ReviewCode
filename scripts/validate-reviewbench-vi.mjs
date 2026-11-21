#!/usr/bin/env node
// Offline validation for the one-task ReviewBench-VI pilot. This never calls a model.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createAuditMetadata, persistRawResponse, sha256, writeAuditMetadata } from "../examples/codex-cli-vi/audit.mjs";
import { assertGenericExecInvocation, assertReviewInputTransport, runCodexPreflight } from "../examples/codex-cli-vi/cli-preflight.mjs";
import { readAndVerifyDiff } from "../examples/codex-cli-vi/diff.mjs";
import { buildCodexInvocation, buildFindingsDocument, buildReviewPrompt, validateFindingsDocument } from "../examples/codex-cli-vi/prompt.mjs";
import { parseReview } from "../examples/codex-cli-vi/parse.mjs";
import { sanitizeDiagnostic } from "../examples/codex-cli-vi/diagnostic.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const adapterDir = join(root, "examples/codex-cli-vi");
const originalPath = join(root, "corpus/test/test.json");
const viPath = join(root, "corpus/vi/test_vi.json");
const corpusSchemaPath = join(root, "schema/corpus-manifest.schema.json");
const responseSchemaPath = join(adapterDir, "review-response.schema.json");
const original = readJson(originalPath);
const translated = readJson(viPath);
const corpusSchema = readJson(corpusSchemaPath);
const responseSchema = readJson(responseSchemaPath);
const fixtureFinding = readJson(join(adapterDir, "fixtures/review-vi.json"));
const fixtureEmpty = readJson(join(adapterDir, "fixtures/review-empty.json"));
const cliHelpFixture = readJson(join(adapterDir, "fixtures/codex-cli-0.167.0-help.json"));
const largeDiffFixture = createLargeDiffFixture();
const problems = [];
const verified = [];
const notVerified = [];

function fail(message) { problems.push(message); }
function pass(message) { verified.push(message); }

pass(`adapter diff verifier matched and retained all ${largeDiffFixture.diff.length.toLocaleString("en-US")} bytes; a final-byte mismatch was rejected`);

for (const [name, value] of [["corpus/test/test.json", original], ["corpus/vi/test_vi.json", translated]]) {
  const errors = [];
  validateSchema(value, corpusSchema, name, errors);
  if (errors.length) problems.push(...errors);
  else pass(`${name} phù hợp schema manifest`);
}

const schemaErrors = [];
validateSchema(fixtureFinding, responseSchema, "fixtures/review-vi.json", schemaErrors);
validateSchema(fixtureEmpty, responseSchema, "fixtures/review-empty.json", schemaErrors);
if (schemaErrors.length) problems.push(...schemaErrors);
else pass("JSON Schema đầu ra chấp nhận fixture findings tiếng Việt và mảng rỗng");

if (translated.length !== 1) fail(`Pilot phải có đúng 1 task, nhận được ${translated.length}`);
const source = original.find((task) => task.nwo === "PierreJanineh/TechDebtMCP" && task.pr_number === 135);
const vi = translated[0];
if (!source || !vi) fail("Không tìm thấy Task 0 PierreJanineh/TechDebtMCP#135 trong một trong hai manifest");

if (source && vi) {
  const technicalFields = [
    "repo", "pr_number", "pr_url", "base", "head", "nwo", "language",
    "repo_size_kb", "lines_added", "lines_removed", "files_changed",
  ];
  for (const field of technicalFields) {
    if (vi[field] !== source[field]) fail(`${field} khác với manifest tiếng Anh`);
  }
  if (vi.title === source.title || vi.body === source.body) fail("title và body phải được Việt hóa");
  if (vi.translation?.source_manifest !== "corpus/test/test.json") fail("Thiếu đường dẫn manifest nguồn trong metadata dịch");
  if (vi.translation?.source_title !== source.title) fail("source_title không khớp nguyên văn với bản nguồn");
  if (vi.translation?.source_body !== source.body) fail("source_body không khớp nguyên văn với bản nguồn");
  if (/[^\x00-\x7f]/u.test(vi.title + vi.body)) pass("title/body có ký tự tiếng Việt ngoài ASCII");
  else fail("Không phát hiện ký tự tiếng Việt trong title/body");
  for (const key of ["findings", "golden", "tp_fp", "tp_fp_justification"]) {
    if (Object.hasOwn(vi, key)) fail(`Manifest đề bài không được chứa ${key}`);
  }
  if (problems.length === 0) pass("identity, SHA, metadata kỹ thuật và provenance khớp task nguồn");

  const englishPrompt = buildReviewPrompt(source, "en", largeDiffFixture.diffPath);
  const vietnamesePrompt = buildReviewPrompt(vi, "vi", largeDiffFixture.diffPath);
  for (const [name, prompt, task] of [["English", englishPrompt, source], ["Vietnamese", vietnamesePrompt, vi]]) {
    const metadataBlock = prompt.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    let metadata;
    try { metadata = JSON.parse(metadataBlock?.[1] ?? ""); } catch { metadata = undefined; }
    if (metadata?.title !== task.title || metadata?.body !== task.body) fail(`${name} prompt thiếu title hoặc body nguyên vẹn trong metadata JSON`);
    if (metadata?.base !== task.base || metadata?.head !== task.head) {
      fail(`${name} prompt thiếu SHA hoặc cảnh báo nội dung PR không đáng tin cậy`);
    }
  }
  if (!vietnamesePrompt.includes("bằng tiếng Việt") || !vietnamesePrompt.includes("không đáng tin cậy")) {
    fail("Prompt tiếng Việt thiếu yêu cầu ngôn ngữ hoặc cách xử lý nội dung PR");
  }
  if (!englishPrompt.includes("in English") || !englishPrompt.includes("untrusted context")) {
    fail("Prompt tiếng Anh thiếu yêu cầu ngôn ngữ hoặc cách xử lý nội dung PR");
  }
  for (const [name, prompt] of [["English", englishPrompt], ["Vietnamese", vietnamesePrompt]]) {
    if (!prompt.includes(largeDiffFixture.diffPath) || !prompt.includes("git diff --name-only -z") ||
        !prompt.includes("git diff BASE...HEAD -- <file>") || !prompt.includes("sed -n") || !prompt.includes("EOF")) {
      fail(`${name} prompt thiếu đường dẫn diff hoặc hướng dẫn đọc tuần tự từng tệp/đoạn`);
    }
  }

  const diff = largeDiffFixture.diff;
  const invocationOptions = {
    model: "fixture-model",
    effort: "medium",
    responsePath: "/tmp/fixture-response.json",
    schemaPath: responseSchemaPath,
    repo: "/work/repo",
    diffPath: largeDiffFixture.diffPath,
  };
  const enInvocation = buildCodexInvocation({ ...invocationOptions, prompt: englishPrompt });
  const viInvocation = buildCodexInvocation({ ...invocationOptions, prompt: vietnamesePrompt });
  try {
    assertGenericExecInvocation(enInvocation.args);
    const invalidInvocations = [
      ["exec", "review", "--base", "HEAD", "--title", "Test PR", "prompt"],
      ["exec", "--base", "HEAD", "prompt"],
      ["exec", "--title", "Test PR", "prompt"],
    ];
    let allInvalidInvocationsRejected = true;
    for (const invalidArgs of invalidInvocations) {
      try { assertGenericExecInvocation(invalidArgs); allInvalidInvocationsRejected = false; }
      catch { /* expected: block native review options before execution */ }
    }
    if (!allInvalidInvocationsRejected) fail("Preflight accepted a native review/--base/--title custom-prompt argument combination");
    else pass("preflight rejects review, --base and --title combinations before execution");
  } catch (error) {
    fail(`Codex invocation preflight rejected the generic command: ${error instanceof Error ? error.message : error}`);
  }
  if (enInvocation.command !== "codex" || enInvocation.args[0] !== "exec") fail("Adapter không gọi codex exec");
  if (enInvocation.args.includes("review") || enInvocation.args.includes("--base") || enInvocation.args.includes("--title")) {
    fail("Adapter còn dùng native review hoặc option xung đột với prompt tùy chỉnh");
  }
  if (optionValue(enInvocation.args, "--sandbox") !== "read-only") fail("Codex không chạy với sandbox read-only");
  if (optionValue(enInvocation.args, "--cd") !== "/work/repo") fail("Codex không làm việc trong checkout nguồn");
  if (optionValue(enInvocation.args, "--output-schema") !== responseSchemaPath) fail("Codex không nhận schema phản hồi");
  if (enInvocation.args.at(-1) !== englishPrompt || viInvocation.args.at(-1) !== vietnamesePrompt) {
    fail("Prompt đầy đủ không được truyền làm đối số cuối cho codex exec");
  }
  if (enInvocation.stdin.length !== 0 || viInvocation.stdin.length !== 0) fail("stdin Codex phải rỗng cho cả hai ngôn ngữ");
  if (Buffer.from(enInvocation.args.join("\0"), "utf8").includes(diff) || Buffer.from(viInvocation.args.join("\0"), "utf8").includes(diff)) {
    fail("Prompt/argv Codex chứa toàn bộ patch thay vì chỉ đường dẫn RB_DIFF");
  }
  try {
    assertReviewInputTransport(enInvocation, { prompt: englishPrompt, diffPath: largeDiffFixture.diffPath });
    assertReviewInputTransport(viInvocation, { prompt: vietnamesePrompt, diffPath: largeDiffFixture.diffPath });
    const wrongDiff = { ...viInvocation, stdin: diff };
    let wrongDiffRejected = false;
    try { assertReviewInputTransport(wrongDiff, { prompt: vietnamesePrompt, diffPath: largeDiffFixture.diffPath }); }
    catch { wrongDiffRejected = true; }
    const wrongPrompt = { ...enInvocation, args: [...enInvocation.args.slice(0, -1), "short prompt"] };
    let wrongPromptRejected = false;
    try { assertReviewInputTransport(wrongPrompt, { prompt: englishPrompt, diffPath: largeDiffFixture.diffPath }); }
    catch { wrongPromptRejected = true; }
    if (!wrongDiffRejected || !wrongPromptRejected) fail("transport guard accepted a substituted diff or truncated prompt");
    else pass("transport guard requires the full positional prompt and rejects patch content on stdin");
  } catch (error) {
    fail(`Codex prompt/stdin transport check failed: ${error instanceof Error ? error.message : error}`);
  }
  const largeDiffAudit = createAuditMetadata({
    pr: vi,
    runId: "large-diff-fixture",
    diff,
    prompt: vietnamesePrompt,
    model: "fixture-model",
    effort: "medium",
    language: "vi",
  });
  if (largeDiffAudit.diff.sha256 !== sha256(diff) || largeDiffAudit.diff.size_bytes !== 852286) {
    fail("Audit không giữ hash và kích thước đầy đủ của diff giả 852.286 byte");
  } else pass("diff giả 852.286 byte được xác minh toàn bộ và audit giữ SHA-256/kích thước");
  if (JSON.stringify(enInvocation.args.slice(0, -1)) !== JSON.stringify(viInvocation.args.slice(0, -1))) {
    fail("English/Việt không dùng cùng cấu hình Codex ngoài ngôn ngữ prompt");
  }
  if (englishPrompt === vietnamesePrompt) fail("Prompt English và Việt không thể hiện biến ngôn ngữ");
  else pass("hai baseline dùng cùng codex exec read-only, model/effort, repo và schema; prompt khác theo ngôn ngữ và stdin rỗng");

  const producer = "codex-cli-vi";
  const parsedFinding = parseReview(JSON.stringify(fixtureFinding), producer);
  if (parsedFinding.length !== 1 || parsedFinding[0]?.file !== "src/pattern.ts" ||
      parsedFinding[0]?.start_line !== 18 || parsedFinding[0]?.end_line !== 20 ||
      !parsedFinding[0]?.message.includes("Giới hạn độ dài") ||
      !parsedFinding[0]?.message.includes("cạn CPU") || parsedFinding[0]?.producer !== producer) {
    fail("Parser không giữ finding tiếng Việt, file, dòng và producer");
  } else pass("parser giữ nguyên Unicode tiếng Việt và chuyển finding có cấu trúc sang contract");

  const document = buildFindingsDocument({ pr: vi, agent: producer, response: JSON.stringify(fixtureFinding), parseReview });
  if (Object.keys(document).sort().join(",") !== "agent,findings,pr") fail("findings.json có field top-level sai contract");
  if (Object.keys(document.pr).sort().join(",") !== "base,head,pr_number,repo") fail("findings.json PR object không đúng contract");
  if (Object.keys(document.findings[0] ?? {}).sort().join(",") !== "end_line,file,message,producer,start_line") {
    fail("finding không đúng field contract của AGENT_CONTRACT.md");
  } else {
    validateFindingsDocument(document, { pr: vi, agent: producer });
    pass("findings.json thỏa field contract, frozen PR identity và producer");
  }

  const emptyDocument = buildFindingsDocument({ pr: vi, agent: producer, response: JSON.stringify(fixtureEmpty), parseReview });
  if (emptyDocument.findings.length !== 0) fail("JSON findings rỗng tường minh không được chấp nhận");
  else pass("fixture {findings: []} được chấp nhận rõ ràng theo AGENT_CONTRACT.md");

  for (const [name, raw] of [["malformed JSON", "{\"findings\":"], ["missing findings", "{\"result\":\"none\"}"]]) {
    let rejected = false;
    try { parseReview(raw, producer); } catch { rejected = true; }
    if (!rejected) fail(`Parser âm thầm chấp nhận ${name}`);
  }
  pass("malformed hoặc thiếu findings bị từ chối, không chuyển thành mảng rỗng");

  const secret = "sk-test-1234567890abcdefghijklmnopqrstuvwxyz";
  const safeDiagnostic = sanitizeDiagnostic(`request failed with status 429; Authorization: Bearer ${secret}; OPENAI_API_KEY=${secret}`, {
    OPENAI_API_KEY: secret,
  });
  if (!safeDiagnostic.includes("status 429") || safeDiagnostic.includes(secret) || !safeDiagnostic.includes("[REDACTED]")) {
    fail("Codex diagnostic không hữu ích hoặc chưa loại credential");
  } else pass("diagnostic giữ lỗi hữu ích và redacts API key/Bearer token");
}

const runner = readFileSync(join(root, "scripts/try-agent.sh"), "utf8");
const adapter = readFileSync(join(adapterDir, "agent.mjs"), "utf8");
const dockerfile = readFileSync(join(adapterDir, "Dockerfile"), "utf8");

for (const testCase of [
  { name: "raw response with findings", raw: readFileSync(join(adapterDir, "fixtures/review-vi.json")), count: 1 },
  { name: "raw empty response", raw: readFileSync(join(adapterDir, "fixtures/review-empty.json")), count: 0 },
  { name: "parser error", raw: Buffer.from("{\"findings\":", "utf8"), parseError: true },
]) {
  const scratch = mkdtempSync(join(tmpdir(), "reviewbench-audit-case-"));
  try {
    const task = vi ?? { repo: "https://github.com/example/repo", nwo: "example/repo", pr_number: 1, base: "0".repeat(40), head: "1".repeat(40) };
    const diff = Buffer.from("diff --git a/src/a.ts b/src/a.ts\n", "utf8");
    const prompt = "offline audit fixture prompt";
    const metadata = createAuditMetadata({ pr: task, runId: "fixture-run", diff, prompt, model: "fixture-model", effort: "medium", language: "vi" });
    metadata.codex.version = "0.167.0";
    const metadataPath = join(scratch, "metadata.json");
    writeAuditMetadata(metadataPath, metadata, { exclusive: true });
    const rawRecord = persistRawResponse(scratch, testCase.raw, { OPENAI_API_KEY: "audit-fixture-secret-long" });
    metadata.raw_response = rawRecord;
    metadata.raw_response_status = "saved";
    metadata.status = "response_saved";
    metadata.parser = { status: "pending", error: null };
    writeAuditMetadata(metadataPath, metadata);

    if (Buffer.compare(readFileSync(join(scratch, "codex-response.json")), testCase.raw) !== 0) {
      fail(`${testCase.name}: raw JSON was not persisted byte-for-byte before parsing`);
    }
    if (rawRecord.sha256 !== sha256(testCase.raw) || rawRecord.size_bytes !== testCase.raw.length ||
        metadata.diff.sha256 !== sha256(diff) || metadata.prompt.sha256 !== sha256(prompt) ||
        metadata.diff.size_bytes !== diff.length || metadata.prompt.size_bytes !== Buffer.byteLength(prompt)) {
      fail(`${testCase.name}: response/diff/prompt hash or size metadata is incorrect`);
    }

    if (testCase.parseError) {
      let rejected = false;
      try { parseReview(testCase.raw.toString("utf8"), "codex-cli-vi"); }
      catch (error) {
        rejected = true;
        metadata.parser = { status: "failed", error: error.message };
        metadata.status = "parse_failed";
      }
      if (!rejected) fail("parser-error fixture was accepted");
      if (!existsSync(join(scratch, "codex-response.json")) || metadata.status !== "parse_failed" || metadata.parser.status !== "failed") {
        fail("parser failure discarded raw response or was not reflected in metadata");
      }
    } else {
      const response = testCase.raw.toString("utf8");
      const findings = parseReview(response, "codex-cli-vi");
      if (findings.length !== testCase.count) fail(`${testCase.name}: unexpected parser finding count`);
      const output = buildFindingsDocument({ pr: task, agent: "codex-cli-vi", response, parseReview });
      validateFindingsDocument(output, { pr: task, agent: "codex-cli-vi" });
      const findingsBytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`, "utf8");
      writeFileSync(join(scratch, "findings.json"), findingsBytes, { flag: "wx" });
      metadata.parser = { status: "passed", error: null };
      metadata.findings = { file: "findings.json", count: findings.length, sha256: sha256(findingsBytes), size_bytes: findingsBytes.length };
      metadata.status = "completed";
      const reread = JSON.parse(readFileSync(join(scratch, "findings.json"), "utf8"));
      if (JSON.stringify(reread) !== JSON.stringify(output)) fail(`${testCase.name}: audited findings differ from contract output`);
    }
    writeAuditMetadata(metadataPath, metadata);
    const rereadMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (rereadMetadata.run_id !== "fixture-run" || rereadMetadata.codex.version !== "0.167.0" ||
        rereadMetadata.codex.model !== "fixture-model" || rereadMetadata.codex.reasoning_effort !== "medium" ||
        rereadMetadata.pr.nwo !== task.nwo || rereadMetadata.pr.pr_number !== Number(task.pr_number) ||
        rereadMetadata.pr.base !== task.base || rereadMetadata.pr.head !== task.head ||
        rereadMetadata.raw_response_status !== "saved" || JSON.stringify(rereadMetadata).includes("OPENAI_API_KEY")) {
      fail(`${testCase.name}: PR/model/reasoning metadata was not preserved`);
    } else if (!testCase.parseError) {
      pass(`${testCase.name}: exact raw bytes, hashes, parser result and contract findings verified offline`);
    } else if (rereadMetadata.status === "parse_failed" && existsSync(join(scratch, "codex-response.json"))) {
      pass("parser error: raw response is retained and metadata reports parse_failed");
    }
  } catch (error) {
    fail(`${testCase.name}: audit fixture failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
const credentialScratch = mkdtempSync(join(tmpdir(), "reviewbench-audit-secret-"));
try {
  const token = "ghp_fixture_token_12345678901234567890";
  persistRawResponse(credentialScratch, Buffer.from(`{\"token\":\"${token}\"}`, "utf8"), { GITHUB_TOKEN: token });
  fail("audit credential guard accepted a configured token value");
} catch (error) {
  if (error instanceof Error && error.message.includes("credential")) pass("audit credential guard withholds configured credential values");
  else fail(`audit credential guard failed unexpectedly: ${error instanceof Error ? error.message : error}`);
} finally {
  rmSync(credentialScratch, { recursive: true, force: true });
}

if (!runner.includes('-v "$repo:/work/repo" -v "$pr_dir:/work/pr:ro" -v "$out:/work/out"')) {
  fail("Không thể xác nhận các mount contract của runner");
} else if (/\-v\s+[^\n]*golden|golden\/|golden\\/i.test(runner)) {
  fail("Runner có tham chiếu mount hoặc path Golden");
} else {
  pass("runner chỉ mount checkout, PR metadata/diff read-only và output; không mount Golden");
}
if (!runner.includes("scripts/lib/reviewbench-audit.sh") ||
    !runner.includes('archive_reviewbench_audit "$out/audit" "$audit_dir"') ||
    !runner.includes('mktemp -d "$task_audit_root/run.$audit_timestamp.XXXXXX"')) {
  fail("Runner does not create unique durable audit folders and archive artifacts before scratch cleanup");
} else pass("runner creates unique per-task audit directory and archives artifacts outside disposable workspace");
if (!runner.includes("{repo, pr_number: (.pr_number | tonumber), base, head, nwo, title, body}")) {
  fail("Runner không chiếu metadata PR tối thiểu vào pr.json");
}
if (!adapter.includes('"RB_DIFF"') || !adapter.includes('input: invocation.stdin') ||
    !adapter.includes('assertReviewInputTransport(invocation, { prompt, diffPath: env.RB_DIFF })') ||
    !adapter.includes('readAndVerifyDiff({ diffPath: env.RB_DIFF, repo, base: env.RB_BASE, head: env.RB_HEAD, env })') ||
    !adapter.includes('headCheck.stdout.trim() !== env.RB_HEAD')) {
  fail("Adapter không giữ kiểm tra HEAD và xác minh toàn bộ RB_DIFF trước khi gọi Codex");
} else if (/golden/i.test(adapter)) {
  fail("Adapter có tham chiếu Golden");
} else pass("adapter giữ HEAD và so sánh byte toàn bộ diff ba chấm; không đọc Golden");
if (!dockerfile.includes("@openai/codex@0.167.0") || !dockerfile.includes("review-response.schema.json") || !dockerfile.includes("cli-preflight.mjs") || !dockerfile.includes("audit.mjs") || !dockerfile.includes("diff.mjs")) {
  fail("Docker image không pin Codex CLI 0.167.0 hoặc thiếu schema output");
} else if (/golden/i.test(dockerfile)) {
  fail("Dockerfile có tham chiếu tới Golden");
} else pass("Dockerfile pin codex-cli 0.167.0, copy schema JSON và không đóng gói Golden");

const helpCalls = [];
try {
  const checked = runCodexPreflight({ runCommand(args) {
    helpCalls.push(args.join(" "));
    if (args[0] === "--version") return cliHelpFixture.version;
    if (args[0] === "exec" && args[1] === "--help") return cliHelpFixture.exec_help;
    if (args[0] === "exec" && args[1] === "review") return cliHelpFixture.review_help;
    throw new Error(`Unexpected CLI preflight args: ${args.join(" ")}`);
  } });
  if (helpCalls.join("|") !== "--version|exec --help|exec review --help") {
    fail("Codex preflight did not call version and both help commands in order");
  } else pass(`preflight kiểm tra version và cú pháp help fixtures của Codex ${checked.version} trước model request`);

  const stdinDescription = cliHelpFixture.exec_help.split("\n").find((line) => line.startsWith("If stdin is piped"));
  const alternateWording = stdinDescription
    ? cliHelpFixture.exec_help.replace(stdinDescription, "When input is piped, the prompt remains the instruction and stdin supplies review context.")
    : `${cliHelpFixture.exec_help}\nWhen input is piped, the prompt remains the instruction and stdin supplies review context.`;
  const alternate = runCodexPreflight({ runCommand(args) {
    if (args[0] === "--version") return cliHelpFixture.version;
    if (args[0] === "exec" && args[1] === "--help") return alternateWording;
    if (args[0] === "exec" && args[1] === "review") return cliHelpFixture.review_help;
    throw new Error(`Unexpected CLI preflight args: ${args.join(" ")}`);
  } });
  if (alternate.version !== checked.version) fail("preflight rejected alternate stdin help wording or changed the validated CLI version");
  else pass("preflight checks CLI prompt usage and required flags without depending on stdin help wording");

  let missingFlagRejected = false;
  try {
    runCodexPreflight({ runCommand(args) {
      if (args[0] === "--version") return cliHelpFixture.version;
      if (args[0] === "exec" && args[1] === "--help") return cliHelpFixture.exec_help.replace("--output-last-message <FILE>", "");
      if (args[0] === "exec" && args[1] === "review") return cliHelpFixture.review_help;
      throw new Error(`Unexpected CLI preflight args: ${args.join(" ")}`);
    } });
  } catch { missingFlagRejected = true; }
  if (!missingFlagRejected) fail("preflight accepted help that omitted a required output option");
  else pass("preflight still rejects missing CLI syntax/options (validation was not bypassed)");

  let missingPromptRejected = false;
  try {
    runCodexPreflight({ runCommand(args) {
      if (args[0] === "--version") return cliHelpFixture.version;
      if (args[0] === "exec" && args[1] === "--help") return cliHelpFixture.exec_help.replaceAll("[PROMPT]", "[TASK]");
      if (args[0] === "exec" && args[1] === "review") return cliHelpFixture.review_help;
      throw new Error(`Unexpected CLI preflight args: ${args.join(" ")}`);
    } });
  } catch { missingPromptRejected = true; }
  if (!missingPromptRejected) fail("preflight accepted help that omitted the positional prompt argument");
  else pass("preflight rejects CLI help without positional PROMPT support");
} catch (error) {
  fail(`Codex CLI help preflight fixture thất bại: ${error instanceof Error ? error.message : error}`);
}

const args = process.argv.slice(2);
let repoDir;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repo" && args[i + 1]) repoDir = resolve(args[++i]);
  else fail(`Tùy chọn không hợp lệ: ${args[i]}`);
}
if (repoDir && vi) {
  const head = git(repoDir, ["rev-parse", "HEAD"]);
  const baseExists = git(repoDir, ["cat-file", "-e", `${vi.base}^{commit}`]);
  const diff = git(repoDir, ["diff", `${vi.base}...${vi.head}`]);
  if (head.status !== 0 || head.stdout.trim() !== vi.head) fail("Checkout local không ở đúng RB_HEAD");
  else if (baseExists.status !== 0) fail("Base commit không có trong checkout local");
  else if (diff.status !== 0) fail("Không tạo được git diff base...head");
  else pass(`checkout HEAD và diff base...head được xác minh (${Buffer.byteLength(diff.stdout)} byte)`);
} else {
  notVerified.push("Git object/diff nguồn chưa được kiểm chứng bởi validator; chạy try-agent.sh --dry-run để xác minh checkout/diff.");
}

rmSync(largeDiffFixture.scratch, { recursive: true, force: true });

for (const message of verified) console.log(`PASS: ${message}`);
for (const message of notVerified) console.log(`NOT VERIFIED: ${message}`);
for (const message of problems) console.error(`FAIL: ${message}`);
console.log(`\n${verified.length} PASS, ${problems.length} FAIL, ${notVerified.length} NOT VERIFIED`);
if (problems.length) process.exit(1);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { console.error(`FAIL: cannot parse JSON ${path}: ${error.message}`); process.exit(1); }
}

function optionValue(list, option) {
  const index = list.indexOf(option);
  return index < 0 ? undefined : list[index + 1];
}

function validateSchema(value, schema, path, errors) {
  const matchesType = schema.type === "array" ? Array.isArray(value)
    : schema.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
      : schema.type === "integer" ? Number.isInteger(value)
        : schema.type === "string" ? typeof value === "string"
          : true;
  if (!matchesType) { errors.push(`${path}: expected ${schema.type}`); return; }
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    value.forEach((item, i) => validateSchema(item, schema.items, `${path}[${i}]`, errors));
  } else if (schema.type === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(item, schema.properties[key], `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown field`);
    }
  } else if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  } else if ((schema.type === "integer" || schema.type === "number") && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`);
  }
}

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true });
}

function createLargeDiffFixture() {
  const scratch = mkdtempSync(join(tmpdir(), "reviewbench-large-diff-"));
  const diffPath = join(scratch, "diff.patch");
  const targetBytes = 852286;
  const prefix = Buffer.from(
    "diff --git a/large.txt b/large.txt\nindex 0000000..1111111 100644\n--- a/large.txt\n+++ b/large.txt\n@@ -1 +1 @@\n-old\n+",
    "utf8",
  );
  const diff = Buffer.concat([prefix, Buffer.alloc(targetBytes - prefix.length - 1, 0x78), Buffer.from("\n")]);
  const base = "0".repeat(40);
  const head = "1".repeat(40);
  writeFileSync(diffPath, diff);
  let gitRequest;
  const runGitDiff = (request) => {
    gitRequest = request;
    return { status: 0, stdout: diff };
  };
  const verified = readAndVerifyDiff({ diffPath, repo: scratch, base, head, env: process.env, runGitDiff });
  if (!verified.equals(diff) || verified.length !== targetBytes) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error("adapter diff verifier did not return the complete fixture bytes");
  }
  if (gitRequest?.base !== base || gitRequest?.head !== head || gitRequest?.repo !== scratch) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error("adapter diff verifier did not compare the requested repository/base/head range");
  }
  const alteredPath = join(scratch, "altered.patch");
  const altered = Buffer.from(diff);
  altered[altered.length - 1] ^= 1;
  writeFileSync(alteredPath, altered);
  let alteredRejected = false;
  try { readAndVerifyDiff({ diffPath: alteredPath, repo: scratch, base, head, env: process.env, runGitDiff }); }
  catch { alteredRejected = true; }
  if (!alteredRejected) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error("adapter diff verifier accepted a mismatch at the final diff byte");
  }
  return { scratch, diffPath, diff: verified, base, head };
}
