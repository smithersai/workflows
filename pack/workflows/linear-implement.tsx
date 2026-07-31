// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Linear Implement
// smithers-description: Take a Linear issue, plan it, implement it, and review against acceptance criteria with meaningful tests + evidence.
// smithers-tags: linear, coding, review
// smithers-aliases: li
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop } from "smithers-orchestrator";
import { z } from "zod/v4";
import { linearImplementAgents } from "../agents";
import { finalizeSchema, linearIssueSchema, type LinearIssue } from "../components/LinearIssue";
import { localReviewSchema } from "../components/LocalReview";
import { implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";
import AcceptanceReviewPrompt from "../prompts/acceptance-review.mdx";
import ImplementPrompt from "../prompts/implement.mdx";
import LinearFetchPrompt from "../prompts/linear-fetch.mdx";
import PlanPrompt from "../prompts/plan.mdx";
import ValidatePrompt from "../prompts/validate.mdx";

const planOutputSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()).default([]),
});

const inputSchema = z.object({
  issueId: z.string().default(""),
  tdd: z.boolean().default(false),
  // Skip the local review step entirely. The loop's done-gate already treats an absent
  // review as "gate on validation alone" (see the `done` computation), so skipping cannot
  // wedge the loop — validation still decides.
  skipAcceptanceReview: z.boolean().default(false),
  // How many implement→validate→review passes to allow before giving up and returning the last
  // attempt. Raising this only costs anything for issues that actually fail a pass; a clean issue
  // still exits after one. Clamped below so a bad input cannot spin forever or disable the loop.
  maxIterations: z.number().int().default(3),
});

/** Iteration count is operator input, so bound it rather than trusting it. */
function clampIterations(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}

const fetchGateSchema = z.object({ ok: z.boolean() });

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  issue: linearIssueSchema,
  fetchGate: fetchGateSchema,
  plan: planOutputSchema,
  implement: implementOutputSchema,
  validate: validateOutputSchema,
  review: localReviewSchema,
  // The workflow's primary result table MUST be named `output`: the engine reads
  // `schema.output` to populate RunResult.output, which is what SubflowLoose
  // (in stack-build / linear-to-pr) consumes. Naming it anything else makes the
  // subflow receive `undefined` and fail INVALID_OUTPUT validation. See finalize task below.
  output: finalizeSchema,
});

function criteriaBlock(issue: LinearIssue | undefined): string {
  if (issue === undefined) return "";
  const acceptanceCriteria = issue.acceptanceCriteria.length
    ? issue.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")
    : "(none explicitly stated - derive from the description)";

  return [
    `LINEAR ISSUE ${issue.key}: ${issue.title}`,
    issue.description ? `DESCRIPTION:\n${issue.description}` : null,
    `ACCEPTANCE CRITERIA (each must be met, with evidence, and covered by meaningful tests):\n${acceptanceCriteria}`,
    issue.comments.length ? `RELEVANT COMMENTS:\n${issue.comments.map((comment) => `- ${comment}`).join("\n")}` : null,
  ].filter((part): part is string => part !== null).join("\n\n");
}

