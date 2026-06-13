#!/usr/bin/env bun
import { Args, Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Option } from "effect";
import { installPack } from "./manifest";
import { defaultSmithersHome, packagedPackRoot } from "./paths";
import {
  checkDevWorkflow,
  implementInput,
  parseInput,
  reviewInput,
  runDevWorkflow,
  runPassthrough,
  runWorkflow,
  shipInput,
  stackAmendInput,
  stackBuildInput,
  stackPlanInput,
  stackPushInput,
} from "./smithers";
import { ensureJjReady } from "./jj";
import { runStackInit, runStackPreview, runStackStatus, runStackTriage } from "./stack";
import { repoSlugFor, resolveStackMapPath } from "./stack-map";
import type { AbsolutePath, SmithersPassthroughCommand, WorkflowName } from "./types";

const issueIdArg = Args.text({ name: "issueId" }).pipe(
  Args.withDescription("Linear issue key, for example ENG-123."),
);
const trailingArgs = Args.text({ name: "arg" }).pipe(
  Args.withDescription("Argument forwarded to the underlying smithers command."),
  Args.repeated,
);
const tddFlag = Options.boolean("tdd").pipe(
  Options.withDescription("Ask the implementation workflow to plan tests before production changes."),
);
const baseOption = Options.text("base").pipe(
  Options.withDescription("Base branch for a newly opened pull request."),
  Options.withDefault("main"),
);
const prOption = Options.integer("pr").pipe(
  Options.withDescription("Existing pull request number to attach to."),
  Options.optional,
);
const branchOption = Options.text("branch").pipe(
  Options.withDescription("Branch to push and open as a new pull request."),
  Options.optional,
);
const workflowArg = Args.text({ name: "workflow" }).pipe(
  Args.withDescription("Workflow name (e.g. linear-implement) or a path to a .tsx under pack/workflows."),
);
const inputOption = Options.text("input").pipe(
  Options.withDescription("Raw JSON object forwarded to the workflow as its input."),
  Options.withDefault("{}"),
);
const cwdOption = Options.text("cwd").pipe(
  Options.withDescription("Target repo the workflow operates on (sets SMITHERS_TARGET_CWD). Defaults to the current directory."),
  Options.optional,
);
const featureOption = Options.text("feature").pipe(
  Options.withDescription("Stack feature slug. Names the stack map file and identifies the stack across commands."),
);
const sourceArg = Args.text({ name: "source" }).pipe(
  Args.withDescription("Linear project ID or parent issue key whose sub-issues become the stack."),
);
const messageOption = Options.text("message").pipe(
  Options.withAlias("m"),
  Options.withDescription("The change to apply to the located stack entry."),
);
const targetOption = Options.text("target").pipe(
  Options.withDescription("Explicit entry to amend (issue key or branch). Omit to let the workflow locate it from --message."),
  Options.optional,
);
const countOption = Options.integer("count").pipe(
  Options.withDescription("How many built-but-unpublished entries to publish this batch."),
  Options.withDefault(5),
);
const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the triage report as JSON for an operator agent to parse."),
);
const detachOption = Options.boolean("detach").pipe(
  Options.withDescription("Start the run in the background (smithers up -d) and return immediately, so you can poll with `xiv stack triage`."),
);

function workflowFor(command: "implement" | "review" | "ship"): WorkflowName {
  if (command === "implement") return "linear-implement";
  if (command === "review") return "pr-review-loop";
  return "linear-to-pr";
}

function toEffect(task: () => Promise<void>): Effect.Effect<void, unknown> {
  return Effect.tryPromise({
    try: task,
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(error instanceof Error ? error.message : String(error)).pipe(
        Effect.flatMap(() => Effect.fail(error)),
      ),
    ),
  );
}

function smithersHome(): string {
  return defaultSmithersHome();
}

function stackMapPathFor(feature: string): AbsolutePath {
  return resolveStackMapPath(smithersHome(), process.cwd(), feature);
}

function runInstallCommand(): Effect.Effect<void, unknown> {
  return toEffect(async () => {
    const result = await installPack({
      packRoot: packagedPackRoot(),
      smithersHome: smithersHome(),
      runInstall: true,
    });
    console.log(`Installed ${result.copied} managed files to ${result.smithersHome}. Backups: ${result.backups}.`);
  });
}

function optionValue<T>(value: Option.Option<T>): T | undefined {
  return Option.match(value, {
    onNone: () => undefined,
    onSome: (inner) => inner,
  });
}

