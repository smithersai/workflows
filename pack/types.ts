export type IssueId = string;
export type BranchName = string;
export type BaseBranchName = string;
export type GitSha = string;
export type PullRequestNumber = number;
export type PullRequestUrl = string;
export type LinearIssueKey = string;
export type LinearIssueUrl = string;
export type SummaryText = string;
export type MarkdownText = string;
export type ModelName = string;
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

// Review vocabulary (verdict + severity) lives with its zod schema in components/LocalReview.ts;
// CI / PR-signal vocabulary lives in components/PrReview.ts. Both are derived from the schema via
// z.infer so there is exactly one declaration of each.
