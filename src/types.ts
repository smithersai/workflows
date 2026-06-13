export type AbsolutePath = string;
export type RelativePath = string;
export type FileHash = string;
export type IsoTimestamp = string;
export type IssueId = string;
export type BranchName = string;
export type BaseBranchName = string;
export type PullRequestNumber = number;
export type PullRequestUrl = string;
export type JjChangeId = string;
export type GitSha = string;
export type RepoSlug = string;
export type FeatureName = string;
export type StackPosition = number;
export type WorkflowName =
  | "linear-implement"
  | "pr-review-loop"
  | "linear-to-pr"
  | "stack-plan"
  | "stack-build"
  | "stack-amend"
  | "stack-push";
export type SmithersPassthroughCommand = "ps" | "logs" | "ui" | "inspect";

/** Lifecycle of a single entry (issue/branch) within a stack, bottom to top. */
export type StackStatus =
  | "pending"
  | "implementing"
  | "implemented"
  | "pushed"
  | "pr-open"
  | "merged";

/** Rebase/restack engine backing the stack. jj (Jujutsu) is the only supported engine today. */
export type StackEngine = "jj";

/** Where a stack's work originates in Linear. At least one of the optional fields is set. */
export interface StackFeatureSource {
  readonly linearProjectId?: string;
  readonly parentIssueId?: IssueId;
  readonly issueIds: readonly IssueId[];
}

/** One reviewable unit of a stack: a Linear issue built on a branch stacked atop the previous entry. */
export interface StackEntry {
  readonly position: StackPosition;
  readonly issueId: IssueId;
  readonly issueTitle: string;
  /** The git branch (jj bookmark) name. Stable across restack and used as the PR branch. */
  readonly branchName: BranchName;
  /** The jj change ID — stable across restack; the canonical key Smithers also records per attempt. */
  readonly changeId: JjChangeId;
  /** The branch this entry is stacked on: the previous entry's branch, or the stack base for position 0. */
  readonly baseBranch: BranchName;
  readonly headSha: GitSha;
  readonly status: StackStatus;
  readonly prNumber?: PullRequestNumber;
  readonly prUrl?: PullRequestUrl;
  /** The branch head SHA at the time it was last pushed. If it differs from headSha, the entry was re-flowed by an amend and its open PR is stale. */
  readonly pushedSha?: GitSha;
}

/** The persisted source of truth linking Linear issues to branches, PRs, and stack position. */
export interface StackMap {
  readonly version: 1;
  readonly feature: FeatureName;
  readonly repoSlug: RepoSlug;
  readonly baseBranch: BaseBranchName;
  /** The tip branch — checking it out previews the whole feature. Empty until the first build. */
  readonly tipBranch: BranchName;
  readonly engine: StackEngine;
  readonly source: StackFeatureSource;
  readonly entries: readonly StackEntry[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface ManagedFile {
  readonly path: RelativePath;
  readonly hash: FileHash;
}

export interface PackManifest {
  readonly version: number;
  readonly updatedAt: IsoTimestamp;
  readonly source: "xiv";
  readonly files: readonly ManagedFile[];
}

export interface InstallOptions {
  readonly packRoot: AbsolutePath;
  readonly smithersHome: AbsolutePath;
  readonly runInstall: boolean;
}

export interface WorkflowRunOptions {
  readonly smithersHome: AbsolutePath;
  readonly targetCwd: AbsolutePath;
  readonly workflow: WorkflowName;
  readonly input: Record<string, unknown>;
  /** Run detached (smithers up -d): start in the background and return immediately. */
  readonly detach?: boolean;
}

export interface DevWorkflowOptions {
  readonly packRoot: AbsolutePath;
  readonly targetCwd: AbsolutePath;
  readonly workflow: string;
  readonly input: Record<string, unknown>;
}

export interface PassthroughOptions {
  readonly smithersHome: AbsolutePath;
  readonly command: SmithersPassthroughCommand;
  readonly args: readonly string[];
}

export interface InstallResult {
  readonly copied: number;
  readonly backups: number;
  readonly smithersHome: AbsolutePath;
}

/** Result of a captured child process: exit code plus its stdout/stderr. */
export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Outcome of probing the environment for jj before running a stack command. */
export interface JjPreflight {
  readonly available: boolean;
  readonly isRepo: boolean;
  readonly version: string | null;
}

/** Where a stack is in its lifecycle, derived purely from the stack map. */
export type TriagePhase =
  | "needs-plan"
  | "building"
  | "built-unpublished"
  | "has-stale"
  | "publishing"
  | "complete";

/** The single next action an operator should take, derived from the stack map. */
export type TriageAction = "plan" | "build" | "push" | "wait" | "done";

/** Count of stack entries in each status. */
export interface StackCounts {
  readonly pending: number;
  readonly implementing: number;
  readonly implemented: number;
  readonly pushed: number;
  readonly prOpen: number;
  readonly merged: number;
  readonly total: number;
}

/** A compact, structured status an operator (e.g. a small model) can match against a decision table. */
export interface TriageReport {
  readonly feature: FeatureName;
  readonly phase: TriagePhase;
  readonly action: TriageAction;
  readonly counts: StackCounts;
  readonly inFlight: IssueId | null;
  readonly staleBranches: readonly BranchName[];
  readonly tipBranch: BranchName;
  readonly summary: string;
  readonly hint: string;
}
