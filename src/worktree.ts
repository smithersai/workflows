import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { detectOwnerRepo, gitToplevel } from "./github";
import { capture } from "./process";
import { reviewClonesRoot, reviewWorktreesRoot, repoSlugForReview } from "./paths";
import type {
  AbsolutePath,
  BranchName,
  OwnerRepo,
  PrWorktree,
  PullRequestNumber,
  ResolvedClone,
} from "./types";

function git(cwd: AbsolutePath, ...subcmd: readonly string[]): Promise<string> {
  return capture({ cmd: ["git", ...subcmd], cwd, env: process.env });
}

export interface ResolveCloneOptions {
  readonly cwd: AbsolutePath;
  readonly smithersHome: AbsolutePath;
  /** Explicit `owner/name`. When omitted, the repo of `cwd` is used. */
  readonly ownerRepo?: OwnerRepo;
}

/**
 * Decide which local clone to branch a review worktree from:
 *  - no `ownerRepo`: use the clone that `cwd` lives in (the common "I'm already in the repo" case);
 *  - `ownerRepo` matching the cwd repo: same as above;
 *  - `ownerRepo` not present locally: clone it into the review cache and reuse on later runs.
 */
export async function resolveClone(options: ResolveCloneOptions): Promise<ResolvedClone> {
  const cwdRepo = await detectOwnerRepo(options.cwd);

  if (options.ownerRepo === undefined) {
    if (cwdRepo === null) {
      throw new Error(
        "Not inside a GitHub repo. Run `xiv pr review` from a clone, or pass --repo owner/name.",
      );
    }
    const root = await gitToplevel(options.cwd);
    if (root === null) throw new Error("Could not resolve the git working tree for the current directory.");
    return { ownerRepo: cwdRepo, cloneRoot: root, cloned: false };
  }

  if (cwdRepo === options.ownerRepo) {
    const root = await gitToplevel(options.cwd);
    if (root === null) throw new Error("Could not resolve the git working tree for the current directory.");
    return { ownerRepo: options.ownerRepo, cloneRoot: root, cloned: false };
  }

  const cacheRoot = reviewClonesRoot(options.smithersHome);
  await mkdir(cacheRoot, { recursive: true });
  const cloneRoot = join(cacheRoot, repoSlugForReview(options.ownerRepo));

  if (existsSync(cloneRoot)) {
    await git(cloneRoot, "fetch", "origin", "--prune");
  } else {
    await capture({ cmd: ["gh", "repo", "clone", options.ownerRepo, cloneRoot], cwd: options.cwd, env: process.env });
  }
  return { ownerRepo: options.ownerRepo, cloneRoot, cloned: true };
}

export interface EnsureWorktreeOptions {
  readonly clone: ResolvedClone;
  readonly smithersHome: AbsolutePath;
  readonly prNumber: PullRequestNumber;
  readonly baseRefName: BranchName;
}

/**
 * Fetch the PR head (and its base) fresh into the clone, then check it out detached in a dedicated
 * worktree under the review cache. Re-running for the same PR re-fetches and fast-forwards the
 * existing worktree to the new head rather than re-creating it.
 */
export async function ensurePrWorktree(options: EnsureWorktreeOptions): Promise<PrWorktree> {
  const { cloneRoot, ownerRepo } = options.clone;
  await git(cloneRoot, "fetch", "origin", `pull/${options.prNumber}/head`);
  const headSha = await git(cloneRoot, "rev-parse", "FETCH_HEAD");
  await git(cloneRoot, "fetch", "origin", options.baseRefName);

  await mkdir(reviewWorktreesRoot(options.smithersHome), { recursive: true });
  const worktreePath = join(
    reviewWorktreesRoot(options.smithersHome),
    `${repoSlugForReview(ownerRepo)}-pr${options.prNumber}`,
  );

  if (existsSync(worktreePath)) {
    await git(worktreePath, "checkout", "--detach", "--force", headSha);
  } else {
    await git(cloneRoot, "worktree", "add", "--detach", worktreePath, headSha);
  }

  return { path: worktreePath, headSha, baseRef: `origin/${options.baseRefName}` };
}

/** Remove a review worktree. Best-effort: a failure here should not mask the review's outcome. */
export async function removeWorktree(clone: ResolvedClone, worktreePath: AbsolutePath): Promise<void> {
  await git(clone.cloneRoot, "worktree", "remove", "--force", worktreePath);
}
