import { z } from "zod/v4";

/**
 * Shape produced by a local PR review (an agent reading a PR in a worktree). The single source of
 * truth for both the interactive CLI command (`xiv pr review`) and a future Smithers reviewer Task:
 * the CLI parses an agent's output file against `localReviewSchema`; a Smithers Task would use the
 * same export as its `output={}` slot. Mirrors the style of PrReview.ts (zod/v4, nullable defaults).
 */

export const findingSeveritySchema = z.enum(["blocker", "high", "medium", "low", "nit"]);
export const reviewVerdictSchema = z.enum(["approve", "request_changes", "comment"]);

export const localFindingSchema = z.object({
  /** Stable id (e.g. "f1") — used as the value key when selecting findings in the picker. */
  id: z.string(),
  severity: findingSeveritySchema,
  title: z.string(),
  /** Markdown explanation; becomes the inline comment body or a bullet in the summary. */
  body: z.string(),
  /** Repo-relative file path the finding refers to, or null for a general finding. */
  path: z.string().nullable().default(null),
  /** Start line of a multi-line range. Null for a single-line (or non-line) finding. */
  startLine: z.number().int().nullable().default(null),
  /** The line the comment anchors to (the end line of a range). Null for a non-line finding. */
  line: z.number().int().nullable().default(null),
  /** The agent asserts this line is on the diff's RIGHT (added/context) side and is commentable. */
  inlineable: z.boolean().default(false),
});

export const localReviewSchema = z.object({
  verdict: reviewVerdictSchema,
  /** Suggested top-level review body (markdown) the human can edit before submitting. */
  summary: z.string(),
  findings: z.array(localFindingSchema).default([]),
});

export type FindingSeverity = z.infer<typeof findingSeveritySchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type LocalFinding = z.infer<typeof localFindingSchema>;
export type LocalReview = z.infer<typeof localReviewSchema>;