function runWorkflowCommand(options: {
  readonly workflow: WorkflowName;
  readonly input: Record<string, unknown>;
}): Effect.Effect<void, unknown> {
  return toEffect(() =>
    runWorkflow({
      smithersHome: smithersHome(),
      targetCwd: process.cwd(),
      workflow: options.workflow,
      input: options.input,
    }),
  );
}

function runPassthroughCommand(command: SmithersPassthroughCommand, args: readonly string[]): Effect.Effect<void, unknown> {
  return toEffect(() => runPassthrough({ smithersHome: smithersHome(), command, args }));
}

/** Like runWorkflowCommand, but preflights jj first so stack commands fail fast with a friendly hint. */
function runStackWorkflowCommand(options: {
  readonly workflow: WorkflowName;
  readonly input: Record<string, unknown>;
  readonly detach?: boolean;
}): Effect.Effect<void, unknown> {
  return toEffect(async () => {
    await ensureJjReady(process.cwd());
    await runWorkflow({
      smithersHome: smithersHome(),
      targetCwd: process.cwd(),
      workflow: options.workflow,
      input: options.input,
      detach: options.detach,
    });
  });
}

const init = Command.make("init", {}, runInstallCommand).pipe(
  Command.withDescription("Install the managed Smithers workflow pack into SMITHERS_HOME."),
);
const update = Command.make("update", {}, runInstallCommand).pipe(
  Command.withDescription("Update managed pack files, backing up local drift before overwrite."),
);

const implement = Command.make(
  "implement",
  { issueId: issueIdArg, tdd: tddFlag },
  ({ issueId, tdd }) =>
    runWorkflowCommand({
      workflow: workflowFor("implement"),
      input: implementInput({ issueId, tdd }),
    }),
).pipe(
  Command.withDescription("Implement a Linear issue on a dedicated branch."),
);

const review = Command.make(
  "review",
  { prNumber: prOption, branch: branchOption, base: baseOption },
  ({ prNumber, branch, base }) => {
    const resolvedPrNumber = optionValue(prNumber);
    const resolvedBranch = optionValue(branch);
    if (resolvedPrNumber !== undefined && resolvedBranch !== undefined) {
      return Effect.fail(new Error("Use either --pr or --branch, not both."));
    }

    return runWorkflowCommand({
      workflow: workflowFor("review"),
      input: reviewInput({ prNumber: resolvedPrNumber, branch: resolvedBranch, base }),
    });
  },
).pipe(
  Command.withDescription("Open or attach to a PR, trigger AI review, and loop until reviewers approve."),
);

const ship = Command.make(
  "ship",
  { issueId: issueIdArg, base: baseOption, tdd: tddFlag },
  ({ issueId, base, tdd }) =>
    runWorkflowCommand({
      workflow: workflowFor("ship"),
      input: shipInput({ issueId, base, tdd }),
    }),
).pipe(
  Command.withDescription("Implement a Linear issue, open a PR, and drive review to approval."),
);

const dev = Command.make(
  "dev",
  { workflow: workflowArg, input: inputOption, cwd: cwdOption },
  ({ workflow, input, cwd }) =>
    toEffect(() =>
      runDevWorkflow({
        packRoot: packagedPackRoot(),
        targetCwd: optionValue(cwd) ?? process.cwd(),
        workflow,
        input: parseInput(input),
      }),
    ),
).pipe(
  Command.withDescription("Run a workflow straight from the repo's pack/ (no SMITHERS_HOME install) — the fast authoring loop."),
);

const check = Command.make(
  "check",
  { workflow: workflowArg, input: inputOption, cwd: cwdOption },
  ({ workflow, input, cwd }) =>
    toEffect(() =>
      checkDevWorkflow({
        packRoot: packagedPackRoot(),
        targetCwd: optionValue(cwd) ?? process.cwd(),
        workflow,
        input: parseInput(input),
      }),
    ),
).pipe(
  Command.withDescription("Render a workflow's graph from the repo's pack/ without executing it."),
);

