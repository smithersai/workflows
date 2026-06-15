export type IssueId = string;
export type BranchName = string;
export type BaseBranchName = string;
export type GitSha = string;
export type PullRequestNumber = number;
export type PullRequestUrl = string;
export type ReviewerLogin = string;
export type LinearIssueKey = string;
export type LinearIssueUrl = string;
export type SummaryText = string;
export type MarkdownText = string;
export type ModelName = string;
export type ReasoningEffort = "low" | "medium" | "high";

export type ReviewSeverity = "critical" | "major" | "minor" | "nit";
export type ReviewerKind = "bot" | "human";
export type ReviewerStatus = "approved" | "findings" | "pending";
