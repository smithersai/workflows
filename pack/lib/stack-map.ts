// Self-contained stack-map read/write for the workflow half of the repo.
// Mirrors the JSON shape of `src/stack-map.ts` (the CLI half). The two are kept
// honest by `test/stack-map-contract.test.ts`, which feeds both the same fixture
// and asserts identical parse results — so they can never silently drift.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod/v4";

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

const stackFeatureSourceSchema = z.object({
  linearProjectId: z.string().optional(),
  parentIssueId: z.string().optional(),
  issueIds: z.array(z.string()).default([]),
  excluded: z.array(z.object({ issueId: z.string(), reason: z.string().default("") })).optional(),
});

export const stackMapSchema = z.object({
  version: z.literal(1),
  feature: z.string(),
  repoSlug: z.string(),
  repos: z.record(z.string(), repoConfigSchema).default({}),
  tips: z.record(z.string(), z.string()).default({}),
  engine: stackEngineSchema.default("jj"),
  source: stackFeatureSourceSchema,
  entries: z.array(stackEntrySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StackStatus = z.infer<typeof stackStatusSchema>;
export type StackEntry = z.infer<typeof stackEntrySchema>;
export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type StackMap = z.infer<typeof stackMapSchema>;

export function parseStackMap(raw: unknown): StackMap {
  return stackMapSchema.parse(raw);
}

export async function loadStackMap(path: string): Promise<StackMap | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return parseStackMap(JSON.parse(raw));
}

/** Synchronous load for use inside a workflow's render function (which must be synchronous). */
export function loadStackMapSync(path: string): StackMap | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return parseStackMap(JSON.parse(raw));
}

export async function saveStackMap(path: string, map: StackMap, now: Date = new Date()): Promise<void> {
  const stamped: StackMap = { ...map, updatedAt: now.toISOString() };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stamped, null, 2) + "\n");
}

export interface CreateStackMapOptions {
  readonly feature: string;
  readonly repoSlug: string;
  readonly repos: Record<string, RepoConfig>;
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
    source: options.source,
    entries: sortByPosition(options.entries),
    createdAt: iso,
    updatedAt: iso,
  };
}

function sortByPosition(entries: readonly StackEntry[]): StackEntry[] {
  return [...entries].sort((a, b) => a.position - b.position);
}

export function entriesInOrder(map: StackMap): StackEntry[] {
  return sortByPosition(map.entries);
}

/** The repo keys this feature spans, in a stable order. */
export function repoKeys(map: StackMap): string[] {
  return Object.keys(map.repos).sort();
}

/** Entries belonging to one repo's substack, in stack (position) order. */
export function entriesForRepo(map: StackMap, repo: string): StackEntry[] {
  return entriesInOrder(map).filter((entry) => entry.repo === repo);
}

/** Trunk branch for a repo (its substack base). */
export function repoBaseBranch(map: StackMap, repo: string): string {
  return map.repos[repo]?.baseBranch ?? "main";
}

/** The entry immediately below `entry` in its repo's substack, or undefined for that repo's bottom. */
export function previousEntry(map: StackMap, entry: StackEntry): StackEntry | undefined {
  return entriesForRepo(map, entry.repo)
    .filter((candidate) => candidate.position < entry.position)
    .at(-1);
}

/** The branch `entry` stacks on: the previous SAME-REPO entry's branch, or the repo's trunk. */
export function baseBranchFor(map: StackMap, entry: StackEntry): string {
  return previousEntry(map, entry)?.branchName ?? repoBaseBranch(map, entry.repo);
}

/** All entries above `entry` in the same repo (its descendants), in stack order. */
export function descendantsOf(map: StackMap, entry: StackEntry): StackEntry[] {
  return entriesForRepo(map, entry.repo).filter((candidate) => candidate.position > entry.position);
}

const UNBUILT: ReadonlySet<StackStatus> = new Set<StackStatus>(["pending", "implementing"]);
const PUBLISHED: ReadonlySet<StackStatus> = new Set<StackStatus>(["pushed", "pr-open", "merged"]);

/** The next entry to build, optionally within one repo: the lowest-position entry not yet implemented. */
export function nextUnbuiltEntry(map: StackMap, repo?: string): StackEntry | undefined {
  const entries = repo === undefined ? entriesInOrder(map) : entriesForRepo(map, repo);
  return entries.find((entry) => UNBUILT.has(entry.status));
}

export function findEntryByIssue(map: StackMap, issueId: string): StackEntry | undefined {
  return map.entries.find((entry) => entry.issueId === issueId);
}

export function findEntryByBranch(map: StackMap, branch: string): StackEntry | undefined {
  return map.entries.find((entry) => entry.branchName === branch);
}

/** The lowest contiguous run of built-but-unpublished entries in ONE repo to publish next, capped at `count`. */
export function entriesToPush(map: StackMap, repo: string, count: number): StackEntry[] {
  const batch: StackEntry[] = [];
  for (const entry of entriesForRepo(map, repo)) {
    if (PUBLISHED.has(entry.status)) continue;
    if (entry.status !== "implemented") break;
    batch.push(entry);
    if (batch.length >= count) break;
  }
  return batch;
}

/** The base branch a new PR for `entry` should target: the previous same-repo entry's branch, or the repo trunk if merged/absent. */
export function prBaseFor(map: StackMap, entry: StackEntry): string {
  const prev = previousEntry(map, entry);
  return prev !== undefined && prev.status !== "merged" ? prev.branchName : repoBaseBranch(map, entry.repo);
}

/** Open PRs whose branch was re-flowed since it was last pushed, optionally within one repo. */
export function staleEntries(map: StackMap, repo?: string): StackEntry[] {
  const entries = repo === undefined ? entriesInOrder(map) : entriesForRepo(map, repo);
  return entries.filter(
    (entry) =>
      (entry.status === "pr-open" || entry.status === "pushed") && entry.headSha !== (entry.pushedSha ?? ""),
  );
}

export function updateEntry(
  map: StackMap,
  issueId: string,
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
export function tipFor(map: StackMap, repo: string): string {
  return map.tips[repo] ?? "";
}

export function setTip(map: StackMap, repo: string, branch: string): StackMap {
  return { ...map, tips: { ...map.tips, [repo]: branch } };
}
