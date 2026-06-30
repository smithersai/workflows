// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: PR Fix
// smithers-description: Address the existing review findings on a PR once and push — no loop, no re-request. NEVER merges.
// smithers-tags: github, review, pr, fix
// smithers-aliases: prf
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import { addressFindingsSchema } from "../components/PrReview";
import PrFixPrompt from "../prompts/pr-fix.mdx";

const inputSchema = z.object({
  prNumber: z.number().int(),
});

const { Workflow, Task, smithers } = createSmithers({
  input: inputSchema,
  fix: addressFindingsSchema,
});

export default smithers((ctx) => (
  <Workflow name="pr-fix">
    <Task
      id="pr:fix"
      output={addressFindingsSchema}
      agent={agents.autonomous}
      timeoutMs={1_800_000}
      heartbeatTimeoutMs={600_000}
    >
      <PrFixPrompt prNumber={ctx.input.prNumber} />
    </Task>
  </Workflow>
));
