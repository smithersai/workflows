import {
  type AgentLike,
  ClaudeCodeAgent as SmithersClaudeCodeAgent,
  PiAgent as SmithersPiAgent,
} from "smithers-orchestrator";
import { ClaudeCodeAgent } from "./agents/claude-code";
import { CodexAgent } from "./agents/codex";

export { ClaudeCodeAgent } from "./agents/claude-code";
export { CodexAgent } from "./agents/codex";

const NEVER_MERGE_PROMPT =
  "You operate autonomously inside a Smithers workflow and may run git and gh commands. " +
  "NEVER merge a pull request: do not run `gh pr merge`, do not enable auto-merge, do not click merge. " +
  "Merging is a human's job. When you believe a PR is ready, stop and report it. Do not merge it.";

interface Providers {
  readonly claude: AgentLike;
  readonly codex: AgentLike;
  readonly pi: AgentLike;
  readonly claudeSonnet: AgentLike;
  readonly claudeAuto: AgentLike;
}

interface AgentPools {
  readonly cheapFast: AgentLike[];
  readonly smart: AgentLike[];
  readonly smartTool: AgentLike[];
  readonly autonomous: AgentLike[];
}

export const providers: Providers = {
  claude: ClaudeCodeAgent,
  codex: CodexAgent,
  pi: new SmithersPiAgent({ provider: "openai", model: "gpt-5.3-codex" }),
  claudeSonnet: new SmithersClaudeCodeAgent({
    model: "claude-sonnet-4-7",
    cwd: process.env.SMITHERS_TARGET_CWD ?? process.cwd(),
  }),
  claudeAuto: new SmithersClaudeCodeAgent({
    model: "claude-opus-4-7",
    cwd: process.env.SMITHERS_TARGET_CWD ?? process.cwd(),
    permissionMode: "bypassPermissions",
    appendSystemPrompt: NEVER_MERGE_PROMPT,
  }),
};

export const agents: AgentPools = {
  cheapFast: [providers.claudeSonnet, providers.pi],
  smart: [providers.codex, providers.claude],
  smartTool: [providers.claude, providers.codex],
  autonomous: [providers.claudeAuto, providers.codex],
};
