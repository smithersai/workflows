// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Review
// smithers-description: Drive a stacked-PR feature to all-reviewers-approved — read findings across the stack, fix each in its OWNING branch via jj (cascade up), push, re-request, and loop until resolved. NEVER merges.
// smithers-tags: github, review, pr, stack, jj
// smithers-aliases: sr
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  stackAddressSchema,
  stackRerequestSchema,
  stackReviewReportSchema,
  stackReviewStateSchema,
} from "../components/StackReview";
import { entriesForRepo, entriesInOrder, loadStackMapSync, type StackEntry } from "../lib/stack-map";
import StackReviewAddressPrompt from "../prompts/stack-review-address.mdx";
import StackReviewAwaitPrompt from "../prompts/stack-review-await.mdx";
import StackReviewRerequestPrompt from "../prompts/stack-review-rerequest.mdx";

const inputSchema = z.object({
  stackMapPath: z.string().default(""),
  repo: z.string().default(""),
  reviewers: z.array(z.string()).default(["claude", "codex"]),
  maxRounds: z.number().int().default(6),
  pollIntervalSec: z.number().int().default(90),
  maxAttempts: z.number().int().default(20),
});

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  reviewState: stackReviewStateSchema,
  address: stackAddressSchema,
  rerequest: stackRerequestSchema,
  report: stackReviewReportSchema,
});

/** An entry is reviewable only once it has an open PR. */
function hasPr(entry: StackEntry): entry is StackEntry & { prNumber: number } {
  return typeof entry.prNumber === "number";
}

export default smithers((ctx) => {
  const stackMapPath = ctx.input.stackMapPath;
  const map = stackMapPath ? loadStackMapSync(stackMapPath) : null;

  if (map === null) {
    return (
      <Workflow name="stack-review">
        <Task id="review:missing" output={stackReviewReportSchema}>
          {() => {
            throw new Error(`No stack map at "${stackMapPath}". Run \`xiv stack plan\` first.`);
          }}
        </Task>
      </Workflow>
    );
  }

  const repo = ctx.input.repo;
  const reviewers = ctx.input.reviewers ?? ["claude", "codex"];
  const mention = reviewers.map((reviewer) => `@${reviewer}`).join(" ");
  const maxRounds = ctx.input.maxRounds ?? 6;
  const pollIntervalSec = ctx.input.pollIntervalSec ?? 90;
  const maxAttempts = ctx.input.maxAttempts ?? 20;

  const entries = (repo === "" ? entriesInOrder(map) : entriesForRepo(map, repo)).filter(hasPr);
  const prs = entries.map((entry) => ({ prNumber: entry.prNumber, branch: entry.branchName, issueId: entry.issueId }));
  const branchOrder = entries.map((entry) => entry.branchName);

  if (prs.length === 0) {
    return (
      <Workflow name="stack-review">
        <Task id="review:none" output={stackReviewReportSchema}>
          {() => ({
            resolved: false,
            pending: [],
            summary: `No open PRs for ${repo || "this stack"} — run \`xiv stack push\` first, then re-run review.`,
          })}
        </Task>
      </Workflow>
    );
  }

  const latestReview = ctx.latest("reviewState", "review:await");
  const openFindings = (latestReview?.prs ?? []).flatMap((pr) =>
    pr.reviewers
      .filter((reviewer) => reviewer.status === "findings")
      .flatMap((reviewer) =>
        reviewer.findings.map((finding) => ({
          pr: pr.prNumber,
          branch: pr.branch,
          reviewer: reviewer.name,
          path: finding.path,
          body: finding.body,
        })),
      ),
  );
  const hasOpenFindings = openFindings.length > 0;
  const done = latestReview?.allResolved === true;
  const skipFix =
    latestReview === undefined || latestReview.allResolved || latestReview.timedOut || !hasOpenFindings;

  const latestFix = ctx.latest("address", "review:address");
  const addressed = latestFix?.addressed ?? [];
  const skipped = latestFix?.skipped ?? [];

  return (
    <Workflow name="stack-review">
      <Sequence>
        <Loop id="review:loop" until={done} maxIterations={maxRounds} onMaxReached="return-last">
          <Sequence>
            <Task id="review:await" output={stackReviewStateSchema} agent={agents.autonomous} timeoutMs={1_800_000} heartbeatTimeoutMs={300_000}>
              <StackReviewAwaitPrompt
                prs={JSON.stringify(prs, null, 2)}
                reviewers={reviewers.join(", ")}
                pollIntervalSec={pollIntervalSec}
                maxAttempts={maxAttempts}
              />
            </Task>

            <Task id="review:address" output={stackAddressSchema} agent={agents.autonomous} skipIf={skipFix} timeoutMs={2_400_000} heartbeatTimeoutMs={600_000}>
              <StackReviewAddressPrompt findings={JSON.stringify(openFindings, null, 2)} branchOrder={JSON.stringify(branchOrder)} />
            </Task>

            <Task id="review:rerequest" output={stackRerequestSchema} agent={agents.autonomous} skipIf={skipFix} timeoutMs={900_000} heartbeatTimeoutMs={300_000}>
              <StackReviewRerequestPrompt
                reviewersMention={mention}
                addressed={JSON.stringify(addressed, null, 2)}
                skipped={JSON.stringify(skipped, null, 2)}
              />
            </Task>
          </Sequence>
        </Loop>

        <Task id="review:report" output={stackReviewReportSchema} agent={agents.autonomous} timeoutMs={600_000}>
          {[
            `Report the final review state of the ${repo || "stack"} PRs (${prs.map((pr) => `#${pr.prNumber}`).join(", ")}).`,
            done
              ? "All reviewers approved with no open findings across the stack. State the stack is ready for a HUMAN to merge. Do NOT merge it yourself."
              : `Not all resolved (timed out, or hit the ${maxRounds}-round cap). Use \`smithers ask-human\` to escalate which PRs/reviewers are still open. Do NOT merge.`,
            "Set `resolved` appropriately, list the pending PRs/reviewers, and give a concise summary.",
          ].join("\n\n")}
        </Task>
      </Sequence>
    </Workflow>
  );
});
