import { ClaudeCodeAgent as SmithersClaudeCodeAgent } from "smithers-orchestrator";

export const ClaudeCodeAgent = new SmithersClaudeCodeAgent({
  model: "claude-opus-4-7",
  cwd: process.env.SMITHERS_TARGET_CWD ?? process.cwd(),
});
