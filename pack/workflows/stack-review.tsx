// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Review
// smithers-description: Read CI status and human review comments across a stacked-PR feature, fix what they raise in each finding's OWNING branch via jj (cascade up), push, and report. NEVER merges.
// smithers-tags: github, review, pr, stack, jj, ci
// smithers-aliases: sr
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  stackAddressSchema,
  stackReviewReportSchema,
  stackSignalsSchema,
} from "../components/StackReview";
import { entriesForRepo, entriesInOrder, loadStackMapSync, type StackEntry } from "../lib/stack-map";
import StackReviewAddressPrompt from "../prompts/stack-review-address.mdx";
import StackSignalsPrompt from "../prompts/stack-signals.mdx";

const inputSchema = z.object({
  stackMapPath: z.string().default(""),
  repo: z.string().default(""),
  // Deliberately low. Code review happens locally before a branch is pushed, so the only things
  // left to chase here are CI and a human comment. Two rounds is enough to fix a red build and
  // confirm the fix; anything beyond that is a person's call, not a loop's.
  maxRounds: z.number().int().default(2),
});

const { Workflow, Task, Sequence, smithers } = createSmithers({
  input: inputSchema,
  signals: stackSignalsSchema,
  address: stackAddressSchema,
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
  const maxRounds = ctx.input.maxRounds ?? 2;

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

  const latestSignals = ctx.latest("signals", "review:signals");
  const openFindings = (latestSignals?.prs ?? []).flatMap((pr) =>
    pr.findings.map((finding) => ({
      pr: pr.prNumber,
      branch: pr.branch,
      source: finding.source,
      origin: finding.origin,
      path: finding.path,
      body: finding.body,
    })),
  );
  const hasOpenFindings = openFindings.length > 0;
  const done = latestSignals?.clean === true;
  // Skip the fix step when there is genuinely nothing to fix: no snapshot yet, everything already
  // clean, or checks still running with nothing red and no comment to answer. `clean === false` is
  // NOT on its own a reason to edit the stack — pending CI leaves nothing to do.
  const skipFix = latestSignals === undefined || latestSignals.clean || !hasOpenFindings;

  const latestFix = ctx.latest("address", "review:address");
  const redPrs = (latestSignals?.prs ?? []).filter((pr) => pr.ci === "failing").map((pr) => `#${pr.prNumber}`);
  const pendingPrs = (latestSignals?.prs ?? []).filter((pr) => pr.ci === "pending").map((pr) => `#${pr.prNumber}`);

  return (
    <Workflow name="stack-review">
      <Sequence>
        <Loop id="review:loop" until={done} maxIterations={maxRounds} onMaxReached="return-last">
          <Sequence>
            {/* One snapshot per round — read-only, and explicitly NOT a poll: nothing here waits
                on a remote reviewer, so a step that returns "pending" simply ends the round. */}
            <Task id="review:signals" output={stackSignalsSchema} agent={agents.autonomous} timeoutMs={900_000} heartbeatTimeoutMs={300_000}>
              <StackSignalsPrompt prs={JSON.stringify(prs, null, 2)} />
            </Task>

            <Task id="review:address" output={stackAddressSchema} agent={agents.autonomous} skipIf={skipFix} timeoutMs={2_400_000} heartbeatTimeoutMs={600_000}>
              <StackReviewAddressPrompt findings={JSON.stringify(openFindings, null, 2)} branchOrder={JSON.stringify(branchOrder)} />
            </Task>
          </Sequence>
        </Loop>

        <Task id="review:report" output={stackReviewReportSchema} agent={agents.autonomous} timeoutMs={600_000}>
          {[
            `Report the final state of the ${repo || "stack"} PRs (${prs.map((pr) => `#${pr.prNumber}`).join(", ")}).`,
            `Failing checks on: ${redPrs.join(", ") || "none"}. Checks still running on: ${pendingPrs.join(", ") || "none"}. Open findings: ${openFindings.length}. Fixes pushed this run: ${latestFix?.addressed.length ?? 0}; deliberately skipped: ${latestFix?.skipped.length ?? 0}.`,
            done
              ? "Every PR has green (or no) checks and no outstanding human comment. State the stack is ready for a HUMAN to review and merge. Do NOT merge it yourself."
              : `Not clean (checks red or still running, a human comment is outstanding, or it hit the ${maxRounds}-round cap). Use \`smithers ask-human\` to escalate which PRs are still open and why. Do NOT merge.`,
            "Set `resolved` appropriately, list the pending PRs in `pending`, and give a concise summary.",
          ].join("\n\n")}
        </Task>
      </Sequence>
    </Workflow>
  );
});
