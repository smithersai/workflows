#!/usr/bin/env bun
import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { installPack } from "./manifest";
import { defaultSmithersHome, packagedPackRoot } from "./paths";
import { implementInput, reviewInput, runPassthrough, runWorkflow, shipInput } from "./smithers";
import type { BaseBranchName, BranchName, IssueId, PullRequestNumber, SmithersPassthroughCommand, WorkflowName } from "./types";

interface ParsedFlag {
  readonly name: string;
  readonly value?: string;
}

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: readonly ParsedFlag[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: ParsedFlag[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.push({ name, value: next });
      index += 1;
    } else {
      flags.push({ name });
    }
  }

  return { positionals, flags };
}

function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.find((flag) => flag.name === name)?.value;
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.some((flag) => flag.name === name);
}

function requireText(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function parsePrNumber(value: string | undefined): PullRequestNumber | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --pr value: ${value}`);
  }
  return parsed;
}

function parseBase(parsed: ParsedArgs): BaseBranchName {
  return flagValue(parsed, "base") ?? "main";
}

function isPassthrough(command: string): command is SmithersPassthroughCommand {
  return command === "ps" || command === "logs" || command === "ui" || command === "inspect";
}

function workflowFor(command: "implement" | "review" | "ship"): WorkflowName {
  if (command === "implement") return "linear-implement";
  if (command === "review") return "pr-review-loop";
  return "linear-to-pr";
}

async function execute(args: readonly string[]): Promise<void> {
  const command = args[0];
  const rest = args.slice(1);
  const smithersHome = defaultSmithersHome();

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init" || command === "update") {
    const result = await installPack({
      packRoot: packagedPackRoot(),
      smithersHome,
      runInstall: true,
    });
    console.log(`Installed ${result.copied} managed files to ${result.smithersHome}. Backups: ${result.backups}.`);
    return;
  }

  if (command === "implement") {
    const parsed = parseArgs(rest);
    const issueId: IssueId = requireText(parsed.positionals[0], "issueId");
    await runWorkflow({
      smithersHome,
      targetCwd: process.cwd(),
      workflow: workflowFor(command),
      input: implementInput({ issueId, tdd: hasFlag(parsed, "tdd") }),
    });
    return;
  }

  if (command === "review") {
    const parsed = parseArgs(rest);
    const prNumber = parsePrNumber(flagValue(parsed, "pr"));
    const branch: BranchName | undefined = flagValue(parsed, "branch");
    if (prNumber !== undefined && branch !== undefined) {
      throw new Error("Use either --pr or --branch, not both.");
    }
    await runWorkflow({
      smithersHome,
      targetCwd: process.cwd(),
      workflow: workflowFor(command),
      input: reviewInput({ prNumber, branch, base: parseBase(parsed) }),
    });
    return;
  }

  if (command === "ship") {
    const parsed = parseArgs(rest);
    const issueId: IssueId = requireText(parsed.positionals[0], "issueId");
    await runWorkflow({
      smithersHome,
      targetCwd: process.cwd(),
      workflow: workflowFor(command),
      input: shipInput({ issueId, base: parseBase(parsed), tdd: hasFlag(parsed, "tdd") }),
    });
    return;
  }

  if (isPassthrough(command)) {
    await runPassthrough({ smithersHome, command, args: rest });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
  console.log(`xiv

Commands:
  xiv init | update
  xiv implement <issueId> [--tdd]
  xiv review [--pr <n> | --branch <branch>] [--base <base>]
  xiv ship <issueId> [--base <base>] [--tdd]
  xiv ps | logs | ui | inspect [...]
`);
}

const allArgs = Args.text({ name: "args" }).pipe(Args.repeated);
const command = Command.make("xiv", { args: allArgs }, ({ args }) =>
  Effect.tryPromise({
    try: () => execute(args),
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(error instanceof Error ? error.message : String(error)).pipe(
        Effect.flatMap(() => Effect.fail(error)),
      ),
    ),
  ),
);

const cli = Command.run(command, {
  name: "xiv",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
