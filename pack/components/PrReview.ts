import { z } from "zod/v4";

/**
 * Shapes for the GitHub-only signals on a pull request: continuous-integration status and the
 * review comments humans left on it. Code review itself is done locally by a review agent (see
 * LocalReview.ts) — nothing here waits on, polls for, or classifies a remote reviewer.
 */

/** Aggregate state of a PR's status checks. `none` means the repo runs no checks on this PR. */
export const ciStatusSchema = z.enum(["passing", "failing", "pending", "none"]);

/** Where an actionable item came from. Both are signals only GitHub can supply. */
export const prFindingSourceSchema = z.enum(["ci", "human"]);

/** One actionable item on a PR: a failing check or an unresolved human review comment. */
export const prFindingSchema = z.object({
  source: prFindingSourceSchema,
  /** Who/what raised it — a check name for `ci`, a GitHub login for `human`. */
  origin: z.string().default(""),
  /** Repo-relative file path the item refers to, or null when it is not file-specific. */
  path: z.string().nullable().default(null),
  body: z.string(),
});

export const prOpenSchema = z.object({
  prNumber: z.number().int(),
  prUrl: z.string(),
  headSha: z.string().default(""),
});

/** A single PR's CI + human-comment state at its current head. */
export const prSignalsSchema = z.object({
  ci: ciStatusSchema.default("none"),
  /** Names of the checks that are currently failing (empty when `ci` is not `failing`). */
  failingChecks: z.array(z.string()).default([]),
  findings: z.array(prFindingSchema).default([]),
  /** True only when checks are green (or absent) AND no human comment is left unaddressed. */
  clean: z.boolean().default(false),
  headSha: z.string().default(""),
});

export const addressFindingsSchema = z.object({
  addressed: z
    .array(z.object({ finding: z.string(), commit: z.string().default("") }))
    .default([]),
  skipped: z
    .array(z.object({ finding: z.string(), reason: z.string() }))
    .default([]),
  headSha: z.string().default(""),
});

export type CiStatus = z.infer<typeof ciStatusSchema>;
export type PrFindingSource = z.infer<typeof prFindingSourceSchema>;
export type PrFinding = z.infer<typeof prFindingSchema>;
export type PrOpen = z.infer<typeof prOpenSchema>;
export type PrSignals = z.infer<typeof prSignalsSchema>;
export type AddressFindings = z.infer<typeof addressFindingsSchema>;