export default smithers((ctx) => {
  const tdd = ctx.input.tdd;
  // fetch-issue and plan run ONCE, before the impl loop (iteration 0). Reads must
  // pin iteration:0 — otherwise, once the loop elevates ctx.iteration, these reads
  // resolve against the current iteration, find nothing, and return undefined. That
  // silently dropped acceptance criteria from re-implement prompts AND made finalize
  // fall back to the generic `feat/linear-implement` branch for multi-iteration issues.
  const issue = ctx.outputMaybe("issue", { nodeId: "fetch-issue", iteration: 0 });
  const plan = ctx.outputMaybe("plan", { nodeId: "plan", iteration: 0 });
  const criteria = criteriaBlock(issue);

  const planPrompt = [
    `Implement Linear issue ${ctx.input.issueId}.`,
    criteria || null,
    tdd ? "IMPORTANT: Write tests FIRST. The plan MUST start with test steps before production implementation steps." : null,
  ].filter((part): part is string => part !== null).join("\n\n---\n");

  const implementPrompt = [
    `Implement Linear issue ${ctx.input.issueId}.`,
    criteria || null,
    plan ? `IMPLEMENTATION PLAN:\n${plan.summary}\n\nSteps:\n${plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : null,
    "Provide evidence that each acceptance criterion is satisfied (cite files/tests). Tests must be meaningful and pass.",
    tdd ? "Follow the plan's test-first approach: write/update tests before production code." : null,
  ].filter((part): part is string => part !== null).join("\n\n---\n");

  // Both reads are deliberately UNPINNED, so they resolve against the CURRENT iteration.
  // Reading review state across all iterations is a wedging bug: a `request_changes` from
  // iteration 1 would still be in `ctx.outputs.review` at iteration 3 and block forever,
  // and symmetrically a stale `approve` would let a later broken iteration through.
  const validate = ctx.outputMaybe("validate", { nodeId: "impl:validate" });
  const review = ctx.outputMaybe("review", { nodeId: "impl:review" });
  const hasValidated = validate !== undefined;
  const validationPassed = hasValidated && validate.allPassed !== false;
  // VALIDATION IS THE ARBITER — the review is advisory and may only ever WITHHOLD done, never
  // grant it. `localReviewSchema.verdict` has no default on purpose: a reviewer that cannot emit
  // a real verdict fails its (continueOnFail) Task, so `review` is simply undefined here. That
  // must NOT hold the loop hostage — a non-review can never approve, so demanding approval would
  // burn every iteration with no real review gating. Hence: skipped, failed, or unparseable
  // review => gate on validation alone (it already runs tests/lint/typecheck).
  //   request_changes -> not done (send it back for another pass)
  //   comment         -> non-blocking by definition; done if validation passed
  //   approve         -> done if validation passed
  const requestedChanges = review?.verdict === "request_changes";
  const done = validationPassed && !requestedChanges;

  const feedbackParts: string[] = [];
  if (validate !== undefined && !validationPassed && validate.failingSummary) {
    feedbackParts.push(`VALIDATION FAILED:\n${validate.failingSummary}`);
  }
  // Feed non-approving review findings back even for a `comment` verdict: it does not block, but
  // if validation failed and the loop runs again, the implementer should see them too.
  if (review !== undefined && review.verdict !== "approve") {
    feedbackParts.push(`REVIEW VERDICT: ${review.verdict}\n${review.summary}`);
    for (const finding of review.findings) {
      const location = finding.path !== null
        ? ` (${finding.path}${finding.line !== null ? `:${finding.line}` : ""})`
        : "";
      feedbackParts.push(`  [${finding.severity}] ${finding.title}: ${finding.body}${location}`);
    }
  }

  const feedback = feedbackParts.length > 0 ? feedbackParts.join("\n\n") : null;
  const implementText = feedback
    ? `${implementPrompt}\n\n---\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
    : implementPrompt;
  // Derive the branch from the known input issueId (always set in stack-build) rather
  // than the fetched issue, so a stacked build's branch names stay deterministic and
  // correct even if the issue output is ever unreadable. Falls back to the fetched
  // issue key, then a generic name only for standalone runs with no issueId.
  const issueKey = ctx.input.issueId || issue?.key || "";
  const branch = issueKey !== "" ? `feat/${issueKey.toLowerCase()}` : "feat/linear-implement";

  return (
    <Workflow name="linear-implement">
      <Sequence>
        <Task id="fetch-issue" output={linearIssueSchema} agent={linearImplementAgents.fetchIssue}>
          <LinearFetchPrompt issueId={ctx.input.issueId} />
        </Task>
        {/* Hard gate: refuse to plan/implement when the issue content was not actually
            retrieved. Without this, a fetch-step auth failure returns its error text AS
            the issue, and every downstream step faithfully implements the error message. */}
        <Task id="fetch-gate" output={fetchGateSchema}>
          {async () => {
            if (issue === undefined || issue.fetched === false) {
              throw new Error(
                `Linear issue ${ctx.input.issueId} could not be fetched (${issue?.description || "no fetch output"}). ` +
                  "Refusing to plan or implement from error text. Fix Linear MCP auth/availability and re-run.",
              );
            }
            return { ok: true };
          }}
        </Task>
        <Task id="plan" output={planOutputSchema} agent={linearImplementAgents.plan}>
          <PlanPrompt prompt={planPrompt} />
        </Task>
        <Loop id="impl:loop" until={done} maxIterations={clampIterations(ctx.input.maxIterations)} onMaxReached="return-last">
          <Sequence>
            <Task id="impl:implement" output={implementOutputSchema} agent={linearImplementAgents.implement} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <ImplementPrompt prompt={implementText} />
            </Task>
            <Task id="impl:validate" output={validateOutputSchema} agent={linearImplementAgents.validate} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <ValidatePrompt prompt={implementPrompt} />
            </Task>
            {/* A local review agent reads the working-tree diff and judges it against the
                acceptance criteria. continueOnFail is load-bearing: the review is advisory, so a
                crashed or malformed reviewer must never fail the build — it just leaves this
                iteration with no review and validation decides alone (see the `done` computation). */}
            <Task
              id="impl:review"
              output={localReviewSchema}
              agent={linearImplementAgents.review}
              continueOnFail
              skipIf={ctx.input.skipAcceptanceReview}
              timeoutMs={1_800_000}
              heartbeatTimeoutMs={600_000}
            >
              <AcceptanceReviewPrompt prompt={implementPrompt} />
            </Task>
          </Sequence>
        </Loop>
        <Task id="finalize" output={finalizeSchema} agent={linearImplementAgents.finalize}>
          {[
            `Ensure all implemented work for Linear issue ${ctx.input.issueId} is committed on a dedicated branch named \`${branch}\` (create it from the current base branch if it does not exist; do not push, do not open a PR).`,
            "Stage and commit all uncommitted changes with a clear message referencing the issue.",
            `Then report: the branch name (\`${branch}\`), the current head SHA (git rev-parse HEAD), the issue key (${issue?.key ?? ctx.input.issueId}), the issue title, the acceptance criteria, and a short summary of what was implemented.`,
            "Do NOT open or merge a pull request - committing locally is the only action.",
          ].join("\n\n")}
        </Task>
      </Sequence>
    </Workflow>
  );
});
