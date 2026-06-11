import { z } from "zod/v4";

export const reviewerStatusSchema = z.enum(["approved", "findings", "pending"]);
export const reviewerKindSchema = z.enum(["bot", "human"]);

export const reviewFindingSchema = z.object({
  path: z.string().nullable().default(null),
  body: z.string(),
});

export const reviewerStateSchema = z.object({
  name: z.string(),
  kind: reviewerKindSchema,
  status: reviewerStatusSchema,
  findings: z.array(reviewFindingSchema).default([]),
});

export const prOpenSchema = z.object({
  prNumber: z.number().int(),
  prUrl: z.string(),
  headSha: z.string().default(""),
});

export const reviewStateSchema = z.object({
  reviewers: z.array(reviewerStateSchema).default([]),
  allResolved: z.boolean().default(false),
  pending: z.array(z.string()).default([]),
  timedOut: z.boolean().default(false),
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

export const rerequestSchema = z.object({
  commentUrl: z.string().default(""),
  body: z.string(),
});

export type PrOpen = z.infer<typeof prOpenSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type AddressFindings = z.infer<typeof addressFindingsSchema>;
export type Rerequest = z.infer<typeof rerequestSchema>;
