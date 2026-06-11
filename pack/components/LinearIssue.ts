import { z } from "zod/v4";

export const linearIssueSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  comments: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  url: z.string().default(""),
});

export const finalizeSchema = z.object({
  branch: z.string(),
  headSha: z.string().default(""),
  issueKey: z.string(),
  title: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  summary: z.string(),
});

export type LinearIssue = z.infer<typeof linearIssueSchema>;
export type FinalizeResult = z.infer<typeof finalizeSchema>;
