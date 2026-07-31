// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Stack Build
// smithers-description: Build every pending stack entry on its own branch, bottom to top, locally (no push). Resumable — already-built entries are skipped.
// smithers-tags: linear, stack, coding
// smithers-aliases: sb
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { SubflowLoose } from "../components/SubflowLoose.js";
import { finalizeSchema } from "../components/LinearIssue";
import { gitCheckout } from "../lib/git";
import {
  entriesForRepo,
  entriesInOrder,
  loadStackMapSync,
  saveStackMap,
  setTip,
  tipFor,
  updateEntry,
  type StackEntry,
} from "../lib/stack-map";
import linearImplement from "./linear-implement";

const inputSchema = z.object({
  stackMapPath: z.string().default(""),
  repo: z.string().default(""),
  // Per-run override from the CLI. ORs with the map's plan-time default below —
  // a flag can force skipping on, but never re-enables review on a map that opted out.
  skipAcceptanceReview: z.boolean().default(false),
  // Forwarded to every entry's linear-implement subflow.
  maxIterations: z.number().int().default(3),
});

const ackSchema = z.object({
  ok: z.boolean().default(true),
  detail: z.string().default(""),
});

const summarySchema = z.object({
  feature: z.string().default(""),
  repo: z.string().default(""),
  built: z.number().int().default(0),
  pending: z.number().int().default(0),
  tip: z.string().default(""),
});

const { Workflow, Task, Sequence, smithers, outputs } = createSmithers({
  input: inputSchema,
  impl: finalizeSchema,
  ack: ackSchema,
  summary: summarySchema,
});

/** An entry still needs building unless it has reached at least the "implemented" state. */
function isBuilt(entry: StackEntry): boolean {
  return entry.status !== "pending" && entry.status !== "implementing";
}

export default smithers((ctx) => {
  const stackMapPath = ctx.input.stackMapPath;
  const targetCwd = process.env.SMITHERS_TARGET_CWD ?? process.cwd();
  const map = stackMapPath ? loadStackMapSync(stackMapPath) : null;

  if (map === null) {
    return (
      <Workflow name="stack-build">
        <Task id="build:missing" output={outputs.ack}>
          {() => {
            throw new Error(`No stack map at "${stackMapPath}". Run \`xiv stack plan\` first.`);
          }}
        </Task>
      </Workflow>
    );
  }

  const repo = ctx.input.repo;
  const entries = repo === "" ? entriesInOrder(map) : entriesForRepo(map, repo);
  const skipAcceptanceReview = ctx.input.skipAcceptanceReview || map.skipAcceptanceReview === true;

  return (
    <Workflow name="stack-build">
      <Sequence>
        {entries.map((entry) => {
          const done = isBuilt(entry);
          const built = ctx.outputMaybe(outputs.impl, { nodeId: `build:impl:${entry.issueId}` });
          return (
            <Sequence key={entry.issueId}>
              <Task id={`build:base:${entry.issueId}`} output={outputs.ack} skipIf={done}>
                {async () => {
                  await gitCheckout(entry.baseBranch, targetCwd);
                  return { ok: true, detail: `checked out ${entry.baseBranch}` };
                }}
              </Task>

              <SubflowLoose
                id={`build:impl:${entry.issueId}`}
                workflow={linearImplement}
                input={{ issueId: entry.issueId, skipAcceptanceReview, maxIterations: ctx.input.maxIterations }}
                output={outputs.impl}
                skipIf={done}
              />

              <Task
                id={`build:record:${entry.issueId}`}
                output={outputs.ack}
                skipIf={done || built === undefined}
              >
                {async () => {
                  // Read-modify-write the live file so concurrent entries never clobber each other.
                  const current = loadStackMapSync(stackMapPath);
                  if (current === null) throw new Error(`stack map vanished at "${stackMapPath}"`);
                  const branch = built?.branch || entry.branchName;
                  const recorded = updateEntry(current, entry.issueId, {
                    status: "implemented",
                    headSha: built?.headSha ?? "",
                    branchName: branch,
                  });
                  await saveStackMap(stackMapPath, setTip(recorded, entry.repo, branch));
                  return { ok: true, detail: `recorded ${entry.issueId} -> ${branch}` };
                }}
              </Task>
            </Sequence>
          );
        })}

        <Task id="build:summary" output={outputs.summary}>
          {() => {
            const current = loadStackMapSync(stackMapPath) ?? map;
            const scoped = repo === "" ? current.entries : current.entries.filter((entry) => entry.repo === repo);
            const built = scoped.filter(isBuilt).length;
            return {
              feature: current.feature,
              repo,
              built,
              pending: scoped.length - built,
              tip: tipFor(current, repo),
            };
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
