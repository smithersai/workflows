import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ensureJjReady, jjGitInitColocate, jjPreflight } from "./jj";
import { runCaptured, runInherited } from "./process";
import {
  runWorkflow,
  smithersBin,
  stackAmendInput,
  stackBuildInput,
  stackPlanInput,
  stackPushInput,
} from "./smithers";
import {
  createStackMap,
  entriesForRepo,
  findEntryByBranch,
  findEntryByIssue,
  loadStackMap,
  parsePlanFile,
  planToEntries,
  repoKeys,
  repoSlugFor,
  resolveStackMapPath,
  saveStackMap,
  staleEntries,
  tipFor,
} from "./stack-map";
import type {
  AbsolutePath,
  FeatureName,
  JjPreflight,
  RepoConfig,
  RepoKey,
  RepoTriage,
  StackCounts,
  StackEntry,
  StackMap,
  TriageAction,
  TriageReport,
} from "./types";

/** What `xiv stack init` should do, decided purely from a jj preflight result. */
export type StackInitAction = "install-jj" | "already-colocated" | "colocate";

export function stackInitAction(preflight: JjPreflight): StackInitAction {
  if (!preflight.available) return "install-jj";
  if (preflight.isRepo) return "already-colocated";
  return "colocate";
}

export interface StackCommandContext {
  readonly smithersHome: AbsolutePath;
  readonly targetCwd: AbsolutePath;
  readonly feature: FeatureName;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function prCell(entry: StackEntry): string {
  if (entry.prNumber !== undefined) return `#${entry.prNumber}`;
  return "-";
}

/** Render a human-readable status table for a stack map, grouped by repo. Pure — the runner handles I/O. */
export function stackStatusReport(map: StackMap): string {
  const keys = repoKeys(map);
  const lines: string[] = [`Stack: ${map.feature}  (engine ${map.engine}, ${keys.length} repo${keys.length === 1 ? "" : "s"})`];
  for (const repo of keys) {
    const entries = entriesForRepo(map, repo);
    const config = map.repos[repo];
    const tip = tipFor(map, repo);
    const branchWidth = Math.max(6, ...entries.map((entry) => entry.branchName.length));
    const issueWidth = Math.max(5, ...entries.map((entry) => entry.issueId.length));
    lines.push("");
    lines.push(`repo ${repo}  (base ${config?.baseBranch ?? "main"}${config?.path !== undefined ? ` · ${config.path}` : ""})`);
    lines.push([pad("#", 3), pad("status", 12), pad("issue", issueWidth), pad("branch", branchWidth), "pr"].join("  "));
    for (const entry of entries) {
      lines.push(
        [
          pad(`${entry.position}`, 3),
          pad(entry.status, 12),
          pad(entry.issueId, issueWidth),
          pad(entry.branchName, branchWidth),
          prCell(entry),
        ].join("  "),
      );
    }
    lines.push(tip === "" ? "  tip: (not built yet)" : `  tip: ${tip}  (git checkout in ${config?.path ?? "?"})`);
  }
  const excluded = map.source.excluded ?? [];
  if (excluded.length > 0) {
    lines.push("");
    lines.push("excluded (part of the feature, not built):");
    for (const item of excluded) lines.push(`  ${item.issueId}  ${item.reason}`);
  }
  return lines.join("\n");
}

function countsOf(entries: readonly StackEntry[]): StackCounts {
  const counts = { pending: 0, implementing: 0, implemented: 0, pushed: 0, prOpen: 0, merged: 0 };
  for (const entry of entries) {
    if (entry.status === "pr-open") counts.prOpen += 1;
    else counts[entry.status] += 1;
  }
  return { ...counts, total: entries.length };
}

/** Phase + action for a single repo's substack. */
function repoTriage(map: StackMap, repo: RepoKey): RepoTriage {
  const entries = entriesForRepo(map, repo);
  const counts = countsOf(entries);
  const unbuilt = counts.pending + counts.implementing;
  const stale = staleEntries(map, repo);
  const inFlight = entries.find((entry) => entry.status === "implementing")?.issueId ?? null;

  let phase: RepoTriage["phase"];
  let action: TriageAction;
  if (stale.length > 0) {
    phase = "has-stale";
    action = "push";
  } else if (unbuilt > 0) {
    phase = "building";
    action = "build";
  } else if (counts.implemented > 0) {
    phase = "built-unpublished";
    action = "push";
  } else if (counts.merged === counts.total && counts.total > 0) {
    phase = "complete";
    action = "done";
  } else {
    phase = "publishing";
    action = "wait";
  }
  return { repo, phase, action, counts, inFlight, staleBranches: stale.map((entry) => entry.branchName), tip: tipFor(map, repo) };
}

// Most-urgent first, excluding "plan" (which is the no-map case handled by the runner).
const ACTION_PRIORITY: readonly TriageAction[] = ["build", "push", "wait", "done"];

function overallAction(repos: readonly RepoTriage[]): TriageAction {
  for (const action of ACTION_PRIORITY) {
    if (repos.some((repo) => repo.action === action)) return action;
  }
  return "done";
}

function hintForAction(action: TriageAction, repos: readonly RepoTriage[]): string {
  const which = repos.filter((repo) => repo.action === action).map((repo) => repo.repo).join(", ");
  switch (action) {
    case "build":
      return `Repos needing build: ${which}. Run \`xiv stack build --all-repos\` (resumes; builds repos in parallel).`;
    case "push":
      return `Repos with work to publish or re-sync: ${which}. Run \`xiv stack push --all-repos\` (or --repo <key> --count N).`;
    case "wait":
      return "All entries are published as open PRs. Nothing to do until they are reviewed and merged.";
    case "done":
      return "Every entry in every repo is merged. The feature is complete.";
    default:
      return "Run `xiv how-to` for the orchestration runbook.";
  }
}

/**
 * Derive a structured triage report from the stack map alone — deterministic and the same
 * every run, so a low-cost operator model can match `action` against a fixed decision table.
 * Reports an overall action plus a per-repo breakdown.
 */
export function stackTriage(map: StackMap): TriageReport {
  const repos = repoKeys(map).map((repo) => repoTriage(map, repo));
  const counts = countsOf(map.entries);
  const action = overallAction(repos);
  const unbuilt = counts.pending + counts.implementing;
  const staleTotal = repos.reduce((sum, repo) => sum + repo.staleBranches.length, 0);
  const summary = `${counts.merged + counts.pushed + counts.prOpen}/${counts.total} published, ${counts.implemented} built-unpublished, ${unbuilt} unbuilt${staleTotal > 0 ? `, ${staleTotal} stale` : ""} across ${repos.length} repo(s)`;

  return { feature: map.feature, action, counts, summary, hint: hintForAction(action, repos), repos };
}

async function requireStackMap(context: StackCommandContext): Promise<{ path: AbsolutePath; map: StackMap }> {
  const path = resolveStackMapPath(context.smithersHome, context.targetCwd, context.feature);
  const map = await loadStackMap(path);
  if (map === null) {
    throw new Error(`No stack map for feature "${context.feature}" at ${path}. Run \`xiv stack plan\` first.`);
  }
  return { path, map };
}

export async function runStackStatus(context: StackCommandContext): Promise<void> {
  const { map } = await requireStackMap(context);
  console.log(stackStatusReport(map));
}

export async function runStackInit(context: { readonly targetCwd: AbsolutePath }): Promise<void> {
  const preflight = await jjPreflight(context.targetCwd);
  switch (stackInitAction(preflight)) {
    case "install-jj":
      throw new Error(
        "jj (Jujutsu) is not installed. Install it with `brew install jj` (https://github.com/jj-vcs/jj), then run `xiv stack init` again.",
      );
    case "already-colocated":
      console.log(`jj already colocated in ${context.targetCwd} (jj ${preflight.version ?? "?"}). Repo is ready.`);
      return;
    case "colocate": {
      const result = await jjGitInitColocate(context.targetCwd);
      if (result.code !== 0) {
        throw new Error(`\`jj git init --colocate\` failed in ${context.targetCwd}:\n${result.stderr || result.stdout}`);
      }
      console.log(
        `jj ${preflight.version ?? ""} ready: ran \`jj git init --colocate\` in ${context.targetCwd} (.jj/ created next to .git/; reversible with \`rm -rf .jj\`).`,
      );
      return;
    }
  }
}

async function activeRunsDump(smithersHome: AbsolutePath): Promise<string> {
  const result = await runCaptured({ cmd: [smithersBin(smithersHome), "ps", "--all"], cwd: smithersHome });
  return result.code === 0 ? result.stdout.trim() : "";
}

export async function runStackTriage(
  context: StackCommandContext,
  options: { readonly json: boolean },
): Promise<void> {
  const path = resolveStackMapPath(context.smithersHome, context.targetCwd, context.feature);
  const map = await loadStackMap(path);
  const report: TriageReport =
    map === null
      ? {
          feature: context.feature,
          action: "plan",
          counts: { pending: 0, implementing: 0, implemented: 0, pushed: 0, prOpen: 0, merged: 0, total: 0 },
          summary: "no stack map yet",
          hint: `No stack map at ${path}. Run \`xiv stack plan <source> --feature ${context.feature}\` first.`,
          repos: [],
        }
      : stackTriage(map);

  const activeRuns = await activeRunsDump(context.smithersHome);

  if (options.json) {
    console.log(JSON.stringify({ ...report, activeRuns }, null, 2));
    return;
  }

  console.log(`Stack: ${report.feature}`);
  console.log(`Action: ${report.action}    ${report.summary}`);
  for (const repo of report.repos) {
    const flight = repo.inFlight !== null ? `, in-flight ${repo.inFlight}` : "";
    const stale = repo.staleBranches.length > 0 ? `, stale: ${repo.staleBranches.join(",")}` : "";
    console.log(`  ${repo.repo}: ${repo.phase} (${repo.action})${flight}${stale}`);
  }
  console.log(`\n${report.hint}`);
  if (activeRuns !== "") console.log(`\n--- smithers runs ---\n${activeRuns}`);
}

// --- Repo registry parsing + dispatch ------------------------------------

/**
 * Parse repeated `--repo key=path` flags into a repo registry, all sharing `base` as their trunk.
 * With no flags, defaults to a single-repo registry rooted at `cwd` (the today behavior).
 */
export function parseRepoArgs(
  repoArgs: readonly string[],
  base: string,
  cwd: AbsolutePath,
): Record<RepoKey, RepoConfig> {
  if (repoArgs.length === 0) {
    const key = sanitizeKey(basename(cwd)) || "default";
    return { [key]: { path: cwd, baseBranch: base } };
  }
  const repos: Record<RepoKey, RepoConfig> = {};
  for (const arg of repoArgs) {
    const eq = arg.indexOf("=");
    if (eq < 1) throw new Error(`--repo must be in the form key=path, got "${arg}".`);
    const key = arg.slice(0, eq);
    const path = arg.slice(eq + 1);
    if (path === "") throw new Error(`--repo ${key} has no path.`);
    repos[key] = { path: resolve(path), baseBranch: base };
  }
  return repos;
}

function sanitizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function repoConfigOrThrow(map: StackMap, repo: RepoKey): RepoConfig {
  const config = map.repos[repo];
  if (config === undefined) {
    throw new Error(`Repo "${repo}" is not in the stack map. Known repos: ${repoKeys(map).join(", ") || "(none)"}.`);
  }
  return config;
}

/** Resolve which single repo a command targets: an explicit key, or the sole repo, else error. */
function resolveSingleRepo(map: StackMap, repo: RepoKey | undefined): RepoKey {
  if (repo !== undefined) return repo;
  const keys = repoKeys(map);
  if (keys.length === 1) return keys[0] ?? "";
  throw new Error(`This is a multi-repo stack (${keys.join(", ")}). Pass --all-repos or --repo <key>.`);
}

export async function runStackPlan(
  context: StackCommandContext,
  options: { readonly source: string; readonly repos: Record<RepoKey, RepoConfig> },
): Promise<void> {
  await ensureJjReady(context.targetCwd);
  const path = resolveStackMapPath(context.smithersHome, context.targetCwd, context.feature);
  await runWorkflow({
    smithersHome: context.smithersHome,
    targetCwd: context.targetCwd,
    workflow: "stack-plan",
    input: stackPlanInput({
      source: options.source,
      feature: context.feature,
      repoSlug: repoSlugFor(context.targetCwd),
      repos: options.repos,
      stackMapPath: path,
    }),
  });
}

/**
 * Persist a fully-resolved plan (from the stack-plan skill) into a stack map — deterministic,
 * no agent. Excluded issues are recorded under source.excluded; never built, never lost.
 */
export async function runStackPlanFromFile(
  context: StackCommandContext,
  options: { readonly planPath: AbsolutePath; readonly repos: Record<RepoKey, RepoConfig> },
): Promise<void> {
  const plan = parsePlanFile(JSON.parse(await readFile(options.planPath, "utf8")));
  const entries = planToEntries(plan.order, options.repos);
  const path = resolveStackMapPath(context.smithersHome, context.targetCwd, context.feature);
  const map = createStackMap({
    feature: context.feature,
    repoSlug: repoSlugFor(context.targetCwd),
    repos: options.repos,
    source: {
      linearProjectId: plan.source?.linearProjectId,
      parentIssueId: plan.source?.parentIssueId,
      issueIds: plan.order.map((issue) => issue.issueId),
      excluded: plan.excluded,
    },
    entries,
  });
  await saveStackMap(path, map);
  const repoCount = Object.keys(options.repos).length;
  const excluded = plan.excluded?.length ?? 0;
  console.log(
    `Wrote stack map "${context.feature}": ${entries.length} entr(y/ies) across ${repoCount} repo(s)${excluded > 0 ? `, ${excluded} excluded` : ""}.\n  ${path}`,
  );
}

export async function runStackBuild(
  context: StackCommandContext,
  options: { readonly repo?: RepoKey; readonly allRepos: boolean; readonly detach: boolean },
): Promise<void> {
  const { path, map } = await requireStackMap(context);
  const targets = options.allRepos ? repoKeys(map) : [resolveSingleRepo(map, options.repo)];
  for (const repo of targets) {
    const config = repoConfigOrThrow(map, repo);
    await ensureJjReady(config.path);
    console.log(`build: ${repo} (${config.path})${options.allRepos ? " [detached]" : ""}`);
    await runWorkflow({
      smithersHome: context.smithersHome,
      targetCwd: config.path,
      workflow: "stack-build",
      input: stackBuildInput({ stackMapPath: path, repo }),
      detach: options.allRepos ? true : options.detach,
    });
  }
}

export async function runStackPush(
  context: StackCommandContext,
  options: { readonly repo?: RepoKey; readonly allRepos: boolean; readonly count: number },
): Promise<void> {
  const { path, map } = await requireStackMap(context);
  const targets = options.allRepos ? repoKeys(map) : [resolveSingleRepo(map, options.repo)];
  for (const repo of targets) {
    const config = repoConfigOrThrow(map, repo);
    await ensureJjReady(config.path);
    console.log(`push: ${repo} (${config.path})`);
    await runWorkflow({
      smithersHome: context.smithersHome,
      targetCwd: config.path,
      workflow: "stack-push",
      input: stackPushInput({ stackMapPath: path, count: options.count, repo }),
    });
  }
}

export async function runStackAmend(
  context: StackCommandContext,
  options: { readonly message: string; readonly target?: string; readonly repo?: RepoKey },
): Promise<void> {
  const { path, map } = await requireStackMap(context);
  const repo = resolveAmendRepo(map, options.repo, options.target);
  const config = repoConfigOrThrow(map, repo);
  await ensureJjReady(config.path);
  await runWorkflow({
    smithersHome: context.smithersHome,
    targetCwd: config.path,
    workflow: "stack-amend",
    input: stackAmendInput({ stackMapPath: path, message: options.message, target: options.target, repo }),
  });
}

/** Pick the repo to amend: explicit --repo, else the --target entry's repo, else the sole repo, else error. */
function resolveAmendRepo(map: StackMap, repo: RepoKey | undefined, target: string | undefined): RepoKey {
  if (repo !== undefined) return repo;
  if (target !== undefined) {
    const entry = findEntryByIssue(map, target) ?? findEntryByBranch(map, target);
    if (entry !== undefined) return entry.repo;
  }
  const keys = repoKeys(map);
  if (keys.length === 1) return keys[0] ?? "";
  throw new Error(`This is a multi-repo stack (${keys.join(", ")}). Pass --target <issue|branch> or --repo <key>.`);
}

export async function runStackPreview(context: StackCommandContext): Promise<void> {
  const { map } = await requireStackMap(context);
  const keys = repoKeys(map);
  if (keys.every((repo) => tipFor(map, repo) === "")) {
    throw new Error(`Stack "${context.feature}" has no built repos yet. Run \`xiv stack build\` before previewing.`);
  }
  for (const repo of keys) {
    const tip = tipFor(map, repo);
    const config = map.repos[repo];
    if (tip === "" || config === undefined) {
      console.log(`skip ${repo}: not built yet`);
      continue;
    }
    console.log(`${repo}: git checkout ${tip} (${config.path})`);
    await runInherited({ cmd: ["git", "checkout", tip], cwd: config.path });
  }
}
