import { resolve } from "node:path";
import { runCaptured } from "./process";
import type { AbsolutePath, JjPreflight, ProcessResult } from "./types";

const INSTALL_HINT = "Install it with `brew install jj` (or see https://github.com/jj-vcs/jj), then retry.";
const COLOCATE_HINT =
  "Run `xiv stack init` here to colocate jj (it runs `jj git init --colocate` — adds .jj/ next to .git/, reversible with `rm -rf .jj`).";

/** Run a `jj` subcommand in `cwd`, capturing output. Never throws on a missing binary (code 127). */
export function runJj(args: readonly string[], cwd: AbsolutePath): Promise<ProcessResult> {
  return runCaptured({ cmd: ["jj", ...args], cwd });
}

/** Colocate jj in `cwd` (`jj git init --colocate`): adds .jj/ next to .git/, reversible with `rm -rf .jj`. */
export function jjGitInitColocate(cwd: AbsolutePath): Promise<ProcessResult> {
  return runJj(["git", "init", "--colocate"], cwd);
}

/**
 * Extract the semantic version from `jj --version` output (e.g. "jj 0.28.0" -> "0.28.0").
 * Returns null when the output does not contain a recognizable version.
 */
export function parseJjVersion(stdout: string): string | null {
  const match = stdout.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

function trimmedOrNull(result: ProcessResult): string | null {
  const value = result.stdout.trim();
  return result.code === 0 && value !== "" ? value : null;
}

/** True when two paths point at the same directory. */
export function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/**
 * Probe the environment: is jj installed, what is its workspace root resolved from `cwd`, and what
 * is the git toplevel of `cwd`? The root vs gitRoot comparison catches a jj workspace that lives in
 * an ancestor directory (e.g. a stray `jj git init` in a parent that holds many repos).
 */
export async function jjPreflight(cwd: AbsolutePath): Promise<JjPreflight> {
  const gitRoot = trimmedOrNull(await runCaptured({ cmd: ["git", "rev-parse", "--show-toplevel"], cwd }));
  const version = await runJj(["--version"], cwd);
  if (version.code !== 0) {
    return { available: false, isRepo: false, version: null, root: null, gitRoot };
  }
  const rootResult = await runJj(["root"], cwd);
  return {
    available: true,
    isRepo: rootResult.code === 0,
    version: parseJjVersion(version.stdout),
    root: trimmedOrNull(rootResult),
    gitRoot,
  };
}

/**
 * Pure decision: given a preflight result, return the error a stack command should fail with,
 * or null when the environment is ready. Kept separate from the probe so every branch is testable.
 */
export function jjPreflightError(preflight: JjPreflight, cwd: AbsolutePath): string | null {
  if (!preflight.available) {
    return `jj (Jujutsu) is required for stack commands but was not found on PATH. ${INSTALL_HINT}`;
  }
  if (!preflight.isRepo) {
    return `${cwd} is not a jj repository. ${COLOCATE_HINT}`;
  }
  if (preflight.root !== null && preflight.gitRoot !== null && !samePath(preflight.root, preflight.gitRoot)) {
    return `jj here is rooted at ${preflight.root}, not this repo (${preflight.gitRoot}). A stray jj workspace in a parent directory is shadowing this repo — remove ${preflight.root}/.jj (and a stray ${preflight.root}/.git if a colocate created one), then run \`xiv stack init\` inside ${preflight.gitRoot}.`;
  }
  return null;
}

/** Throw a helpful error unless jj is installed and `cwd` is a jj repo. */
export async function ensureJjReady(cwd: AbsolutePath): Promise<void> {
  const error = jjPreflightError(await jjPreflight(cwd), cwd);
  if (error !== null) throw new Error(error);
}
