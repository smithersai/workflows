// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Push
// smithers-description: Publish the next N built stack entries as stacked PRs, and re-sync open PRs that a later amend re-flowed. NEVER merges.
// smithers-tags: github, stack, pr
// smithers-aliases: spush
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { prOpenSchema } from "../components/PrReview";
import {
  entriesToPush,
  loadStackMapSync,
  prBaseFor,
  repoKeys,
  saveStackMap,
  staleEntries,
  updateEntry,
} from "../lib/stack-map";
import PrOpenPrompt from "../prompts/pr-open.mdx";
import StackResyncPrompt from "../prompts/stack-resync.mdx";
import { agents } from "../agents";

const inputSchema = z.object({
  stackMapPath: z.string().default(""),
  count: z.number().int().default(5),
  repo: z.string().default(""),
  draft: z.boolean().default(true),
});

const resyncSchema = z.object({
  prNumber: z.number().int().default(0),
  headSha: z.string().default(""),
  pushed: z.boolean().default(false),
  summary: z.string().default(""),
});

const ackSchema = z.object({
  ok: z.boolean().default(true),
  detail: z.string().default(""),
});

const { Workflow, Task, Sequence, smithers, outputs } = createSmithers({
  input: inputSchema,
  prOpen: prOpenSchema,
  resync: resyncSchema,
  ack: ackSchema,
});

export default smithers((ctx) => {
  const stackMapPath = ctx.input.stackMapPath;
  const map = stackMapPath ? loadStackMapSync(stackMapPath) : null;

  if (map === null) {
    return (
      <Workflow name="stack-push">
        <Task id="push:missing" output={outputs.ack}>
          {() => {
            throw new Error(`No stack map at "${stackMapPath}". Run \`xiv stack plan\` first.`);
          }}
        </Task>
      </Workflow>
    );
  }

  const repo = ctx.input.repo || (repoKeys(map)[0] ?? "");
  const stale = staleEntries(map, repo);
  const newBatch = entriesToPush(map, repo, ctx.input.count);

  return (
    <Workflow name="stack-push">
      <Sequence>
        {/* Re-sync open PRs that a later amend re-flowed (lower in the stack). */}
        {stale.map((entry) => {
          const resynced = ctx.outputMaybe(outputs.resync, { nodeId: `push:resync:${entry.issueId}` });
          return (
            <Sequence key={`resync-${entry.issueId}`}>
              <Task
                id={`push:resync:${entry.issueId}`}
                output={outputs.resync}
                agent={agents.autonomous}
                timeoutMs={900_000}
                heartbeatTimeoutMs={300_000}
              >
                <StackResyncPrompt branch={entry.branchName} prNumber={entry.prNumber ?? 0} />
              </Task>
              <Task
                id={`push:resync-record:${entry.issueId}`}
                output={outputs.ack}
                skipIf={resynced === undefined}
              >
                {async () => {
                  const current = loadStackMapSync(stackMapPath);
                  if (current === null) throw new Error(`stack map vanished at "${stackMapPath}"`);
                  const sha = resynced?.headSha || entry.headSha;
                  await saveStackMap(stackMapPath, updateEntry(current, entry.issueId, { headSha: sha, pushedSha: sha }));
                  return { ok: true, detail: `re-synced ${entry.branchName} (PR #${entry.prNumber ?? 0})` };
                }}
              </Task>
            </Sequence>
          );
        })}

        {/* Publish the next batch of built entries, bottom to top, as stacked PRs. */}
        {newBatch.map((entry) => {
          const opened = ctx.outputMaybe(outputs.prOpen, { nodeId: `push:open:${entry.issueId}` });
          const base = prBaseFor(map, entry);
          const title = `${entry.issueId}: ${entry.issueTitle}`;
          const body = [
            `Part of the \`${map.feature}\` stack (entry ${entry.position}).`,
            `Linear issue: ${entry.issueId}`,
            `Stacked on \`${base}\`.`,
          ].join("\n\n");
          return (
            <Sequence key={`open-${entry.issueId}`}>
              <Task
                id={`push:open:${entry.issueId}`}
                output={outputs.prOpen}
                agent={agents.autonomous}
                timeoutMs={900_000}
                heartbeatTimeoutMs={300_000}
              >
                <PrOpenPrompt branch={entry.branchName} base={base} title={title} body={body} draft={ctx.input.draft} />
              </Task>
              <Task
                id={`push:open-record:${entry.issueId}`}
                output={outputs.ack}
                skipIf={opened === undefined}
              >
                {async () => {
                  const current = loadStackMapSync(stackMapPath);
                  if (current === null) throw new Error(`stack map vanished at "${stackMapPath}"`);
                  const sha = opened?.headSha || entry.headSha;
                  await saveStackMap(
                    stackMapPath,
                    updateEntry(current, entry.issueId, {
                      status: "pr-open",
                      prNumber: opened?.prNumber,
                      prUrl: opened?.prUrl,
                      headSha: sha,
                      pushedSha: sha,
                    }),
                  );
                  return { ok: true, detail: `opened PR #${opened?.prNumber ?? 0} for ${entry.branchName}` };
                }}
              </Task>
            </Sequence>
          );
        })}
      </Sequence>
    </Workflow>
  );
});
