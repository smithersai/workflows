import type { ReactElement } from "react";
import type { OutputTarget } from "smthrs";

export interface SubflowLooseProps {
  readonly id: string;
  readonly workflow: unknown;
  readonly input?: unknown;
  readonly mode?: "childRun" | "inline";
  readonly output: OutputTarget;
  readonly skipIf?: boolean;
  readonly timeoutMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly retries?: number;
  readonly continueOnFail?: boolean;
}

export declare function SubflowLoose(props: SubflowLooseProps): ReactElement;
