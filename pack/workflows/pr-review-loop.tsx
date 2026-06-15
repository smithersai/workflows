// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: PR Review Loop
// smithers-description: Open or attach to a PR, trigger AI review, fix findings, and stop when reviewers approve. NEVER merges.
// smithers-tags: github, review, pr
// smithers-aliases: prl
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  addressFindingsSchema,
  prOpenSchema,
  rerequestSchema,
  reviewStateSchema,
} from "../components/PrReview";
import PrAddressFindingsPrompt from "../prompts/pr-address-findings.mdx";
import PrAttachPrompt from "../prompts/pr-attach.mdx";
import PrAwaitReviewsPrompt from "../prompts/pr-await-reviews.mdx";
import PrOpenPrompt from "../prompts/pr-open.mdx";
import PrRerequestPrompt from "../prompts/pr-rerequest.mdx";

const issueContextSchema = z.object({
  key: z.string().default(""),
  title: z.string().default(""),
  url: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
});

const inputSchema = z.object({
  prNumber: z.number().int().optional(),
  branch: z.string().default(""),
  base: z.string().default("main"),
  issueContext: issueContextSchema.optional(),
  reviewers: z.array(z.string()).default(["claude", "codex"]),
  maxRounds: z.number().int().default(8),
  pollIntervalSec: z.number().int().default(60),
  maxAttempts: z.number().int().default(30),
});

const reportSchema = z.object({
  prUrl: z.string().default(""),
  resolved: z.boolean().default(false),
  pending: z.array(z.string()).default([]),
  summary: z.string(),
});

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  prOpen: prOpenSchema,
  reviewState: reviewStateSchema,
  addressFindings: addressFindingsSchema,
  rerequest: rerequestSchema,
  report: reportSchema,
});

export default smithers((ctx) => {
  const base = ctx.input.base || "main";
  const reviewers = ctx.input.reviewers ?? ["claude", "codex"];
  const maxRounds = ctx.input.maxRounds ?? 8;
  const pollIntervalSec = ctx.input.pollIntervalSec ?? 60;
  const maxAttempts = ctx.input.maxAttempts ?? 20;
  const branch = ctx.input.branch || "(current branch)";
  const issue = ctx.input.issueContext;
  const mention = reviewers.map((reviewer) => `@${reviewer}`).join(" ");

  const prTitle = issue?.title ? `${issue.key ? issue.key + ": " : ""}${issue.title}` : `Changes on ${branch}`;
  const prBody = [
    issue?.url ? `Linear issue: ${issue.url}` : null,
    issue?.acceptanceCriteria.length
      ? `Acceptance criteria:\n${issue.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`).join("\n")}`
      : null,
    "Automated implementation, under AI review.",
  ].filter((part): part is string => part !== null).join("\n\n");

  const attachToExisting = ctx.input.prNumber !== undefined;
  const prOpen =
    ctx.outputMaybe("prOpen", { nodeId: "open-pr" }) ??
    ctx.outputMaybe("prOpen", { nodeId: "attach-pr" });
  const prNumber = prOpen?.prNumber ?? ctx.input.prNumber ?? 0;

  const latestReview = ctx.latest("reviewState", "rev:await");
  const latestFix = ctx.latest("addressFindings", "rev:fix");
  const currentHeadSha = latestFix?.headSha || prOpen?.headSha || "";

  const openFindings = (latestReview?.reviewers ?? [])
    .filter((reviewer) => reviewer.status === "findings")
    .flatMap((reviewer) => reviewer.findings.map((finding) => ({ reviewer: reviewer.name, path: finding.path, body: finding.body })));
  const hasOpenFindings = openFindings.length > 0;
  const done = latestReview?.allResolved === true;
  const skipFix = latestReview === undefined || latestReview.allResolved || latestReview.timedOut || !hasOpenFindings;
  const addressed = latestFix?.addressed ?? [];
  const skipped = latestFix?.skipped ?? [];

  return (
    <Workflow name="pr-review-loop">
      <Sequence>
        <Task id="open-pr" output={prOpenSchema} agent={agents.autonomous} skipIf={attachToExisting} timeoutMs={900_000} heartbeatTimeoutMs={300_000}>
          <PrOpenPrompt branch={branch} base={base} title={prTitle} body={prBody} draft={false} reviewersMention={mention} />
        </Task>

        <Task id="attach-pr" output={prOpenSchema} agent={agents.autonomous} skipIf={!attachToExisting} timeoutMs={300_000} heartbeatTimeoutMs={120_000}>
          <PrAttachPrompt prNumber={ctx.input.prNumber ?? 0} reviewersMention={mention} />
        </Task>

        <Loop id="rev:loop" until={done} maxIterations={maxRounds} onMaxReached="return-last">
          <Sequence>
            <Task id="rev:await" output={reviewStateSchema} agent={agents.autonomous} timeoutMs={2_400_000} heartbeatTimeoutMs={600_000}>
              <PrAwaitReviewsPrompt prNumber={prNumber} reviewers={reviewers.join(", ")} headSha={currentHeadSha} pollIntervalSec={pollIntervalSec} maxAttempts={maxAttempts} />
            </Task>

            <Task id="rev:fix" output={addressFindingsSchema} agent={agents.smart} skipIf={skipFix} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <PrAddressFindingsPrompt prNumber={prNumber} findings={JSON.stringify(openFindings, null, 2)} />
            </Task>

            <Task id="rev:rerequest" output={rerequestSchema} agent={agents.autonomous} skipIf={skipFix} timeoutMs={900_000} heartbeatTimeoutMs={300_000}>
              <PrRerequestPrompt prNumber={prNumber} reviewersMention={mention} addressed={JSON.stringify(addressed, null, 2)} skipped={JSON.stringify(skipped, null, 2)} />
            </Task>
          </Sequence>
        </Loop>

        <Task id="rev:report" output={reportSchema} agent={agents.autonomous} timeoutMs={600_000}>
          {[
            `Report the final state of PR #${prNumber} (${prOpen?.prUrl ?? "unknown URL"}).`,
            done
              ? "All reviewers have approved with no open findings. State that the PR is ready for a HUMAN to merge. Do NOT merge it yourself."
              : `Reviewers are NOT all resolved (timed out or hit the ${maxRounds}-round limit). Use \`smithers ask-human\` to escalate: explain which reviewers are still pending or have open findings, and ask whether to continue, stop, or have a human take over. Do NOT merge the PR.`,
            "Set resolved appropriately, list pending reviewers, and give a concise summary.",
          ].join("\n\n")}
        </Task>
      </Sequence>
    </Workflow>
  );
});
