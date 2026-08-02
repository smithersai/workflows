/** @jsxImportSource smthrs */
import { Loop, Sequence, Task, type AgentLike } from "smthrs";
import { z } from "zod/v4";
import ImplementPrompt from "~/prompts/implement.mdx";
import ValidatePrompt from "~/prompts/validate.mdx";

// `summary` is a free-text report and is NOT load-bearing (nothing reads outputs.implement;
// only validate.allPassed/failingSummary drive control flow). A reviewer/implementer agent
// occasionally returns incomplete structured output (missing summary) — defaulting it keeps a
// flaky agent from throwing INVALID_OUTPUT and death-spiralling the build. The real implement
// work is the files written via tools, which persist regardless of the summary field.
export const implementOutputSchema = z.object({
  summary: z.string().default(""),
  filesChanged: z.array(z.string()).default([]),
  allTestsPassing: z.boolean().default(true),
});

export const validateOutputSchema = z.object({
  summary: z.string().default(""),
  allPassed: z.boolean().default(true),
  failingSummary: z.string().nullable().default(null),
});

/**
 * A bare implement -> validate loop. Code review is NOT part of it: reviewing is a separate,
 * schema-carrying step (see components/LocalReview.ts) that each workflow wires in itself, so the
 * mechanical validation gate stays the only thing this component arbitrates on.
 */
export interface ValidationLoopProps {
  readonly idPrefix: string;
  readonly prompt: unknown;
  readonly implementAgents: AgentLike[];
  readonly validateAgents?: AgentLike[];
  readonly feedback?: string | null;
  readonly done?: boolean;
  readonly maxIterations?: number;
}

export function ValidationLoop({
  idPrefix,
  prompt,
  implementAgents,
  validateAgents,
  feedback,
  done = false,
  maxIterations = 3,
}: ValidationLoopProps): React.ReactElement {
  const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);
  const validatorAgents =
    validateAgents !== undefined && validateAgents.length > 0 ? validateAgents : implementAgents;
  const implementPrompt = feedback
    ? `${promptText}\n\n---\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
    : promptText;

  return (
    <Loop id={`${idPrefix}:loop`} until={done} maxIterations={maxIterations} onMaxReached="return-last">
      <Sequence>
        <Task id={`${idPrefix}:implement`} output={implementOutputSchema} agent={implementAgents} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
          <ImplementPrompt prompt={implementPrompt} />
        </Task>
        <Task id={`${idPrefix}:validate`} output={validateOutputSchema} agent={validatorAgents} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
          <ValidatePrompt prompt={promptText} />
        </Task>
      </Sequence>
    </Loop>
  );
}

export type ImplementOutput = z.infer<typeof implementOutputSchema>;
export type ValidateOutput = z.infer<typeof validateOutputSchema>;
