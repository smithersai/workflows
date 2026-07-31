import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbsolutePath } from "./types";

export function repoRoot(): AbsolutePath {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function packagedPackRoot(): AbsolutePath {
  return join(repoRoot(), "pack");
}

/**
 * Root the `skills` CLI scans for SKILL.md files. It auto-discovers from the repo root, so this is
 * deliberately the root and not `skills/` — passing the subdirectory would also work today but
 * would silently miss a skill added elsewhere in the repo later.
 */
export function packagedSkillsRoot(): AbsolutePath {
  return repoRoot();
}

/** Root directory under SMITHERS_HOME where stack maps live. */
export function stacksRoot(smithersHome: AbsolutePath): AbsolutePath {
  return join(smithersHome, "stacks");
}

/**
 * Path to a feature's stack map: `<SMITHERS_HOME>/stacks/<feature>.json`. Keyed by feature alone
 * (not by cwd) so every `xiv stack` command finds it from anywhere — the repos a feature
 * spans are recorded inside the map, not implied by where you stand.
 */
export function stackMapPath(smithersHome: AbsolutePath, feature: string): AbsolutePath {
  return join(stacksRoot(smithersHome), `${feature}.json`);
}

/** Root directory under SMITHERS_HOME for `xiv pr review` state (clones, worktrees, scratch). */
export function reviewRoot(smithersHome: AbsolutePath): AbsolutePath {
  return join(smithersHome, "review");
}

/** Where auto-cloned repos live when `--repo owner/name` is not already a local clone. */
export function reviewClonesRoot(smithersHome: AbsolutePath): AbsolutePath {
  return join(reviewRoot(smithersHome), "clones");
}

/** Where per-PR review worktrees are checked out. */
export function reviewWorktreesRoot(smithersHome: AbsolutePath): AbsolutePath {
  return join(reviewRoot(smithersHome), "worktrees");
}

/** A filesystem-safe slug for an `owner/name` repo, e.g. "phylax-watch__xiv". */
export function repoSlugForReview(ownerRepo: string): string {
  return ownerRepo.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

/** Per-PR scratch directory (findings file, draft review body) for one repo + PR. */
export function reviewScratchDir(smithersHome: AbsolutePath, ownerRepo: string, prNumber: number): AbsolutePath {
  return join(reviewRoot(smithersHome), `${repoSlugForReview(ownerRepo)}-pr${prNumber}`);
}

export function defaultSmithersHome(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const configured = env.SMITHERS_HOME;
  if (configured !== undefined && configured.trim() !== "") {
    return resolve(configured);
  }

  const home = env.HOME;
  if (home === undefined || home.trim() === "") {
    throw new Error("HOME is not set; set SMITHERS_HOME explicitly.");
  }

  return join(home, ".smithers");
}
