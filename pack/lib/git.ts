// Minimal git helper for the workflow half. The stack is built with plain git
// (linear-implement creates branches + commits via git/gh); jj sits underneath as a
// colocated layer and only does the heavy lifting during restack (stack-amend).
import { spawn } from "node:child_process";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Check out an existing branch so the next entry's work stacks on top of it. */
export async function gitCheckout(branch: string, cwd: string): Promise<void> {
  const result = await runGit(["checkout", branch], cwd);
  if (result.code !== 0) {
    throw new Error(`\`git checkout ${branch}\` failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
}
