import { z } from "zod/v4";

export const linearIssueSchema = z.object({
  // MUST be explicitly true only when the issue content was actually retrieved from
  // Linear. On every fetch failure (auth, not-found, MCP transport) the agent returns
  // false and the workflow hard-fails before planning — otherwise the error text
  // flows downstream and gets faithfully "implemented" as if it were the issue.
  fetched: z.boolean().default(true),
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
