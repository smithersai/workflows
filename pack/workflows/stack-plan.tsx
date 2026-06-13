// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Plan
// smithers-description: Fetch a Linear project or parent issue, order its issues into a stack, and write the stack map. No code changes.
// smithers-tags: linear, stack, planning
// smithers-aliases: sp
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { providers } from "../agents";
import { createStackMap, saveStackMap, type StackEntry } from "../lib/stack-map";
import StackPlanPrompt from "../prompts/stack-plan.mdx";

const inputSchema = z.object({
  source: z.string().default(""),
  feature: z.string().default(""),
  base: z.string().default("main"),
  repoSlug: z.string().default(""),
  stackMapPath: z.string().default(""),
});

const plannedStackSchema = z.object({
  linearProjectId: z.string().default(""),
  parentIssueId: z.string().default(""),
  issues: z
    .array(z.object({ issueId: z.string(), issueTitle: z.string().default("") }))
    .default([]),
});

const persistSchema = z.object({
  stackMapPath: z.string(),
  feature: z.string(),
  entryCount: z.number().int(),
  tipBranch: z.string().default(""),
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
  const base = ctx.input.base || "main";
  const planned = ctx.outputMaybe("planned", { nodeId: "plan" });

  return (
    <Workflow name="stack-plan">
      <Sequence>
        <Task
          id="plan"
          output={plannedStackSchema}
          agent={providers.claude}
          timeoutMs={900_000}
          heartbeatTimeoutMs={300_000}
        >
          <StackPlanPrompt source={ctx.input.source} feature={ctx.input.feature} />
        </Task>

        <Task id="persist" output={persistSchema} skipIf={planned === undefined}>
          {async () => {
            const issues = planned?.issues ?? [];
            const entries: StackEntry[] = issues.map((issue, index) => ({
              position: index,
              issueId: issue.issueId,
              issueTitle: issue.issueTitle,
              branchName: branchFor(issue.issueId),
              changeId: "",
              baseBranch: index === 0 ? base : branchFor(issues[index - 1].issueId),
              headSha: "",
              status: "pending",
            }));
            const map = createStackMap({
              feature: ctx.input.feature,
              repoSlug: ctx.input.repoSlug,
              baseBranch: base,
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
              tipBranch: map.tipBranch,
            };
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
