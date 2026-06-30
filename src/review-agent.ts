import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { localReviewSchema, type LocalReview } from "../pack/components/LocalReview";
import { runCaptured } from "./process";
import type { AbsolutePath, OwnerRepo, PullRequestDetail } from "./types";

const SCHEMA_SPEC = `{
  "verdict": "approve" | "request_changes" | "comment",
  "summary": string,                       // markdown; the top-level review body
  "findings": [
    {
      "id": string,                        // unique per finding, e.g. "f1", "f2"
      "severity": "blocker" | "high" | "medium" | "low" | "nit",
      "title": string,
      "body": string,                      // markdown
      "path": string | null,               // repo-relative file path, or null for a general finding
      "startLine": number | null,          // range start, or null for a single-line/general finding
      "line": number | null,               // the anchor (end) line, or null for a general finding
      "inlineable": boolean                // true ONLY if "line" is on the diff's new (RIGHT) side
    }
  ]
}`;

const DEFAULT_EXTRA =
  "Be concise and high-signal; do not invent issues to fill a quota. If the PR is clean, approve it.";

function reviewEngine(): "claude" | "codex" {
  return process.env.XIV_ENGINE === "codex" ? "codex" : "claude";
}

function claudeModel(): string {
  const override = process.env.XIV_MODEL_HEAVY;
  if (override !== undefined && override.trim() !== "") return override;
  return process.env.XIV_TIER === "quality" ? "claude-opus-4-8" : "claude-sonnet-4-6";
}

function fill(template: string, tokens: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export interface LocalReviewOptions {
  readonly worktreePath: AbsolutePath;
  readonly scratchDir: AbsolutePath;
  readonly ownerRepo: OwnerRepo;
  readonly pr: PullRequestDetail;
  readonly baseRef: string;
  readonly headSha: string;
  /** Absolute path to a prompt template; defaults to the packaged pack/prompts/local-review.md. */
  readonly promptFile: AbsolutePath;
  /** Extra reviewer instructions appended to the prompt (e.g. a focus area). */
  readonly extraInstructions?: string;
}

/**
 * Run the review agent inside the worktree and return the validated findings. The agent writes its
 * result to a findings file (engine-agnostic — no stdout parsing); we then read and Zod-validate it.
 */
export async function runLocalReview(options: LocalReviewOptions): Promise<LocalReview> {
  const templateFile = Bun.file(options.promptFile);
  if (!(await templateFile.exists())) {
    throw new Error(`Review prompt template not found: ${options.promptFile}`);
  }
  const template = await templateFile.text();

  await mkdir(options.scratchDir, { recursive: true });
  const outputPath = join(options.scratchDir, "findings.json");
  if (existsSync(outputPath)) await rm(outputPath);

  const prompt = fill(template, {
    REPO: options.ownerRepo,
    PR_NUMBER: String(options.pr.number),
    PR_TITLE: options.pr.title,
    PR_AUTHOR: options.pr.author,
    BASE: options.baseRef,
    HEAD_SHA: options.headSha,
    PR_BODY: options.pr.body.trim() === "" ? "(no description provided)" : options.pr.body,
    EXTRA_INSTRUCTIONS: options.extraInstructions ?? DEFAULT_EXTRA,
    OUTPUT_PATH: outputPath,
    SCHEMA: SCHEMA_SPEC,
  });

  const cmd =
    reviewEngine() === "codex"
      ? [
          "codex", "exec", "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
          "-m", process.env.XIV_CODEX_MODEL ?? "gpt-5.5", prompt,
        ]
      : [
          "claude", "-p", prompt, "--model", claudeModel(),
          "--dangerously-skip-permissions", "--add-dir", options.scratchDir,
        ];

  const result = await runCaptured({ cmd, cwd: options.worktreePath, env: process.env });
  if (!existsSync(outputPath)) {
    const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
    throw new Error(`The review agent did not produce ${outputPath}. Engine output:\n${detail}`);
  }

  const raw: unknown = JSON.parse(await Bun.file(outputPath).text());
  const review = localReviewSchema.parse(raw);

  // Normalize finding ids so the picker always has a unique, stable key per finding.
  const findings = review.findings.map((finding, index) => ({
    ...finding,
    id: finding.id.trim() === "" ? `f${index + 1}` : finding.id,
  }));
  return { ...review, findings };
}
