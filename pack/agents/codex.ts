import { CodexAgent as SmithersCodexAgent } from "smithers-orchestrator";

export const CodexAgent = new SmithersCodexAgent({
  model: "gpt-5.3-codex",
  cwd: process.env.SMITHERS_TARGET_CWD ?? process.cwd(),
  skipGitRepoCheck: true,
});
