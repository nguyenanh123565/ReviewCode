import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_DIFF_BYTES = 128 * 1024 * 1024;

export function readAndVerifyDiff({ diffPath, repo, base, head, env = process.env, runGitDiff = runGitDiffCommand }) {
  const diff = readFileSync(diffPath);
  if (diff.length === 0) throw new Error("RB_DIFF is empty; refusing to run an out-of-scope review");

  const expectedDiff = runGitDiff({ repo, base, head, env, maxBuffer: MAX_DIFF_BYTES });
  if (expectedDiff.error || expectedDiff.status !== 0 || !Buffer.isBuffer(expectedDiff.stdout) || !diff.equals(expectedDiff.stdout)) {
    throw new Error("RB_DIFF does not exactly match git diff RB_BASE...RB_HEAD");
  }
  return diff;
}

function runGitDiffCommand({ repo, base, head, env, maxBuffer }) {
  return spawnSync("git", ["diff", `${base}...${head}`], {
    cwd: repo,
    env,
    maxBuffer,
    windowsHide: true,
  });
}
