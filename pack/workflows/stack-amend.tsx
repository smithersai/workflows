// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Amend
// smithers-description: Apply a change to one stack entry and let jj re-flow it through every descendant, then re-validate the tip. Local only.
// smithers-tags: linear, stack, jj, restack
// smithers-aliases: sa
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { validateOutputSchema } from "../components/ValidationLoop";
import {
  descendantsOf,
  entriesForRepo,
  entriesInOrder,
  findEntryByBranch,
  findEntryByIssue,
  loadStackMapSync,
  saveStackMap,
  tipFor,
  updateEntry,
} from "../lib/stack-map";
import StackEditPrompt from "../prompts/stack-edit.mdx";
import StackLocatePrompt from "../prompts/stack-locate.mdx";
import ValidatePrompt from "../prompts/validate.mdx";
import { agents, providers } from "../agents";

const inputSchema = z.object({
  stackMapPath: z.string().default(""),
  message: z.string().default(""),
  target: z.string().default(""),
  repo: z.string().default(""),
});

const locateSchema = z.object({
  issueId: z.string(),
  branchName: z.string().default(""),
  position: z.number().int().default(0),
  reason: z.string().default(""),
});

const rebasedBranchSchema = z.object({
  branch: z.string(),
  headSha: z.string().default(""),
  changeId: z.string().default(""),
  hadConflict: z.boolean().default(false),
});

const amendSchema = z.object({
  targetBranch: z.string().default(""),
  targetChangeId: z.string().default(""),
  targetHeadSha: z.string().default(""),
  rebased: z.array(rebasedBranchSchema).default([]),
  conflictsRemaining: z.boolean().default(false),
  summary: z.string().default(""),
});

const ackSchema = z.object({
  ok: z.boolean().default(true),
  detail: z.string().default(""),
});

const { Workflow, Task, Sequence, smithers, outputs } = createSmithers({
  input: inputSchema,
  locate: locateSchema,
  amend: amendSchema,
  ack: ackSchema,
  validate: validateOutputSchema,
});

export default smithers((ctx) => {
  const stackMapPath = ctx.input.stackMapPath;
  const message = ctx.input.message;
  const hint = ctx.input.target;
  const map = stackMapPath ? loadStackMapSync(stackMapPath) : null;

  if (map === null) {
    return (
      <Workflow name="stack-amend">
        <Task id="amend:missing" output={outputs.ack}>
          {() => {
            throw new Error(`No stack map at "${stackMapPath}". Run \`xiv stack plan\` first.`);
          }}
        </Task>
      </Workflow>
    );
  }

  const repo = ctx.input.repo;
  const entries = repo === "" ? entriesInOrder(map) : entriesForRepo(map, repo);
  const explicit = hint ? findEntryByIssue(map, hint) ?? findEntryByBranch(map, hint) : undefined;
  const located = ctx.outputMaybe(outputs.locate, { nodeId: "amend:locate" });
  const targetEntry = explicit ?? (located ? findEntryByIssue(map, located.issueId) : undefined);
  const needAgentLocate = explicit === undefined;

  const descendants = targetEntry ? descendantsOf(map, targetEntry) : [];
  const tipRepo = targetEntry?.repo ?? repo;
  const tip = tipFor(map, tipRepo) || descendants.at(-1)?.branchName || targetEntry?.branchName || "";
  const amended = ctx.outputMaybe(outputs.amend, { nodeId: "amend:edit" });

  const entriesForPrompt = entries.map((entry) => ({
    position: entry.position,
    issueId: entry.issueId,
    issueTitle: entry.issueTitle,
    branchName: entry.branchName,
    status: entry.status,
  }));

  return (
    <Workflow name="stack-amend">
      <Sequence>
        <Task
          id="amend:locate"
          output={outputs.locate}
          agent={providers.claude}
          skipIf={!needAgentLocate}
          timeoutMs={600_000}
          heartbeatTimeoutMs={300_000}
        >
          <StackLocatePrompt message={message} target={hint} entries={JSON.stringify(entriesForPrompt, null, 2)} />
        </Task>

        <Task
          id="amend:edit"
          output={outputs.amend}
          agent={agents.autonomous}
          skipIf={targetEntry === undefined}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
        >
          <StackEditPrompt
            targetBranch={targetEntry?.branchName ?? ""}
            descendants={JSON.stringify(descendants.map((entry) => entry.branchName), null, 2)}
            message={message}
          />
        </Task>

        <Task
          id="amend:record"
          output={outputs.ack}
          skipIf={targetEntry === undefined || amended === undefined}
        >
          {async () => {
            const current = loadStackMapSync(stackMapPath);
            if (current === null) throw new Error(`stack map vanished at "${stackMapPath}"`);
            if (targetEntry === undefined || amended === undefined) {
              return { ok: false, detail: "nothing to record" };
            }
            let next = updateEntry(current, targetEntry.issueId, {
              changeId: amended.targetChangeId,
              headSha: amended.targetHeadSha,
            });
            for (const rebased of amended.rebased) {
              const entry = findEntryByBranch(next, rebased.branch);
              if (entry !== undefined) {
                next = updateEntry(next, entry.issueId, { changeId: rebased.changeId, headSha: rebased.headSha });
              }
            }
            await saveStackMap(stackMapPath, next);
            return {
              ok: !amended.conflictsRemaining,
              detail: `amended ${targetEntry.issueId}, re-flowed ${amended.rebased.length} descendant(s)${amended.conflictsRemaining ? " (CONFLICTS REMAIN)" : ""}`,
            };
          }}
        </Task>

        <Task
          id="amend:revalidate"
          output={outputs.validate}
          agent={agents.autonomous}
          skipIf={amended === undefined || tip === ""}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
        >
          <ValidatePrompt
            prompt={`A low/mid-stack entry was amended and jj re-flowed the change up the stack. Validate the integration tip branch \`${tip}\` (it contains the whole feature). Check out \`${tip}\`, run the repo's lint and tests, and report pass/fail with a summary of every failure.`}
          />
        </Task>
      </Sequence>
    </Workflow>
  );
});
