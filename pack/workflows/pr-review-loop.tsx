// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: PR Review Loop
// smithers-description: Open or attach to a PR, read its CI status and human review comments, address what they raise, and report. NEVER merges.
// smithers-tags: github, review, pr, ci
// smithers-aliases: prl
/** @jsxImportSource smthrs */
import { createSmithers, Loop } from "smthrs";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  addressFindingsSchema,
  prOpenSchema,
  prSignalsSchema,
} from "../components/PrReview";
import PrAddressFindingsPrompt from "../prompts/pr-address-findings.mdx";
import PrAttachPrompt from "../prompts/pr-attach.mdx";
import PrOpenPrompt from "../prompts/pr-open.mdx";
import PrSignalsPrompt from "../prompts/pr-signals.mdx";

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
  // Deliberately low. Code review happens locally before the PR exists, so the only things left
  // to chase here are CI and a human comment — both of which a human ultimately drives. Two
  // rounds is enough to fix a red build and confirm the fix; anything beyond that is a person's
  // call, not a loop's.
  maxRounds: z.number().int().default(2),
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
  signals: prSignalsSchema,
  addressFindings: addressFindingsSchema,
  report: reportSchema,
});

export default smithers((ctx) => {
  const base = ctx.input.base || "main";
  const maxRounds = ctx.input.maxRounds ?? 2;
  const branch = ctx.input.branch || "(current branch)";
  const issue = ctx.input.issueContext;

  const prTitle = issue?.title ? `${issue.key ? issue.key + ": " : ""}${issue.title}` : `Changes on ${branch}`;
  const prBodyParts = [
    issue?.url ? `Linear issue: ${issue.url}` : null,
    issue?.acceptanceCriteria.length
      ? `Acceptance criteria:\n${issue.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`).join("\n")}`
      : null,
  ].filter((part): part is string => part !== null);
  const prBody = prBodyParts.length > 0 ? prBodyParts.join("\n\n") : `Changes on \`${branch}\`.`;

  const attachToExisting = ctx.input.prNumber !== undefined;
  const prOpen =
    ctx.outputMaybe("prOpen", { nodeId: "open-pr" }) ??
    ctx.outputMaybe("prOpen", { nodeId: "attach-pr" });
  const prNumber = prOpen?.prNumber ?? ctx.input.prNumber ?? 0;

  const latestSignals = ctx.latest("signals", "rev:signals");
  const openFindings = latestSignals?.findings ?? [];
  const hasOpenFindings = openFindings.length > 0;
  const done = latestSignals?.clean === true;
  // Skip the fix step when there is genuinely nothing to fix: no snapshot yet, everything already
  // clean, or checks still running with nothing red and no comment to answer. Note that `clean`
  // being false is NOT sufficient reason to run a fix — pending CI alone leaves nothing to do.
  const skipFix = latestSignals === undefined || latestSignals.clean || !hasOpenFindings;

  const latestFix = ctx.latest("addressFindings", "rev:fix");
  const ciStatus = latestSignals?.ci ?? "none";

  return (
    <Workflow name="pr-review-loop">
      <Sequence>
        <Task id="open-pr" output={prOpenSchema} agent={agents.autonomous} skipIf={attachToExisting} timeoutMs={900_000} heartbeatTimeoutMs={300_000}>
          <PrOpenPrompt branch={branch} base={base} title={prTitle} body={prBody} draft={false} />
        </Task>

        <Task id="attach-pr" output={prOpenSchema} agent={agents.autonomous} skipIf={!attachToExisting} timeoutMs={300_000} heartbeatTimeoutMs={120_000}>
          <PrAttachPrompt prNumber={ctx.input.prNumber ?? 0} />
        </Task>

        <Loop id="rev:loop" until={done} maxIterations={maxRounds} onMaxReached="return-last">
          <Sequence>
            {/* One snapshot per round — read-only, and explicitly NOT a poll: nothing here waits
                on a remote reviewer, so a step that returns "pending" simply ends the round. */}
            <Task id="rev:signals" output={prSignalsSchema} agent={agents.autonomous} timeoutMs={600_000} heartbeatTimeoutMs={300_000}>
              <PrSignalsPrompt prNumber={prNumber} />
            </Task>

            <Task id="rev:fix" output={addressFindingsSchema} agent={agents.smart} skipIf={skipFix} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
              <PrAddressFindingsPrompt prNumber={prNumber} findings={JSON.stringify(openFindings, null, 2)} />
            </Task>
          </Sequence>
        </Loop>

        <Task id="rev:report" output={reportSchema} agent={agents.autonomous} timeoutMs={600_000}>
          {[
            `Report the final state of PR #${prNumber} (${prOpen?.prUrl ?? "unknown URL"}).`,
            `Status checks: ${ciStatus}. Open findings: ${openFindings.length}. Fixes pushed this run: ${latestFix?.addressed.length ?? 0}; deliberately skipped: ${latestFix?.skipped.length ?? 0}.`,
            done
              ? "Checks are green and no human comment is outstanding. State that the PR is ready for a HUMAN to review and merge. Do NOT merge it yourself."
              : `Not clean (checks are ${ciStatus}, or a human comment is outstanding, or it hit the ${maxRounds}-round cap). Say plainly what is still open and who needs to act. Do NOT merge the PR.`,
            "Set `resolved` appropriately, list what is still pending in `pending`, and give a concise summary.",
          ].join("\n\n")}
        </Task>
      </Sequence>
    </Workflow>
  );
});
