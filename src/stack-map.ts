import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { z } from "zod";
import { stackMapPath } from "./paths";
import type {
  AbsolutePath,
  BranchName,
  FeatureName,
  IssueId,
  PlanFile,
  PlannedIssue,
  RepoConfig,
  RepoKey,
  RepoSlug,
  StackEntry,
  StackMap,
  StackPosition,
  StackStatus,
} from "./types";

const stackStatusSchema = z.enum([
  "pending",
  "implementing",
  "implemented",
  "pushed",
  "pr-open",
  "merged",
]);

const stackEngineSchema = z.enum(["jj"]);

const stackEntrySchema = z.object({
  position: z.number().int().nonnegative(),
  issueId: z.string(),
  issueTitle: z.string().default(""),
  repo: z.string(),
  branchName: z.string(),
  changeId: z.string().default(""),
  baseBranch: z.string(),
  headSha: z.string().default(""),
  status: stackStatusSchema.default("pending"),
  prNumber: z.number().int().optional(),
  prUrl: z.string().optional(),
  pushedSha: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

const repoConfigSchema = z.object({
  path: z.string(),
  baseBranch: z.string().default("main"),
  remote: z.string().optional(),
});

const excludedIssueSchema = z.object({
  issueId: z.string(),
  reason: z.string().default(""),
});

const stackFeatureSourceSchema = z.object({
  linearProjectId: z.string().optional(),
  parentIssueId: z.string().optional(),
  issueIds: z.array(z.string()).default([]),
  excluded: z.array(excludedIssueSchema).optional(),
});

const planFileSchema = z.object({
  order: z
    .array(z.object({ issueId: z.string(), title: z.string().optional(), repo: z.string() }))
    .default([]),
  excluded: z.array(excludedIssueSchema).optional(),
  source: z.object({ linearProjectId: z.string().optional(), parentIssueId: z.string().optional() }).optional(),
});

const stackMapSchema = z.object({
  version: z.literal(1),
  feature: z.string(),
  repoSlug: z.string(),
  repos: z.record(z.string(), repoConfigSchema).default({}),
  tips: z.record(z.string(), z.string()).default({}),
  engine: stackEngineSchema.default("jj"),
  skipAcceptanceReview: z.boolean().optional(),
  source: stackFeatureSourceSchema,
  entries: z.array(stackEntrySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Validate unknown JSON into a StackMap. Throws (ZodError) on malformed data.
 * The explicit return type makes tsc enforce that the schema's inferred shape
 * stays assignable to the canonical StackMap interface in types.ts.
 */
export function parseStackMap(raw: unknown): StackMap {
  return stackMapSchema.parse(raw);
}

/** Validate a resolved plan file (produced by the stack-plan skill). Throws on malformed data. */
export function parsePlanFile(raw: unknown): PlanFile {
  return planFileSchema.parse(raw);
}

/** Deterministic branch (jj bookmark) name for an issue — mirrors linear-implement's convention. */
export function branchFor(issueId: IssueId): BranchName {
  return `feat/${issueId.toLowerCase()}`;
}

/**
 * Turn an ordered, repo-assigned issue list into stack entries, computing each entry's base as the
 * previous SAME-REPO entry's branch (or that repo's trunk). Unknown repo keys fall back to the first.
 */
export function planToEntries(
  order: readonly PlannedIssue[],
  repos: Record<RepoKey, RepoConfig>,
): StackEntry[] {
  const fallback = Object.keys(repos)[0] ?? "default";
  const lastBranchByRepo: Record<RepoKey, BranchName> = {};
  return order.map((issue, index) => {
    const repo = repos[issue.repo] !== undefined ? issue.repo : fallback;
    const branch = branchFor(issue.issueId);
    const base = lastBranchByRepo[repo] ?? repos[repo]?.baseBranch ?? "main";
    lastBranchByRepo[repo] = branch;
    return {
      position: index,
      issueId: issue.issueId,
      issueTitle: issue.title ?? "",
      repo,
      branchName: branch,
      changeId: "",
      baseBranch: base,
      headSha: "",
      status: "pending",
    };
  });
}

/**
 * Derive a filesystem-safe, collision-resistant slug for a target repo.
 * Combines the repo directory name with a short hash of its absolute path so two
 * repos that share a basename never clobber each other's stack maps.
 */
export function repoSlugFor(targetCwd: AbsolutePath): RepoSlug {
  const name = sanitizeSegment(basename(targetCwd)) || "repo";
  const digest = createHash("sha256").update(targetCwd).digest("hex").slice(0, 8);
  return `${name}-${digest}`;
}

/** Lower-case and collapse anything that is not alphanumeric to a single dash. */
export function slugifyFeature(feature: string): FeatureName {
  const slug = sanitizeSegment(feature);
  if (slug === "") throw new Error(`Feature name "${feature}" has no usable characters for a filename.`);
  return slug;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveStackMapPath(smithersHome: AbsolutePath, feature: string): AbsolutePath {
  return stackMapPath(smithersHome, slugifyFeature(feature));
}

/** Read and validate a stack map. Returns null when the file does not exist. */
export async function loadStackMap(path: AbsolutePath): Promise<StackMap | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return parseStackMap(JSON.parse(raw));
}

/** Persist a stack map, stamping `updatedAt`. Creates parent directories as needed. */
export async function saveStackMap(path: AbsolutePath, map: StackMap, now: Date = new Date()): Promise<void> {
  const stamped: StackMap = { ...map, updatedAt: now.toISOString() };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stamped, null, 2) + "\n");
}

export interface CreateStackMapOptions {
  readonly feature: FeatureName;
  readonly repoSlug: RepoSlug;
  readonly repos: Record<RepoKey, RepoConfig>;
  /** Record "build without the local acceptance-review step" as the feature-level default. */
  readonly skipAcceptanceReview?: boolean;
  readonly source: StackMap["source"];
  readonly entries: readonly StackEntry[];
}

export function createStackMap(options: CreateStackMapOptions, now: Date = new Date()): StackMap {
  const iso = now.toISOString();
  return {
    version: 1,
    feature: options.feature,
    repoSlug: options.repoSlug,
    repos: options.repos,
    tips: {},
    engine: "jj",
    // Only materialize the key when set, so existing maps round-trip byte-identically.
    ...(options.skipAcceptanceReview === true ? { skipAcceptanceReview: true } : {}),
    source: options.source,
    entries: sortByPosition(options.entries),
    createdAt: iso,
    updatedAt: iso,
  };
}

function sortByPosition(entries: readonly StackEntry[]): StackEntry[] {
  return [...entries].sort((a, b) => a.position - b.position);
}

// --- Pure queries --------------------------------------------------------

export function entriesInOrder(map: StackMap): StackEntry[] {
  return sortByPosition(map.entries);
}

/** The repo keys this feature spans, in a stable order. */
export function repoKeys(map: StackMap): RepoKey[] {
  return Object.keys(map.repos).sort();
}

/** Entries belonging to one repo's substack, in stack (position) order. */
export function entriesForRepo(map: StackMap, repo: RepoKey): StackEntry[] {
  return entriesInOrder(map).filter((entry) => entry.repo === repo);
}

/** Trunk branch for a repo (its substack base). */
export function repoBaseBranch(map: StackMap, repo: RepoKey): BranchName {
  return map.repos[repo]?.baseBranch ?? "main";
}

export function findEntryByIssue(map: StackMap, issueId: IssueId): StackEntry | undefined {
  return map.entries.find((entry) => entry.issueId === issueId);
}

export function findEntryByBranch(map: StackMap, branch: BranchName): StackEntry | undefined {
  return map.entries.find((entry) => entry.branchName === branch);
}

export function findEntryByPosition(map: StackMap, position: StackPosition): StackEntry | undefined {
  return map.entries.find((entry) => entry.position === position);
}

/** The entry immediately below `entry` in its repo's substack, or undefined for that repo's bottom. */
export function previousEntry(map: StackMap, entry: StackEntry): StackEntry | undefined {
  return entriesForRepo(map, entry.repo)
    .filter((candidate) => candidate.position < entry.position)
    .at(-1);
}

/** The branch `entry` stacks on: the previous SAME-REPO entry's branch, or the repo's trunk. */
export function baseBranchFor(map: StackMap, entry: StackEntry): BranchName {
  return previousEntry(map, entry)?.branchName ?? repoBaseBranch(map, entry.repo);
}

/** All entries above `entry` in the same repo (its descendants), in stack order. */
export function descendantsOf(map: StackMap, entry: StackEntry): StackEntry[] {
  return entriesForRepo(map, entry.repo).filter((candidate) => candidate.position > entry.position);
}

const UNBUILT: ReadonlySet<StackStatus> = new Set<StackStatus>(["pending", "implementing"]);
const PUBLISHED: ReadonlySet<StackStatus> = new Set<StackStatus>(["pushed", "pr-open", "merged"]);

/** The next entry to build, optionally within one repo: the lowest-position entry not yet implemented. */
export function nextUnbuiltEntry(map: StackMap, repo?: RepoKey): StackEntry | undefined {
  const entries = repo === undefined ? entriesInOrder(map) : entriesForRepo(map, repo);
  return entries.find((entry) => UNBUILT.has(entry.status));
}

/**
 * The lowest contiguous run of built-but-unpublished entries in ONE repo to publish next, capped at
 * `count`. Stays contiguous from the bottom of that repo's substack so a PR never opens against an
 * unpushed base.
 */
export function entriesToPush(map: StackMap, repo: RepoKey, count: number): StackEntry[] {
  const batch: StackEntry[] = [];
  for (const entry of entriesForRepo(map, repo)) {
    if (PUBLISHED.has(entry.status)) continue;
    if (entry.status !== "implemented") break; // hit an unbuilt entry: cannot publish past it
    batch.push(entry);
    if (batch.length >= count) break;
  }
  return batch;
}

/** The base branch a new PR for `entry` should target: the previous same-repo entry's branch, or the repo trunk if that entry is merged/absent. */
export function prBaseFor(map: StackMap, entry: StackEntry): BranchName {
  const prev = previousEntry(map, entry);
  return prev !== undefined && prev.status !== "merged" ? prev.branchName : repoBaseBranch(map, entry.repo);
}

/** Open PRs whose branch was re-flowed since it was last pushed (headSha drifted from pushedSha), optionally within one repo. */
export function staleEntries(map: StackMap, repo?: RepoKey): StackEntry[] {
  const entries = repo === undefined ? entriesInOrder(map) : entriesForRepo(map, repo);
  return entries.filter(
    (entry) =>
      (entry.status === "pr-open" || entry.status === "pushed") && entry.headSha !== (entry.pushedSha ?? ""),
  );
}

// --- Pure updates (return a new map) -------------------------------------

export function updateEntry(
  map: StackMap,
  issueId: IssueId,
  patch: Partial<Omit<StackEntry, "issueId" | "position">>,
): StackMap {
  let matched = false;
  const entries = map.entries.map((entry) => {
    if (entry.issueId !== issueId) return entry;
    matched = true;
    return { ...entry, ...patch };
  });
  if (!matched) throw new Error(`No stack entry for issue "${issueId}" in feature "${map.feature}".`);
  return { ...map, entries };
}

/** The tip branch for a repo's substack (empty until that repo has built at least once). */
export function tipFor(map: StackMap, repo: RepoKey): BranchName {
  return map.tips[repo] ?? "";
}

export function setTip(map: StackMap, repo: RepoKey, branch: BranchName): StackMap {
  return { ...map, tips: { ...map.tips, [repo]: branch } };
}
