// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Plan
// smithers-description: Fetch a Linear project or parent issue, assign each issue to a repo, order each repo's issues into a substack, and write the stack map. No code changes.
// smithers-tags: linear, stack, planning
// smithers-aliases: sp
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { stackPlanAgent } from "../agents";
import { createStackMap, saveStackMap, type StackEntry } from "../lib/stack-map";
import StackPlanPrompt from "../prompts/stack-plan.mdx";

const repoConfigSchema = z.object({
  path: z.string(),
  baseBranch: z.string().default("main"),
  remote: z.string().optional(),
});

const inputSchema = z.object({
  source: z.string().default(""),
  feature: z.string().default(""),
  repoSlug: z.string().default(""),
  repos: z.record(z.string(), repoConfigSchema).default({}),
  stackMapPath: z.string().default(""),
  // Recorded on the map as the feature-wide default: build every entry without
  // the local acceptance-review step (validation still gates each build).
  skipAcceptanceReview: z.boolean().default(false),
});

const plannedStackSchema = z.object({
  linearProjectId: z.string().default(""),
  parentIssueId: z.string().default(""),
  issues: z
    .array(z.object({ issueId: z.string().min(1), issueTitle: z.string().default(""), repo: z.string().default("") }))
    .min(1, "Return every SUB-issue of the source as a separate entry; the source itself is not an entry."),
});

const persistSchema = z.object({
  stackMapPath: z.string(),
  feature: z.string(),
  entryCount: z.number().int(),
  repoCount: z.number().int().default(0),
});

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  planned: plannedStackSchema,
  persist: persistSchema,
});

/** Deterministic branch (jj bookmark) name for an issue — mirrors linear-implement's convention. */
function branchFor(issueId: string): string {
  return `feat/${issueId.toLowerCase()}`;
}

export default smithers((ctx) => {
  const repoKeyList = Object.keys(ctx.input.repos);
  const planned = ctx.outputMaybe("planned", { nodeId: "plan" });

  return (
    <Workflow name="stack-plan">
      <Sequence>
        <Task
          id="plan"
          output={plannedStackSchema}
          agent={stackPlanAgent}
          timeoutMs={900_000}
          heartbeatTimeoutMs={300_000}
        >
          <StackPlanPrompt
            source={ctx.input.source}
            feature={ctx.input.feature}
            repos={JSON.stringify(repoKeyList)}
          />
        </Task>

        <Task id="persist" output={persistSchema} skipIf={planned === undefined}>
          {async () => {
            const issues = planned?.issues ?? [];
            const fallbackRepo = repoKeyList[0] ?? "default";
            const lastBranchByRepo: Record<string, string> = {};
            const entries: StackEntry[] = issues.map((issue, index) => {
              const repo = ctx.input.repos[issue.repo] !== undefined ? issue.repo : fallbackRepo;
              const branch = branchFor(issue.issueId);
              const base = lastBranchByRepo[repo] ?? ctx.input.repos[repo]?.baseBranch ?? "main";
              lastBranchByRepo[repo] = branch;
              return {
                position: index,
                issueId: issue.issueId,
                issueTitle: issue.issueTitle,
                repo,
                branchName: branch,
                changeId: "",
                baseBranch: base,
                headSha: "",
                status: "pending",
              };
            });
            const map = createStackMap({
              feature: ctx.input.feature,
              repoSlug: ctx.input.repoSlug,
              repos: ctx.input.repos,
              skipAcceptanceReview: ctx.input.skipAcceptanceReview,
              source: {
                linearProjectId: planned?.linearProjectId || undefined,
                parentIssueId: planned?.parentIssueId || undefined,
                issueIds: issues.map((issue) => issue.issueId),
              },
              entries,
            });
            await saveStackMap(ctx.input.stackMapPath, map);
            return {
              stackMapPath: ctx.input.stackMapPath,
              feature: ctx.input.feature,
              entryCount: entries.length,
              repoCount: repoKeyList.length,
            };
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
