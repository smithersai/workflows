import { z } from "zod/v4";
import { ciStatusSchema, prFindingSchema } from "./PrReview";

/** One PR's GitHub-only signals within the stack (reuses PrReview's CI + finding shapes). */
export const stackPrSignalsSchema = z.object({
  prNumber: z.number().int(),
  branch: z.string(),
  ci: ciStatusSchema.default("none"),
  findings: z.array(prFindingSchema).default([]),
});

/** Stack-wide signal sweep: the CI + human-comment state of every open PR in the stack. */
export const stackSignalsSchema = z.object({
  prs: z.array(stackPrSignalsSchema).default([]),
  /** True only when every PR has green (or absent) checks and no unaddressed human comment. */
  clean: z.boolean().default(false),
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

export const stackReviewReportSchema = z.object({
  resolved: z.boolean().default(false),
  pending: z.array(z.string()).default([]),
  summary: z.string(),
});

export type StackPrSignals = z.infer<typeof stackPrSignalsSchema>;
export type StackSignals = z.infer<typeof stackSignalsSchema>;
export type StackAddress = z.infer<typeof stackAddressSchema>;
export type StackReviewReport = z.infer<typeof stackReviewReportSchema>;
