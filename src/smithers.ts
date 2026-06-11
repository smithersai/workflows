import { join } from "node:path";
import type {
  AbsolutePath,
  BaseBranchName,
  BranchName,
  IssueId,
  PassthroughOptions,
  PullRequestNumber,
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

function smithersBin(smithersHome: AbsolutePath): AbsolutePath {
  return join(smithersHome, "node_modules", ".bin", "smithers");
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

export async function runWorkflow(options: WorkflowRunOptions): Promise<void> {
  if (!await isInitialized(options.smithersHome)) {
    throw new Error(`Smithers pack is not initialized at ${options.smithersHome}. Run xiv init first.`);
  }

  await runInherited({
    cmd: [
      smithersBin(options.smithersHome),
      "up",
      join(options.smithersHome, "workflows", `${options.workflow}.tsx`),
      "--input",
      JSON.stringify(options.input),
    ],
    cwd: options.smithersHome,
    env: {
      ...process.env,
      SMITHERS_TARGET_CWD: options.targetCwd,
    },
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
