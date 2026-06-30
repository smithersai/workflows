#!/usr/bin/env bun
import { resolve } from "node:path";
import { Args, Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Option } from "effect";
import { howToGuide } from "./howto";
import { installPack } from "./manifest";
import { defaultSmithersHome, packagedPackRoot } from "./paths";
import { runPrReview } from "./pr-review";
import {
  checkDevWorkflow,
  implementInput,
  parseInput,
  reviewInput,
  runDevWorkflow,
  runPassthrough,
  runWorkflow,
  shipInput,
} from "./smithers";
import {
  parseRepoArgs,
  runStackAmend,
  runStackBuild,
  runStackInit,
  runStackPlan,
  runStackPlanFromFile,
  runStackPreview,
  runStackPush,
  runStackReview,
  runStackStatus,
  runStackTriage,
} from "./stack";
import type { SmithersPassthroughCommand, WorkflowName } from "./types";

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
  Args.optional,
);
const planOption = Options.text("plan").pipe(
  Options.withDescription("Persist a resolved plan file (from the stack-plan skill) instead of running the planner."),
  Options.optional,
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
const reviewersOption = Options.text("reviewers").pipe(
  Options.withDescription("Comma-separated reviewer handles to poll and re-request (default: claude,codex)."),
  Options.withDefault("claude,codex"),
);
const draftOption = Options.boolean("draft").pipe(
  Options.withDescription("Open each PR as a draft. Default true; pass --no-draft to open ready-for-review PRs."),
  Options.withDefault(true),
);
const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the triage report as JSON for an operator agent to parse."),
);
const detachOption = Options.boolean("detach").pipe(
  Options.withDescription("Start the run in the background (smithers up -d) and return immediately, so you can poll with `xiv stack triage`."),
);
const repoArgsOption = Options.text("repo").pipe(
  Options.withDescription("Assign a repo as key=path (repeatable). Omit for a single-repo stack rooted at the current directory."),
  Options.repeated,
);
const repoKeyOption = Options.text("repo").pipe(
  Options.withDescription("Operate on this repo's substack (a key from the stack map)."),
  Options.optional,
);
const allReposOption = Options.boolean("all-repos").pipe(
  Options.withDescription("Fan out across every repo in the stack, one pinned run per repo, in parallel."),
);
const prReviewRepoOption = Options.text("repo").pipe(
  Options.withDescription("Target repo as owner/name. Defaults to the current directory's repo; auto-cloned if not present locally."),
  Options.optional,
);
const promptFileOption = Options.text("prompt-file").pipe(
  Options.withDescription("Path to a custom review-prompt template (Markdown). Defaults to the packaged local-review prompt."),
  Options.optional,
);
const keepWorktreeOption = Options.boolean("keep").pipe(
  Options.withDescription("Keep the review worktree after submitting (default: remove it)."),
);
const autoSubmitOption = Options.boolean("auto-submit").pipe(
  Options.withDescription("Skip the interactive prompts and submit the agent's verdict with all inline-able findings."),
);
const prNumberArg = Args.integer({ name: "prNumber" }).pipe(
  Args.withDescription("PR number to review. Omit to pick from a list of open PRs."),
  Args.optional,
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

function stackContext(feature: string) {
  return { smithersHome: smithersHome(), targetCwd: process.cwd(), feature };
}

const howTo = Command.make("how-to", {}, () => Console.log(howToGuide())).pipe(
  Command.withDescription("Print the orchestration runbook: how to drive a Linear feature to completion with `xiv stack`."),
);

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
const down = Command.make("down", { args: trailingArgs }, ({ args }) => runPassthroughCommand("down", args)).pipe(
  Command.withDescription("Cancel ALL active/orphaned Smithers runs (like `docker compose down`). Use to clear stale 'running' runs."),
);
const cancel = Command.make("cancel", { args: trailingArgs }, ({ args }) => runPassthroughCommand("cancel", args)).pipe(
  Command.withDescription("Forward to `smithers cancel` in SMITHERS_HOME (cancel a specific run)."),
);

const stackInit = Command.make("init", {}, () =>
  toEffect(() => runStackInit({ targetCwd: process.cwd() })),
).pipe(
  Command.withDescription("Switch on jj in the current repo (one-time `jj git init --colocate`; reversible)."),
);

const stackPlan = Command.make(
  "plan",
  { source: sourceArg, feature: featureOption, base: baseOption, repos: repoArgsOption, plan: planOption },
  ({ source, feature, base, repos, plan }) => {
    const repoRegistry = parseRepoArgs(repos, base, process.cwd());
    const planPath = optionValue(plan);
    if (planPath !== undefined) {
      return toEffect(() => runStackPlanFromFile(stackContext(feature), { planPath, repos: repoRegistry }));
    }
    const resolvedSource = optionValue(source);
    if (resolvedSource === undefined) {
      return Effect.fail(new Error("Provide a <source> (Linear project or parent issue) or --plan <file>."));
    }
    return toEffect(() => runStackPlan(stackContext(feature), { source: resolvedSource, repos: repoRegistry }));
  },
).pipe(
  Command.withDescription("Plan a stack: fetch a Linear project/parent and assign issues to repos, or persist a resolved --plan <file> from the stack-plan skill. --repo key=path (repeatable) for multi-repo."),
);

const stackBuild = Command.make(
  "build",
  { feature: featureOption, repo: repoKeyOption, allRepos: allReposOption, detach: detachOption },
  ({ feature, repo, allRepos, detach }) =>
    toEffect(() => runStackBuild(stackContext(feature), { repo: optionValue(repo), allRepos, detach })),
).pipe(
  Command.withDescription("Build entries locally, bottom to top. Resumable. --all-repos fans out per repo (parallel); --repo <key> builds one; --detach runs in the background."),
);

const stackStatus = Command.make("status", { feature: featureOption }, ({ feature }) =>
  toEffect(() => runStackStatus(stackContext(feature))),
).pipe(
  Command.withDescription("Print the stack map (grouped by repo): positions, statuses, branches, and PRs."),
);

const stackPreview = Command.make("preview", { feature: featureOption }, ({ feature }) =>
  toEffect(() => runStackPreview(stackContext(feature))),
).pipe(
  Command.withDescription("Check out every repo at its stack tip to preview the whole feature locally."),
);

const stackTriage = Command.make("triage", { feature: featureOption, json: jsonOption }, ({ feature, json }) =>
  toEffect(() => runStackTriage(stackContext(feature), { json })),
).pipe(
  Command.withDescription("Print a compact, structured status (overall + per-repo action) for operating the stack."),
);

const stackPush = Command.make(
  "push",
  { feature: featureOption, count: countOption, repo: repoKeyOption, allRepos: allReposOption, draft: draftOption },
  ({ feature, count, repo, allRepos, draft }) =>
    toEffect(() => runStackPush(stackContext(feature), { count, repo: optionValue(repo), allRepos, draft })),
).pipe(
  Command.withDescription("Publish the next N built entries as stacked PRs, and re-sync re-flowed open PRs. --all-repos / --repo <key> for multi-repo."),
);

const stackReview = Command.make(
  "review",
  { feature: featureOption, repo: repoKeyOption, allRepos: allReposOption, reviewers: reviewersOption, detach: detachOption },
  ({ feature, repo, allRepos, reviewers, detach }) =>
    toEffect(() =>
      runStackReview(stackContext(feature), {
        repo: optionValue(repo),
        allRepos,
        reviewers: reviewers.split(",").map((handle) => handle.trim()).filter((handle) => handle.length > 0),
        detach,
      }),
    ),
).pipe(
  Command.withDescription(
    "Drive open stacked PRs to all-reviewers-approved: read findings across the stack, fix each in its owning branch via jj (cascade up), push, re-request, and loop. NEVER merges. --all-repos / --repo <key> for multi-repo; --detach to background.",
  ),
);

const stackAmend = Command.make(
  "amend",
  { feature: featureOption, message: messageOption, target: targetOption, repo: repoKeyOption },
  ({ feature, message, target, repo }) =>
    toEffect(() => runStackAmend(stackContext(feature), { message, target: optionValue(target), repo: optionValue(repo) })),
).pipe(
  Command.withDescription("Apply a change to a stack entry and re-flow it through its repo's descendants. --target <issue> or --repo <key> for multi-repo."),
);

const prReview = Command.make(
  "review",
  {
    prNumber: prNumberArg,
    repo: prReviewRepoOption,
    promptFile: promptFileOption,
    keep: keepWorktreeOption,
    autoSubmit: autoSubmitOption,
  },
  ({ prNumber, repo, promptFile, keep, autoSubmit }) => {
    const promptFilePath = optionValue(promptFile);
    return toEffect(() =>
      runPrReview({
        prNumber: optionValue(prNumber),
        repo: optionValue(repo),
        promptFile: promptFilePath === undefined ? undefined : resolve(process.cwd(), promptFilePath),
        keep,
        autoSubmit,
      }),
    );
  },
).pipe(
  Command.withDescription(
    "Review a remote PR locally: pick an open PR, run an agent in an isolated worktree, then interactively select findings and submit the review (approve/request-changes/comment). NEVER merges.",
  ),
);

const pr = Command.make("pr", {}, () =>
  Console.log("Run `xiv pr --help` to list PR subcommands."),
).pipe(
  Command.withDescription("Work with pull requests interactively. `xiv pr review` reviews a remote PR locally."),
  Command.withSubcommands([prReview]),
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
    stackReview,
    stackAmend,
  ]),
);

const root = Command.make("xiv", {}, () =>
  Console.log("Run `xiv --help` to list commands."),
).pipe(
  Command.withDescription("Run the xiv Smithers workflows from the current repository."),
  Command.withSubcommands([
    howTo,
    init,
    update,
    implement,
    review,
    ship,
    pr,
    stack,
    dev,
    check,
    ps,
    logs,
    ui,
    inspect,
    down,
    cancel,
  ]),
);

const cli = Command.run(root, {
  name: "xiv",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
