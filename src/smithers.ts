import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  AbsolutePath,
  BaseBranchName,
  BranchName,
  DevWorkflowOptions,
  FeatureName,
  IssueId,
  PassthroughOptions,
  PullRequestNumber,
  RepoConfig,
  RepoKey,
  RepoSlug,
  WorkflowRunOptions,
} from "./types";
import { isInitialized } from "./manifest";
import { runInherited } from "./process";

export interface ImplementCommand {
  readonly issueId: IssueId;
  readonly tdd: boolean;
}

export interface ReviewCommand {
  readonly prNumber?: PullRequestNumber;
  readonly branch?: BranchName;
  readonly base: BaseBranchName;
}

export interface ShipCommand {
  readonly issueId: IssueId;
  readonly base: BaseBranchName;
  readonly tdd: boolean;
}

export function smithersBin(root: AbsolutePath): AbsolutePath {
  return join(root, "node_modules", ".bin", "smithers");
}

function isInputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a raw `--input` JSON string into a workflow input object. Throws on non-object JSON. */
export function parseInput(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isInputRecord(parsed)) {
    throw new Error(`--input must be a JSON object, e.g. '{"issueId":"ENG-123"}'.`);
  }
  return parsed;
}

/** Resolve a workflow name or path to a path smithers can load, relative to the pack root. */
export function resolveWorkflowPath(workflow: string): string {
  if (isAbsolute(workflow) || workflow.endsWith(".tsx")) return workflow;
  return join("workflows", `${workflow}.tsx`);
}

function ensurePackInstalled(packRoot: AbsolutePath): void {
  if (!existsSync(smithersBin(packRoot))) {
    throw new Error(`Pack dependencies are not installed. Run \`bun install\` in ${packRoot} first.`);
  }
}

export function implementInput(command: ImplementCommand): Record<string, unknown> {
  return { issueId: command.issueId, tdd: command.tdd };
}

export function reviewInput(command: ReviewCommand): Record<string, unknown> {
  const input: Record<string, unknown> = { base: command.base };
  if (command.prNumber !== undefined) input.prNumber = command.prNumber;
  if (command.branch !== undefined) input.branch = command.branch;
  return input;
}

export function shipInput(command: ShipCommand): Record<string, unknown> {
  return { issueId: command.issueId, base: command.base, tdd: command.tdd };
}

export interface StackPlanCommand {
  /** A Linear project ID or parent issue key whose sub-issues become the stack. */
  readonly source: string;
  readonly feature: FeatureName;
  readonly repoSlug: RepoSlug;
  /** The repo(s) this feature may span, keyed by RepoKey. A single-repo feature has one entry. */
  readonly repos: Record<RepoKey, RepoConfig>;
  readonly stackMapPath: AbsolutePath;
}

export function stackPlanInput(command: StackPlanCommand): Record<string, unknown> {
  return {
    source: command.source,
    feature: command.feature,
    repoSlug: command.repoSlug,
    repos: command.repos,
    stackMapPath: command.stackMapPath,
  };
}

export interface StackBuildCommand {
  readonly stackMapPath: AbsolutePath;
  /** Build only this repo's substack. Omit for a single-repo stack. */
  readonly repo?: RepoKey;
}

export function stackBuildInput(command: StackBuildCommand): Record<string, unknown> {
  const input: Record<string, unknown> = { stackMapPath: command.stackMapPath };
  if (command.repo !== undefined) input.repo = command.repo;
  return input;
}

export interface StackAmendCommand {
  readonly stackMapPath: AbsolutePath;
  /** The change to make to the located entry. */
  readonly message: string;
  /** An explicit entry to amend (issue key or branch). Omit to let the workflow locate it. */
  readonly target?: string;
  /** The repo whose substack is being amended (scopes locate + sets the working repo). */
  readonly repo?: RepoKey;
}

export function stackAmendInput(command: StackAmendCommand): Record<string, unknown> {
  const input: Record<string, unknown> = { stackMapPath: command.stackMapPath, message: command.message };
  if (command.target !== undefined) input.target = command.target;
  if (command.repo !== undefined) input.repo = command.repo;
  return input;
}

export interface StackPushCommand {
  readonly stackMapPath: AbsolutePath;
  /** How many unpublished entries to publish this batch. */
  readonly count: number;
  /** Publish only this repo's substack. Omit for a single-repo stack. */
  readonly repo?: RepoKey;
  /** Open each PR as a draft (default true for batch publishing). */
  readonly draft: boolean;
}

export function stackPushInput(command: StackPushCommand): Record<string, unknown> {
  const input: Record<string, unknown> = {
    stackMapPath: command.stackMapPath,
    count: command.count,
    draft: command.draft,
  };
  if (command.repo !== undefined) input.repo = command.repo;
  return input;
}

export interface StackReviewCommand {
  readonly stackMapPath: AbsolutePath;
  /** Review only this repo's substack. Omit for a single-repo stack. */
  readonly repo?: RepoKey;
  /** Reviewer handles to poll and re-request (e.g. ["claude", "codex"]). */
  readonly reviewers: readonly string[];
}

export function stackReviewInput(command: StackReviewCommand): Record<string, unknown> {
  const input: Record<string, unknown> = {
    stackMapPath: command.stackMapPath,
    reviewers: command.reviewers,
  };
  if (command.repo !== undefined) input.repo = command.repo;
  return input;
}

export async function runWorkflow(options: WorkflowRunOptions): Promise<void> {
  if (!await isInitialized(options.smithersHome)) {
    throw new Error(`Smithers pack is not initialized at ${options.smithersHome}. Run xiv init first.`);
  }

  const cmd = [
    smithersBin(options.smithersHome),
    "up",
    join(options.smithersHome, "workflows", `${options.workflow}.tsx`),
    "--input",
    JSON.stringify(options.input),
  ];
  if (options.detach === true) cmd.push("-d");

  await runInherited({
    cmd,
    cwd: options.smithersHome,
    env: {
      ...process.env,
      SMITHERS_TARGET_CWD: options.targetCwd,
    },
  });
}

/**
 * Run a workflow straight from the repo's `pack/` (no install into SMITHERS_HOME).
 * This is the fast authoring loop: edit `pack/workflows/<name>.tsx`, re-run, repeat.
 */
export async function runDevWorkflow(options: DevWorkflowOptions): Promise<void> {
  ensurePackInstalled(options.packRoot);
  await runInherited({
    cmd: [
      smithersBin(options.packRoot),
      "up",
      resolveWorkflowPath(options.workflow),
      "--input",
      JSON.stringify(options.input),
    ],
    cwd: options.packRoot,
    env: { ...process.env, SMITHERS_TARGET_CWD: options.targetCwd },
  });
}

/** Render a workflow's graph from the in-repo `pack/` without executing it. */
export async function checkDevWorkflow(options: DevWorkflowOptions): Promise<void> {
  ensurePackInstalled(options.packRoot);
  await runInherited({
    cmd: [
      smithersBin(options.packRoot),
      "graph",
      resolveWorkflowPath(options.workflow),
      "--input",
      JSON.stringify(options.input),
    ],
    cwd: options.packRoot,
    env: { ...process.env, SMITHERS_TARGET_CWD: options.targetCwd },
  });
}

export async function runPassthrough(options: PassthroughOptions): Promise<void> {
  if (!await isInitialized(options.smithersHome)) {
    throw new Error(`Smithers pack is not initialized at ${options.smithersHome}. Run xiv init first.`);
  }

  await runInherited({
    cmd: [smithersBin(options.smithersHome), options.command, ...options.args],
    cwd: options.smithersHome,
    env: process.env,
  });
}
