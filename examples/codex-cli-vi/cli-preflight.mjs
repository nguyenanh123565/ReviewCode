import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const EXPECTED_VERSION = "0.167.0";
const FORBIDDEN_REVIEW_OPTIONS = new Set(["review", "--base", "--commit", "--title", "--uncommitted"]);

export function assertGenericExecInvocation(args) {
  if (!Array.isArray(args) || args[0] !== "exec" || args[1] === "review") {
    throw new Error("review invocation must use generic `codex exec`, not `codex exec review`");
  }
  if (args.some((arg) => FORBIDDEN_REVIEW_OPTIONS.has(arg))) {
    throw new Error("generic `codex exec` must not include native review options (`review`, `--base`, `--commit`, `--title`)");
  }
  if (!args.includes("--sandbox") || args[args.indexOf("--sandbox") + 1] !== "read-only") {
    throw new Error("Codex invocation must use `--sandbox read-only`");
  }
  if (!args.includes("--output-schema") || !args.includes("--output-last-message")) {
    throw new Error("Codex invocation must include `--output-schema` and `--output-last-message`");
  }
  for (const option of ["--cd", "--model", "--ephemeral"]) {
    if (!args.includes(option)) throw new Error(`Codex invocation is missing ${option}`);
  }
  if (typeof args.at(-1) !== "string" || args.at(-1).length === 0) {
    throw new Error("Codex invocation must end with the complete custom prompt");
  }
  return true;
}

export function assertReviewInputTransport(invocation, { prompt, diffPath }) {
  if (!invocation || !Array.isArray(invocation.args) || invocation.args.at(-1) !== prompt || typeof prompt !== "string" || !prompt) {
    throw new Error("Codex review prompt must be passed intact as the final positional argument");
  }
  if (typeof diffPath !== "string" || !diffPath || !prompt.includes(diffPath)) {
    throw new Error("Codex review prompt must include the verified diff path");
  }
  if (!Buffer.isBuffer(invocation.stdin) || invocation.stdin.length !== 0) {
    throw new Error("Codex review stdin must be closed without a diff payload");
  }
  return true;
}

export function runCodexPreflight({ env = process.env, cwd = process.cwd(), timeout = 15000, runCommand } = {}) {
  const execute = runCommand ?? ((args) => runHelpCommand(args, { env, cwd, timeout }));
  const version = execute(["--version"]);
  if (!version.includes(`codex-cli ${EXPECTED_VERSION}`)) {
    throw new Error(`Codex CLI version mismatch; expected ${EXPECTED_VERSION}`);
  }

  const execHelp = execute(["exec", "--help"]);
  // Help descriptions are not a stable API. Check the positional prompt and options structurally;
  // assertReviewInputTransport separately verifies the prompt, diff path, and empty stdin.
  if (!hasPromptUsage(execHelp, "codex exec")) {
    throw new Error("Codex CLI preflight: codex exec --help does not advertise a positional PROMPT argument");
  }
  for (const option of ["--sandbox", "--cd", "--model", "--ephemeral", "-c", "--config", "--color", "--output-schema", "--output-last-message"]) {
    if (!hasOption(execHelp, option)) throw new Error(`Codex CLI preflight: codex exec --help is missing option ${option}`);
  }

  const reviewHelp = execute(["exec", "review", "--help"]);
  if (!hasPromptUsage(reviewHelp, "codex exec review")) {
    throw new Error("Codex CLI preflight: codex exec review --help does not advertise a positional PROMPT argument");
  }
  for (const option of ["--base", "--commit", "--title"]) {
    if (!hasOption(reviewHelp, option)) throw new Error(`Codex CLI preflight: codex exec review --help is missing option ${option}`);
  }
  return { version: EXPECTED_VERSION, execHelp, reviewHelp };
}

function runHelpCommand(args, { env, cwd, timeout }) {
  const windows = process.platform === "win32";
  const npmBin = windows
    ? String(env.PATH ?? "").split(delimiter).find((entry) => existsSync(join(entry, "codex.cmd")) || existsSync(join(entry, "codex.ps1")))
    : undefined;
  const cliEntrypoint = windows && npmBin
    ? join(npmBin, "node_modules", "@openai", "codex", "bin", "codex.js")
    : undefined;
  if (windows && (!cliEntrypoint || !existsSync(cliEntrypoint))) {
    throw new Error("Codex CLI preflight could not locate the installed @openai/codex JS entrypoint");
  }
  const command = windows ? process.execPath : "codex";
  const commandArgs = windows ? [cliEntrypoint, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    throw new Error(`Codex CLI preflight could not run ${command} ${commandArgs.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim().slice(0, 800);
    throw new Error(`Codex CLI preflight failed for ${command} ${commandArgs.join(" ")}${detail ? `: ${detail}` : ""}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function hasPromptUsage(help, command) {
  const commandPattern = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return help.split(/\r?\n/).some((line) =>
    new RegExp(`^\\s*Usage:\\s*${commandPattern}\\b`, "i").test(line) && /\[PROMPT\]|<PROMPT>/i.test(line));
}

function hasOption(help, option) {
  const optionPattern = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,])${optionPattern}(?=$|[\\s,=])`, "m").test(help);
}
