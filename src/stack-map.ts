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
  branchName: z.string(),
  changeId: z.string().default(""),
  baseBranch: z.string(),
  headSha: z.string().default(""),
  status: stackStatusSchema.default("pending"),
  prNumber: z.number().int().optional(),
  prUrl: z.string().optional(),
  pushedSha: z.string().optional(),
});

const stackFeatureSourceSchema = z.object({
  linearProjectId: z.string().optional(),
  parentIssueId: z.string().optional(),
  issueIds: z.array(z.string()).default([]),
});

const stackMapSchema = z.object({
  version: z.literal(1),
  feature: z.string(),
  repoSlug: z.string(),
  baseBranch: z.string().default("main"),
  tipBranch: z.string().default(""),
  engine: stackEngineSchema.default("jj"),
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

export function resolveStackMapPath(
  smithersHome: AbsolutePath,
  targetCwd: AbsolutePath,
  feature: string,
): AbsolutePath {
  return stackMapPath(smithersHome, repoSlugFor(targetCwd), slugifyFeature(feature));
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
  readonly baseBranch: BranchName;
  readonly source: StackMap["source"];
  readonly entries: readonly StackEntry[];
}

export function createStackMap(options: CreateStackMapOptions, now: Date = new Date()): StackMap {
  const iso = now.toISOString();
  return {
    version: 1,
    feature: options.feature,
    repoSlug: options.repoSlug,
    baseBranch: options.baseBranch,
    tipBranch: "",
    engine: "jj",
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

export function findEntryByIssue(map: StackMap, issueId: IssueId): StackEntry | undefined {
  return map.entries.find((entry) => entry.issueId === issueId);
}

export function findEntryByBranch(map: StackMap, branch: BranchName): StackEntry | undefined {
  return map.entries.find((entry) => entry.branchName === branch);
}

export function findEntryByPosition(map: StackMap, position: StackPosition): StackEntry | undefined {
  return map.entries.find((entry) => entry.position === position);
}

/** The entry immediately below `entry` in the stack, or undefined for the bottom entry. */
export function previousEntry(map: StackMap, entry: StackEntry): StackEntry | undefined {
  return entriesInOrder(map)
    .filter((candidate) => candidate.position < entry.position)
    .at(-1);
}

/** The branch `entry` should be stacked on: the previous entry's branch, or the stack base. */
export function baseBranchFor(map: StackMap, entry: StackEntry): BranchName {
  return previousEntry(map, entry)?.branchName ?? map.baseBranch;
}

/** All entries above `entry` (its descendants), in stack order. */
export function descendantsOf(map: StackMap, entry: StackEntry): StackEntry[] {
  return entriesInOrder(map).filter((candidate) => candidate.position > entry.position);
}

const UNBUILT: ReadonlySet<StackStatus> = new Set<StackStatus>(["pending", "implementing"]);
const PUBLISHED: ReadonlySet<StackStatus> = new Set<StackStatus>(["pushed", "pr-open", "merged"]);

/** The next entry to build: the lowest-position entry not yet implemented. */
export function nextUnbuiltEntry(map: StackMap): StackEntry | undefined {
  return entriesInOrder(map).find((entry) => UNBUILT.has(entry.status));
}

/**
 * The lowest contiguous run of built-but-unpublished entries to publish next, capped at `count`.
 * Publishing must stay contiguous from the bottom: an entry is only eligible once every entry
 * below it is already published, so a PR never opens against an unpushed base.
 */
export function entriesToPush(map: StackMap, count: number): StackEntry[] {
  const ordered = entriesInOrder(map);
  const batch: StackEntry[] = [];
  for (const entry of ordered) {
    if (PUBLISHED.has(entry.status)) continue;
    if (entry.status !== "implemented") break; // hit an unbuilt entry: cannot publish past it
    batch.push(entry);
    if (batch.length >= count) break;
  }
  return batch;
}

/** The base branch a new PR for `entry` should target: the previous entry's branch, or the stack base if that entry is merged/absent. */
export function prBaseFor(map: StackMap, entry: StackEntry): BranchName {
  const prev = previousEntry(map, entry);
  return prev !== undefined && prev.status !== "merged" ? prev.branchName : map.baseBranch;
}

/** Open PRs whose branch was re-flowed since it was last pushed (headSha drifted from pushedSha). */
export function staleEntries(map: StackMap): StackEntry[] {
  return entriesInOrder(map).filter(
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

export function setTipBranch(map: StackMap, tipBranch: BranchName): StackMap {
  return { ...map, tipBranch };
}