const ps = Command.make("ps", { args: trailingArgs }, ({ args }) => runPassthroughCommand("ps", args)).pipe(
  Command.withDescription("Forward to `smithers ps` in SMITHERS_HOME."),
);
const logs = Command.make("logs", { args: trailingArgs }, ({ args }) => runPassthroughCommand("logs", args)).pipe(
  Command.withDescription("Forward to `smithers logs` in SMITHERS_HOME."),
);
const ui = Command.make("ui", { args: trailingArgs }, ({ args }) => runPassthroughCommand("ui", args)).pipe(
  Command.withDescription("Forward to `smithers ui` in SMITHERS_HOME."),
);
const inspect = Command.make("inspect", { args: trailingArgs }, ({ args }) => runPassthroughCommand("inspect", args)).pipe(
  Command.withDescription("Forward to `smithers inspect` in SMITHERS_HOME."),
);

const stackInit = Command.make("init", {}, () =>
  toEffect(() => runStackInit({ targetCwd: process.cwd() })),
).pipe(
  Command.withDescription("Switch on jj in the current repo (one-time `jj git init --colocate`; reversible)."),
);

const stackPlan = Command.make(
  "plan",
  { source: sourceArg, feature: featureOption, base: baseOption },
  ({ source, feature, base }) =>
    runStackWorkflowCommand({
      workflow: "stack-plan",
      input: stackPlanInput({
        source,
        feature,
        base,
        repoSlug: repoSlugFor(process.cwd()),
        stackMapPath: stackMapPathFor(feature),
      }),
    }),
).pipe(
  Command.withDescription("Fetch a Linear project/parent issue, linearize its issues into a stack, and write the stack map."),
);

const stackBuild = Command.make("build", { feature: featureOption, detach: detachOption }, ({ feature, detach }) =>
  runStackWorkflowCommand({
    workflow: "stack-build",
    input: stackBuildInput({ stackMapPath: stackMapPathFor(feature) }),
    detach,
  }),
).pipe(
  Command.withDescription("Build every pending stack entry on its own branch, locally, bottom to top. Resumable. --detach to run overnight in the background."),
);

const stackStatus = Command.make("status", { feature: featureOption }, ({ feature }) =>
  toEffect(() => runStackStatus({ smithersHome: smithersHome(), targetCwd: process.cwd(), feature })),
).pipe(
  Command.withDescription("Print the stack map: positions, statuses, branches, and PRs."),
);

const stackPreview = Command.make("preview", { feature: featureOption }, ({ feature }) =>
  toEffect(() => runStackPreview({ smithersHome: smithersHome(), targetCwd: process.cwd(), feature })),
).pipe(
  Command.withDescription("Check out the stack tip to preview the whole feature locally."),
);

const stackTriage = Command.make("triage", { feature: featureOption, json: jsonOption }, ({ feature, json }) =>
  toEffect(() => runStackTriage({ smithersHome: smithersHome(), targetCwd: process.cwd(), feature }, { json })),
).pipe(
  Command.withDescription("Print a compact, structured status (phase + suggested next action) for operating the stack."),
);

const stackPush = Command.make(
  "push",
  { feature: featureOption, count: countOption },
  ({ feature, count }) =>
    runStackWorkflowCommand({
      workflow: "stack-push",
      input: stackPushInput({ stackMapPath: stackMapPathFor(feature), count }),
    }),
).pipe(
  Command.withDescription("Publish the next N built entries as stacked PRs, and re-sync re-flowed open PRs."),
);

const stackAmend = Command.make(
  "amend",
  { feature: featureOption, message: messageOption, target: targetOption },
  ({ feature, message, target }) =>
    runStackWorkflowCommand({
      workflow: "stack-amend",
      input: stackAmendInput({ stackMapPath: stackMapPathFor(feature), message, target: optionValue(target) }),
    }),
).pipe(
  Command.withDescription("Apply a change to a stack entry and re-flow it through every descendant."),
);

const stack = Command.make("stack", {}, () =>
  Console.log("Run `xiv stack --help` to list stack subcommands."),
).pipe(
  Command.withDescription("Build and manage a stacked-PR feature: init, plan, build, preview, amend, push, status, triage."),
  Command.withSubcommands([
    stackInit,
    stackPlan,
    stackBuild,
    stackStatus,
    stackPreview,
    stackTriage,
    stackPush,
    stackAmend,
  ]),
);

const root = Command.make("xiv", {}, () =>
  Console.log("Run `xiv --help` to list commands."),
).pipe(
  Command.withDescription("Run the xiv Smithers workflows from the current repository."),
  Command.withSubcommands([
    init,
    update,
    implement,
    review,
    ship,
    stack,
    dev,
    check,
    ps,
    logs,
    ui,
    inspect,
  ]),
);

const cli = Command.run(root, {
  name: "xiv",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
