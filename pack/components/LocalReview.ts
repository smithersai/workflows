import { z } from "zod/v4";

/**
 * Shape produced by a local code review (an agent reading a diff it has checked out). This is THE
 * review schema — there is no second vocabulary. Both consumers use this exact export:
 *
 *   - the interactive CLI (`xiv pr review`), which parses the agent's output file against it;
 *   - the `impl:review` Task in linear-implement, which uses it as its `output={}` slot.
 *
 * The fields are deliberately strict (no default on `verdict`): a reviewer that cannot produce a
 * real verdict must fail its Task rather than silently degrade into a fake one. In the implement
 * loop that Task is `continueOnFail`, so a failed/unparseable review simply yields no review for
 * that iteration and the mechanical validation gate decides on its own.
 *
 * `path` / `startLine` / `line` / `inlineable` anchor a finding to a PR diff. They are only
 * meaningful when the review targets a pushed PR; a local (pre-PR) review leaves `inlineable`
 * false and may still set `path`/`line` to point at the code.
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
