import { jjGitInitColocate, jjPreflight } from "./jj";
import { runCaptured, runInherited } from "./process";
import { smithersBin } from "./smithers";
import { entriesInOrder, loadStackMap, resolveStackMapPath, staleEntries } from "./stack-map";
import type {
  AbsolutePath,
  FeatureName,
  JjPreflight,
  StackCounts,
  StackEntry,
  StackMap,
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

/** Render a human-readable status table for a stack map. Pure — the runner handles I/O. */
export function stackStatusReport(map: StackMap): string {
  const entries = entriesInOrder(map);
  const header = `Stack: ${map.feature}  (${entries.length} ${entries.length === 1 ? "entry" : "entries"}, engine ${map.engine}, base ${map.baseBranch})`;
  const branchWidth = Math.max(6, ...entries.map((entry) => entry.branchName.length));
  const issueWidth = Math.max(5, ...entries.map((entry) => entry.issueId.length));
  const rows = entries.map((entry) =>
    [
      pad(`${entry.position}`, 3),
      pad(entry.status, 12),
      pad(entry.issueId, issueWidth),
      pad(entry.branchName, branchWidth),
      prCell(entry),
    ].join("  "),
  );
  const columns = [pad("#", 3), pad("status", 12), pad("issue", issueWidth), pad("branch", branchWidth), "pr"].join("  ");
  const tip =
    map.tipBranch === ""
      ? "tip: (not built yet — run `xiv stack build`)"
      : `tip: ${map.tipBranch}  (\`git checkout ${map.tipBranch}\` to preview the whole feature)`;
  return [header, "", columns, ...rows, "", tip].join("\n");
}

function countsOf(map: StackMap): StackCounts {
  const counts = { pending: 0, implementing: 0, implemented: 0, pushed: 0, prOpen: 0, merged: 0 };
  for (const entry of map.entries) {
    if (entry.status === "pr-open") counts.prOpen += 1;
    else counts[entry.status] += 1;
  }
  return { ...counts, total: map.entries.length };
}

/**
 * Derive a structured triage report from the stack map alone — deterministic and the same
 * every run, so a low-cost operator model can match `action` against a fixed decision table.
 */
export function stackTriage(map: StackMap): TriageReport {
  const counts = countsOf(map);
  const unbuilt = counts.pending + counts.implementing;
  const stale = staleEntries(map);
  const staleBranches = stale.map((entry) => entry.branchName);
  const inFlight = entriesInOrder(map).find((entry) => entry.status === "implementing")?.issueId ?? null;

  let phase: TriageReport["phase"];
  let action: TriageReport["action"];
  let hint: string;
  if (stale.length > 0) {
    phase = "has-stale";
    action = "push";
    hint = `${stale.length} open PR(s) were re-flowed by an amend and are stale. Run \`xiv stack push\` to force-push and re-request review.`;
  } else if (unbuilt > 0) {
    phase = "building";
    action = "build";
    hint = `${unbuilt} entr(y/ies) still need building. Run \`xiv stack build\` (it resumes — already-built entries are skipped).`;
  } else if (counts.implemented > 0) {
    phase = "built-unpublished";
    action = "push";
    hint = `${counts.implemented} built entr(y/ies) are not yet published. Run \`xiv stack push --count N\` to open them as stacked PRs.`;
  } else if (counts.merged === counts.total && counts.total > 0) {
    phase = "complete";
    action = "done";
    hint = "Every entry is merged. The stack is complete.";
  } else {
    phase = "publishing";
    action = "wait";
    hint = "All entries are published as open PRs. Nothing to do until they are reviewed and merged.";
  }

  const summary = `${counts.merged + counts.pushed + counts.prOpen}/${counts.total} published, ${counts.implemented} built-unpublished, ${unbuilt} unbuilt${stale.length > 0 ? `, ${stale.length} stale` : ""}`;

  return {
    feature: map.feature,
    phase,
    action,
    counts,
    inFlight,
    staleBranches,
    tipBranch: map.tipBranch,
    summary,
    hint,
  };
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
          phase: "needs-plan",
          action: "plan",
          counts: { pending: 0, implementing: 0, implemented: 0, pushed: 0, prOpen: 0, merged: 0, total: 0 },
          inFlight: null,
          staleBranches: [],
          tipBranch: "",
          summary: "no stack map yet",
          hint: `No stack map at ${path}. Run \`xiv stack plan <source> --feature ${context.feature}\` first.`,
        }
      : stackTriage(map);

  const activeRuns = await activeRunsDump(context.smithersHome);

  if (options.json) {
    console.log(JSON.stringify({ ...report, activeRuns }, null, 2));
    return;
  }

  console.log(`Stack: ${report.feature}`);
  console.log(`Phase: ${report.phase}    Suggested action: ${report.action}`);
  console.log(`Progress: ${report.summary}`);
  if (report.inFlight !== null) console.log(`In flight: ${report.inFlight}`);
  if (report.staleBranches.length > 0) console.log(`Stale (re-flowed) branches: ${report.staleBranches.join(", ")}`);
  console.log(`\n${report.hint}`);
  if (activeRuns !== "") console.log(`\n--- smithers runs ---\n${activeRuns}`);
}

export async function runStackPreview(context: StackCommandContext): Promise<void> {
  const { map } = await requireStackMap(context);
  if (map.tipBranch === "") {
    throw new Error(`Stack "${context.feature}" has no tip branch yet. Run \`xiv stack build\` before previewing.`);
  }
  await runInherited({ cmd: ["git", "checkout", map.tipBranch], cwd: context.targetCwd });
}
