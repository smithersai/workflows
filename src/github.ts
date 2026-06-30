import { capture as captureProcess, runCaptured } from "./process";
import type {
  AbsolutePath,
  DiffLineMap,
  OwnerRepo,
  PullRequestDetail,
  PullRequestNumber,
  PullRequestSummary,
  RelativePath,
  ReviewSubmission,
} from "./types";

/** Run a command in `cwd`, returning trimmed stdout (throws with stderr context on failure). */
function capture(cmd: readonly string[], cwd: AbsolutePath): Promise<string> {
  return captureProcess({ cmd, cwd, env: process.env });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function authorLogin(value: unknown): string {
  if (isRecord(value) && typeof value.login === "string") return value.login;
  return "";
}

/** The `owner/name` of the repo containing `cwd`, or null if cwd is not a recognized GitHub repo. */
export async function detectOwnerRepo(cwd: AbsolutePath): Promise<OwnerRepo | null> {
  const result = await runCaptured({
    cmd: ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    cwd,
    env: process.env,
  });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/** The PR number for the current branch in `cwd`, or null if the branch has no open PR. */
export async function currentBranchPrNumber(cwd: AbsolutePath): Promise<PullRequestNumber | null> {
  const result = await runCaptured({
    cmd: ["gh", "pr", "view", "--json", "number", "-q", ".number"],
    cwd,
    env: process.env,
  });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** The git working-tree root that contains `cwd`, or null if cwd is not inside a git repo. */
export async function gitToplevel(cwd: AbsolutePath): Promise<AbsolutePath | null> {
  const result = await runCaptured({ cmd: ["git", "rev-parse", "--show-toplevel"], cwd, env: process.env });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/** Open (including draft) PRs for `ownerRepo`, as the picker source. */
export async function listOpenPullRequests(cwd: AbsolutePath, ownerRepo: OwnerRepo): Promise<PullRequestSummary[]> {
  const json = await capture(
    [
      "gh", "pr", "list", "-R", ownerRepo, "--state", "open", "--limit", "100",
      "--json", "number,title,author,isDraft,headRefName,headRefOid,additions,deletions",
    ],
    cwd,
  );
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry): PullRequestSummary => {
    const row: Record<string, unknown> = isRecord(entry) ? entry : {};
    return {
      number: asNumber(row.number),
      title: asString(row.title),
      author: authorLogin(row.author),
      isDraft: row.isDraft === true,
      headRefName: asString(row.headRefName),
      headRefOid: asString(row.headRefOid),
      additions: asNumber(row.additions),
      deletions: asNumber(row.deletions),
    };
  });
}

/** Detail for one PR needed to seed the review prompt. */
export async function getPullRequest(
  cwd: AbsolutePath,
  ownerRepo: OwnerRepo,
  prNumber: PullRequestNumber,
): Promise<PullRequestDetail> {
  const json = await capture(
    [
      "gh", "pr", "view", String(prNumber), "-R", ownerRepo,
      "--json", "number,title,author,body,baseRefName,headRefName,headRefOid",
    ],
    cwd,
  );
  const parsed: unknown = JSON.parse(json);
  const row: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    author: authorLogin(row.author),
    body: asString(row.body),
    baseRefName: asString(row.baseRefName),
    headRefName: asString(row.headRefName),
    headRefOid: asString(row.headRefOid),
  };
}

/**
 * Parse a unified diff into the set of RIGHT-side line numbers per file that GitHub will accept an
 * inline comment on (added lines plus context lines inside changed hunks). Findings anchored outside
 * this set get demoted to the summary instead of failing the review submission. Pure and testable.
 */
export function parseDiffLineMap(diff: string): DiffLineMap {
  const map = new Map<RelativePath, Set<number>>();
  let currentPath: RelativePath | null = null;
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      currentPath = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (currentPath !== null && !map.has(currentPath)) map.set(currentPath, new Set<number>());
      inHunk = false;
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git ") || raw.startsWith("index ")) {
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk !== null && hunk[1] !== undefined) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || currentPath === null) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const marker = raw.charAt(0);
    if (marker === "-") continue; // removed line: not on the new side
    if (marker === "+" || marker === " ") {
      map.get(currentPath)?.add(newLine);
      newLine += 1;
    }
  }
  return map;
}

/**
 * Fetch `gh pr diff <n>` and parse it into a per-file map of commentable RIGHT-side line numbers.
 */
export async function getDiffLineMap(
  cwd: AbsolutePath,
  ownerRepo: OwnerRepo,
  prNumber: PullRequestNumber,
): Promise<DiffLineMap> {
  const diff = await capture(["gh", "pr", "diff", String(prNumber), "-R", ownerRepo], cwd);
  return parseDiffLineMap(diff);
}

/**
 * Submit a review via `POST /repos/{owner}/{name}/pulls/{n}/reviews`. The payload is written to
 * `payloadPath` (runCaptured ignores stdin, so a file is used rather than `--input -`). Returns the
 * created review's html_url.
 */
export async function submitReview(
  cwd: AbsolutePath,
  ownerRepo: OwnerRepo,
  prNumber: PullRequestNumber,
  submission: ReviewSubmission,
  payloadPath: AbsolutePath,
): Promise<string> {
  await Bun.write(payloadPath, JSON.stringify(submission));
  return capture(
    [
      "gh", "api", "--method", "POST",
      `repos/${ownerRepo}/pulls/${prNumber}/reviews`,
      "--input", payloadPath, "-q", ".html_url",
    ],
    cwd,
  );
}
