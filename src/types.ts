export type AbsolutePath = string;
export type RelativePath = string;
export type FileHash = string;
export type IsoTimestamp = string;
export type IssueId = string;
export type BranchName = string;
export type BaseBranchName = string;
export type PullRequestNumber = number;
export type WorkflowName = "linear-implement" | "pr-review-loop" | "linear-to-pr";
export type SmithersPassthroughCommand = "ps" | "logs" | "ui" | "inspect";

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
