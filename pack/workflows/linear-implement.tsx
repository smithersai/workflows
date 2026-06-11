// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Linear Implement
// smithers-description: Take a Linear issue, plan it, implement it, and review against acceptance criteria with meaningful tests + evidence.
// smithers-tags: linear, coding, review
// smithers-aliases: li
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop, Parallel } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents, providers } from "../agents";
import { finalizeSchema, linearIssueSchema, type LinearIssue } from "../components/LinearIssue";
import { reviewOutputSchema } from "../components/Review";
import { implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";
import AcceptanceReviewPrompt from "../prompts/acceptance-review.mdx";
import ImplementPrompt from "../prompts/implement.mdx";
import LinearFetchPrompt from "../prompts/linear-fetch.mdx";
import PlanPrompt from "../prompts/plan.mdx";
import ValidatePrompt from "../prompts/validate.mdx";

const planOutputSchema = z.looseObject({
  summary: z.string(),
  steps: z.array(z.string()).default([]),
});

const inputSchema = z.object({
  issueId: z.string().default(""),
  tdd: z.boolean().default(false),
});

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  issue: linearIssueSchema,
  plan: planOutputSchema,
  implement: implementOutputSchema,
  validate: validateOutputSchema,
  review: reviewOutputSchema,
  finalize: finalizeSchema,
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
  const issue = ctx.outputMaybe("issue", { nodeId: "fetch-issue" });
  const plan = ctx.outputMaybe("plan", { nodeId: "plan" });
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

  const validate = ctx.outputMaybe("validate", { nodeId: "impl:validate" });
  const reviews = ctx.outputs.review ?? [];
  const hasValidated = validate !== undefined;
  const validationPassed = hasValidated && validate.allPassed !== false;
  const anyApproved = reviews.length > 0 && reviews.some((review) => review.approved === true);
  const done = validationPassed && anyApproved;

  const feedbackParts: string[] = [];
  if (validate !== undefined && !validationPassed && validate.failingSummary) {
    feedbackParts.push(`VALIDATION FAILED:\n${validate.failingSummary}`);
  }
  for (const review of reviews) {
    if (review.approved === false) {
      feedbackParts.push(`REVIEWER REJECTED:\n${review.feedback}`);
      for (const issueItem of review.issues ?? []) {
        feedbackParts.push(`  [${issueItem.severity}] ${issueItem.title}: ${issueItem.description}${issueItem.file ? ` (${issueItem.file})` : ""}`);
      }
    }
  }

  const feedback = feedbackParts.length > 0 ? feedbackParts.join("\n\n") : null;
  const implementText = feedback
    ? `${implementPrompt}\n\n---\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
    : implementPrompt;
  const branch = issue !== undefined ? `feat/${issue.key.toLowerCase()}` : "feat/linear-implement";

  return (
    <Workflow name="linear-implement">
      <Sequence>
        <Task id="fetch-issue" output={linearIssueSchema} agent={providers.claude}>
          <LinearFetchPrompt issueId={ctx.input.issueId} />
        </Task>
        <Task id="plan" output={planOutputSchema} agent={agents.smart}>
          <PlanPrompt prompt={planPrompt} />
        </Task>
        <Loop id="impl:loop" until={done} maxIterations={3} onMaxReached="return-last">
          <Sequence>
            <Task id="impl:implement" output={implementOutputSchema} agent={agents.smart} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <ImplementPrompt prompt={implementText} />
            </Task>
            <Task id="impl:validate" output={validateOutputSchema} agent={agents.cheapFast} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <ValidatePrompt prompt={implementPrompt} />
            </Task>
            <Parallel>
              {agents.smart.map((agent, index) => (
                <Task
                  key={`impl:review:${index}`}
                  id={`impl:review:${index}`}
                  output={reviewOutputSchema}
                  agent={agent}
                  continueOnFail
                >
                  <AcceptanceReviewPrompt reviewer={`reviewer-${index + 1}`} prompt={implementPrompt} />
                </Task>
              ))}
            </Parallel>
          </Sequence>
        </Loop>
        <Task id="finalize" output={finalizeSchema} agent={agents.autonomous}>
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
