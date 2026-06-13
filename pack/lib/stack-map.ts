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

export const stackMapSchema = z.object({
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

export type StackStatus = z.infer<typeof stackStatusSchema>;
export type StackEntry = z.infer<typeof stackEntrySchema>;
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
  readonly baseBranch: string;
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

export function entriesInOrder(map: StackMap): StackEntry[] {
  return sortByPosition(map.entries);
}

export function previousEntry(map: StackMap, entry: StackEntry): StackEntry | undefined {
  return entriesInOrder(map)
    .filter((candidate) => candidate.position < entry.position)
    .at(-1);
}

export function baseBranchFor(map: StackMap, entry: StackEntry): string {
  return previousEntry(map, entry)?.branchName ?? map.baseBranch;
}

export function descendantsOf(map: StackMap, entry: StackEntry): StackEntry[] {
  return entriesInOrder(map).filter((candidate) => candidate.position > entry.position);
}

const UNBUILT: ReadonlySet<StackStatus> = new Set<StackStatus>(["pending", "implementing"]);

export function nextUnbuiltEntry(map: StackMap): StackEntry | undefined {
  return entriesInOrder(map).find((entry) => UNBUILT.has(entry.status));
}

export function findEntryByIssue(map: StackMap, issueId: string): StackEntry | undefined {
  return map.entries.find((entry) => entry.issueId === issueId);
}

export function findEntryByBranch(map: StackMap, branch: string): StackEntry | undefined {
  return map.entries.find((entry) => entry.branchName === branch);
}

const PUBLISHED: ReadonlySet<StackStatus> = new Set<StackStatus>(["pushed", "pr-open", "merged"]);

/**
 * The lowest contiguous run of built-but-unpublished entries to publish next, capped at `count`.
 * Publishing stays contiguous from the bottom so a PR never opens against an unpushed base.
 */
export function entriesToPush(map: StackMap, count: number): StackEntry[] {
  const batch: StackEntry[] = [];
  for (const entry of entriesInOrder(map)) {
    if (PUBLISHED.has(entry.status)) continue;
    if (entry.status !== "implemented") break;
    batch.push(entry);
    if (batch.length >= count) break;
  }
  return batch;
}

/** The base branch a new PR for `entry` should target: the previous entry's branch, or the stack base if that entry is merged/absent. */
export function prBaseFor(map: StackMap, entry: StackEntry): string {
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

export function setTipBranch(map: StackMap, tipBranch: string): StackMap {
  return { ...map, tipBranch };
}
