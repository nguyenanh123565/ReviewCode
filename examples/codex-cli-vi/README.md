# Codex CLI adapter for ReviewBench-VI

This image uses the generic `codex exec` command with a full custom review prompt. The prompt includes PR title/body and the path in `RB_DIFF`; the complete patch stays on disk and stdin is closed without a payload. It does not use `codex exec review --base`; the generic command and native review have different scope semantics.

The adapter verifies PR metadata, checkout `HEAD`, base commit availability, and byte-for-byte equality between `/work/pr/diff.patch` and the complete output of `git diff RB_BASE...RB_HEAD`. The diff SHA-256 and byte count remain in the audit. Codex runs with `--sandbox read-only`. Prompt language is selected with `RB_CONFIG_REVIEW_LANGUAGE=en|vi`; the same image and invocation method support both baselines.

Before a review request, the adapter checks the installed CLI version and the command usage/option tokens in actual `codex exec --help` / `codex exec review --help` output. It does not require a particular prose sentence about stdin, since help wording can vary. Its argument guard rejects native review options before starting Codex.

The complete review prompt is passed as the final positional argument. It tells Codex to list changed paths first, then inspect each path with `git diff RB_BASE...RB_HEAD -- <file>`. Large per-file diffs must be read in sequential chunks through EOF. The adapter checks that the prompt includes the verified diff path and that stdin is empty immediately before execution.

Codex must return JSON matching `review-response.schema.json`. The parser rejects invalid JSON or invalid findings rather than treating errors as an empty result. Only an explicit `{ "findings": [] }` is an empty review. Before writing `RB_OUT`, the adapter validates the frozen PR identity and finding fields from `AGENT_CONTRACT.md`.

Each run writes an audit directory under `RB_AUDIT_DIR` (default: `audit` beside `RB_OUT`). It saves `metadata.json`, the exact bytes from `--output-last-message` as `codex-response.json` before parsing, and the resulting contract-validated `findings.json`. Metadata records PR/base/head, SHA-256 and byte length of the diff and exact positional prompt, Codex CLI version, model, reasoning effort, parser status, and findings digest/size. It does not store prompt text or environment variables. Before saving the raw response, the adapter withholds it if it contains configured credential values or recognized API-key/Bearer patterns.

The runner archives only those three files plus its own `runner.json` under `./audit/<repo_PR_head>/run.<UTC timestamp>.<suffix>/`, outside the disposable workspace. Each directory is created uniquely and is never reused. No Golden files are mounted in the reviewer container.

Run offline validation from the repository root:

```sh
node scripts/validate-reviewbench-vi.mjs
bash scripts/test-reviewbench-audit.sh
```

See [README_VI.md](../../README_VI.md) for the Task 0 paired commands. Never compare the custom English baseline with native Codex review.
