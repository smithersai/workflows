// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Linear to PR
// smithers-description: Implement a Linear issue, then open a PR and drive it through review until all reviewers approve. NEVER merges.
// smithers-tags: linear, github, coding, review
// smithers-aliases: l2pr
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { SubflowLoose } from "../components/SubflowLoose.js";
import { finalizeSchema } from "../components/LinearIssue";
import linearImplement from "./linear-implement";
import prReviewLoop from "./pr-review-loop";

const inputSchema = z.object({
  issueId: z.string().default(""),
  base: z.string().default("main"),
  tdd: z.boolean().default(false),
  // Forwarded to linear-implement: skip its acceptance-review step (validation still gates).
  skipAcceptanceReview: z.boolean().default(false),
});

const prResultSchema = z.looseObject({
  prUrl: z.string().default(""),
  resolved: z.boolean().default(false),
  pending: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

const { Workflow, Sequence, smithers, outputs } = createSmithers({
  input: inputSchema,
  implResult: finalizeSchema,
  prResult: prResultSchema,
});

export default smithers((ctx) => {
  const impl = ctx.outputMaybe(outputs.implResult, { nodeId: "impl" });
  const issue =
    impl !== undefined
      ? { key: impl.issueKey, title: impl.title, url: "", acceptanceCriteria: impl.acceptanceCriteria }
      : undefined;

  return (
    <Workflow name="linear-to-pr">
      <Sequence>
        <SubflowLoose
          id="impl"
          workflow={linearImplement}
          input={{
            issueId: ctx.input.issueId,
            tdd: ctx.input.tdd,
            skipAcceptanceReview: ctx.input.skipAcceptanceReview,
          }}
          output={outputs.implResult}
        />
        <SubflowLoose
          id="pr"
          workflow={prReviewLoop}
          input={{ branch: impl?.branch, base: ctx.input.base, issueContext: issue }}
          output={outputs.prResult}
          skipIf={impl === undefined}
        />
      </Sequence>
    </Workflow>
  );
});
