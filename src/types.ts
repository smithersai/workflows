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

/** Logical name for a repo in a (possibly multi-repo) feature, e.g. "payments" or "ledger-rs". */
export type RepoKey = string;

/** A repo a feature's work spans. A single-repo feature has exactly one of these. */
export interface RepoConfig {
  /** Absolute path to the repo's working tree on this machine. */
  readonly path: AbsolutePath;
  /** Trunk branch this repo's substack is based on (e.g. main, develop). */
  readonly baseBranch: BaseBranchName;
  /** Git remote name for pushing (default origin). */
  readonly remote?: string;
}

/** An issue that is part of the feature but intentionally NOT built (e.g. infra/manual: "set GCP secrets"). */
export interface ExcludedIssue {
  readonly issueId: IssueId;
  readonly reason: string;
}

/** Where a stack's work originates in Linear. At least one of the optional fields is set. */
export interface StackFeatureSource {
  readonly linearProjectId?: string;
  readonly parentIssueId?: IssueId;
  readonly issueIds: readonly IssueId[];
  /** Issues that belong to the feature but were deliberately left out of the stack, with why. */
  readonly excluded?: readonly ExcludedIssue[];
}

/** One issue in a resolved plan: its stack position is its index, assigned to a repo. */
export interface PlannedIssue {
  readonly issueId: IssueId;
  readonly title?: string;
  readonly repo: RepoKey;
}

/** A fully-resolved plan produced by the stack-plan skill and persisted by `xiv stack plan --plan`. */
export interface PlanFile {
  /** Issues in stack order (index 0 = bottom), each already assigned a repo. */
  readonly order: readonly PlannedIssue[];
  readonly excluded?: readonly ExcludedIssue[];
  readonly source?: {
    readonly linearProjectId?: string;
    readonly parentIssueId?: IssueId;
  };
}

/** One reviewable unit of a stack: a Linear issue built on a branch stacked atop the previous entry in its repo. */
export interface StackEntry {
  readonly position: StackPosition;
  readonly issueId: IssueId;
  readonly issueTitle: string;
  /** Which repo (key into StackMap.repos) this entry belongs to. */
  readonly repo: RepoKey;
  /** The git branch (jj bookmark) name. Stable across restack and used as the PR branch. */
  readonly branchName: BranchName;
  /** The jj change ID — stable across restack; the canonical key Smithers also records per attempt. */
  readonly changeId: JjChangeId;
  /** The branch this entry is stacked on: the previous SAME-REPO entry's branch, or its repo's trunk. */
  readonly baseBranch: BranchName;
  readonly headSha: GitSha;
  readonly status: StackStatus;
  readonly prNumber?: PullRequestNumber;
  readonly prUrl?: PullRequestUrl;
  /** The branch head SHA at the time it was last pushed. If it differs from headSha, the entry was re-flowed by an amend and its open PR is stale. */
  readonly pushedSha?: GitSha;
  /** Logical (often cross-repo) dependencies — issues this entry assumes are done. Used to flag, not to auto-rebase. */
  readonly dependsOn?: readonly IssueId[];
}

/**
 * The persisted source of truth linking Linear issues to repos, branches, PRs, and stack position.
 * A feature may span several repos; each repo holds its own independent substack. A single-repo
 * feature is just the degenerate case with one entry in `repos`.
 */
export interface StackMap {
  readonly version: 1;
  readonly feature: FeatureName;
  /** Slug of the "home" repo the orchestration commands run from — keys this map's file location. */
  readonly repoSlug: RepoSlug;
  /** Every repo this feature touches, keyed by RepoKey. */
  readonly repos: Record<RepoKey, RepoConfig>;
  /** Per-repo tip branch — checking out repos[k].path at tips[k] previews that repo's whole substack. */
  readonly tips: Record<RepoKey, BranchName>;
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

/** Per-repo slice of a triage report. */
export interface RepoTriage {
  readonly repo: RepoKey;
  readonly phase: TriagePhase;
  readonly action: TriageAction;
  readonly counts: StackCounts;
  readonly inFlight: IssueId | null;
  readonly staleBranches: readonly BranchName[];
  readonly tip: BranchName;
}

/** A compact, structured status an operator (e.g. a small model) can match against a decision table. */
export interface TriageReport {
  readonly feature: FeatureName;
  /** The most-urgent action across all repos — the headline next step. */
  readonly action: TriageAction;
  /** Aggregate counts across every repo. */
  readonly counts: StackCounts;
  readonly summary: string;
  readonly hint: string;
  /** Per-repo breakdown (one entry per repo in the feature). */
  readonly repos: readonly RepoTriage[];
}
