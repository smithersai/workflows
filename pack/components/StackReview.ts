import { z } from "zod/v4";
import { reviewerStateSchema } from "./PrReview";

/** One PR's reviewer state within the stack (reuses PrReview's per-reviewer shape). */
export const prReviewSchema = z.object({
  prNumber: z.number().int(),
  branch: z.string(),
  reviewers: z.array(reviewerStateSchema).default([]),
});

/** Stack-wide await output: the review state of every PR in the stack. */
export const stackReviewStateSchema = z.object({
  prs: z.array(prReviewSchema).default([]),
  /** True only when no PR has a `pending` or `findings` reviewer left. */
  allResolved: z.boolean().default(false),
  /** True if polling hit the attempt cap with an expected reviewer still pending. */
  timedOut: z.boolean().default(false),
});

/** Result of the jj-cascade address step. */
export const stackAddressSchema = z.object({
  addressed: z
    .array(
      z.object({
        pr: z.number().int(),
        branch: z.string(),
        finding: z.string(),
        commit: z.string().default(""),
      }),
    )
    .default([]),
  skipped: z
    .array(z.object({ pr: z.number().int(), finding: z.string(), reason: z.string() }))
    .default([]),
  /** Every branch force-pushed this round (the edited branch + rebased descendants). */
  pushedBranches: z.array(z.string()).default([]),
});

export const stackRerequestSchema = z.object({
  rerequested: z
    .array(z.object({ pr: z.number().int(), commentUrl: z.string().default("") }))
    .default([]),
});

export const stackReviewReportSchema = z.object({
  resolved: z.boolean().default(false),
  pending: z.array(z.string()).default([]),
  summary: z.string(),
});

export type PrReviewState = z.infer<typeof prReviewSchema>;
export type StackReviewState = z.infer<typeof stackReviewStateSchema>;
export type StackAddress = z.infer<typeof stackAddressSchema>;
