import { type AgentLike, ClaudeCodeAgent, CodexAgent } from "smithers-orchestrator";
import type { ModelName, ReasoningEffort } from "./types";

const cwd = process.env.SMITHERS_TARGET_CWD ?? process.cwd();

/**
 * Engine + cost knobs, all env-driven so a run can be retargeted without editing the pack:
 *
 *   XIV_ENGINE=codex            run EVERY step on codex only (no Claude) — e.g. to spare the
 *                               Claude subscription limit. Default: Claude only (codex off).
 *   XIV_CODEX_MODEL=gpt-5.5     codex model for legacy/all-codex pools (default gpt-5.5).
 *   XIV_PLAN_ENGINE=claude      force linear-implement PLAN onto Claude (BALANCED default: codex).
 *   XIV_REVIEW_ENGINE=claude    force ACCEPTANCE REVIEW onto Claude (BALANCED default: codex).
 *   XIV_PLAN_MODEL              codex plan model (default: gpt-5.4 cheap / gpt-5.5 quality).
 *   XIV_REVIEW_MODEL            codex review model (default: gpt-5.4 cheap / gpt-5.5 quality).
 *                               NOTE: the "-codex" variants
 *                               (gpt-5.5-codex, gpt-5-codex) require an OPENAI_API_KEY — they
 *                               return HTTP 400 on a ChatGPT-subscription login. gpt-5.5 works.
 *   XIV_CODEX_REASONING=medium  codex reasoning effort (default medium in codex/quality, else low).
 *   XIV_TIER=quality            Claude tier: Opus heavy / Sonnet light (default cheap: Sonnet/Haiku).
 *   XIV_MODEL_HEAVY / XIV_MODEL_LIGHT   override the Claude models directly.
 *   XIV_AGENT_MAX_USD           hard per-agent spend cap.
 *
 * Claude Code exposes no separate "thinking level" — model tier IS the reasoning/cost lever.
 */
const engine = process.env.XIV_ENGINE === "codex" ? "codex" : "claude";
const tier = process.env.XIV_TIER === "quality" ? "quality" : "cheap";

const heavyModel: ModelName = process.env.XIV_MODEL_HEAVY ?? (tier === "quality" ? "claude-opus-4-8" : "claude-sonnet-4-6");
const lightModel: ModelName = process.env.XIV_MODEL_LIGHT ?? (tier === "quality" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");
const codexModel: ModelName = process.env.XIV_CODEX_MODEL ?? "gpt-5.5";
const planModel: ModelName = process.env.XIV_PLAN_MODEL ?? (tier === "quality" ? "gpt-5.5" : "gpt-5.4");
const reviewModel: ModelName = process.env.XIV_REVIEW_MODEL ?? (tier === "quality" ? "gpt-5.5" : "gpt-5.4");
const codexReasoning: ReasoningEffort = process.env.XIV_CODEX_REASONING === "high"
  ? "high"
  : process.env.XIV_CODEX_REASONING === "medium" || engine === "codex" || tier === "quality"
    ? "medium"
    : "low";
const maxBudgetUsd = process.env.XIV_AGENT_MAX_USD !== undefined ? Number(process.env.XIV_AGENT_MAX_USD) : undefined;

/**
 * Per-step engine for linear-implement. Each step carries a BALANCED default (plan + review on
 * codex, everything else on Claude) — the point is a mixed pipeline, not a single provider.
 * Force a step the other way per-run, e.g. XIV_PLAN_ENGINE=claude. A global XIV_ENGINE=codex
 * forces codex everywhere.
 * WARNING: codex steps die on startup if the figma-desktop MCP (127.0.0.1:3845) in
 * ~/.codex/config.toml is down. Since plan + review DEFAULT to codex, every build hits codex —
 * you MUST remove that MCP or keep Figma Desktop running, or builds break at the plan step.
 */
function stepEngine(envVar: string, fallback: "claude" | "codex"): "claude" | "codex" {
  const value = process.env[envVar];
  if (value === "codex") return "codex";
  if (value === "claude") return "claude";
  return engine === "codex" ? "codex" : fallback;
}

const NEVER_MERGE_PROMPT =
  "You operate autonomously inside a Smithers workflow and may run git and gh commands. " +
  "NEVER merge a pull request: do not run `gh pr merge`, do not enable auto-merge, do not click merge. " +
  "Merging is a human's job. When you believe a PR is ready, stop and report it. Do not merge it.";

interface ClaudeExtra {
  readonly permissionMode?: "bypassPermissions";
  readonly appendSystemPrompt?: string;
}

function claudeAgent(model: string, extra: ClaudeExtra = {}): AgentLike {
  return new ClaudeCodeAgent({ model, cwd, ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}), ...extra });
}

const claudeHeavy = claudeAgent(heavyModel);
const claudeLight = claudeAgent(lightModel);
const claudeAuto = claudeAgent(heavyModel, {
  permissionMode: "bypassPermissions",
  appendSystemPrompt: NEVER_MERGE_PROMPT,
});

function codexAgent(model: ModelName, reasoning: ReasoningEffort): AgentLike {
  return new CodexAgent({
    model,
    cwd,
    skipGitRepoCheck: true,
    dangerouslyBypassApprovalsAndSandbox: true,
    instructions: NEVER_MERGE_PROMPT,
    config: { model_reasoning_effort: reasoning },
  });
}

// One autonomous-capable codex: full access (write + exec + network for git/gh/jj) + never-merge.
// Used as the claude-mode fallback and as the sole agent in XIV_ENGINE=codex mode.
const codex = codexAgent(codexModel, codexReasoning);
const codexPlanner = codexAgent(planModel, "medium");
const codexReviewer = codexAgent(reviewModel, "high");

interface Providers {
  readonly claude: AgentLike;
  readonly codex: AgentLike;
  readonly claudeLight: AgentLike;
  readonly claudeAuto: AgentLike;
}

interface AgentPools {
  readonly cheapFast: AgentLike[];
  readonly smart: AgentLike[];
  readonly smartTool: AgentLike[];
  readonly autonomous: AgentLike[];
}

interface LinearImplementAgents {
  readonly fetchIssue: AgentLike;
  readonly plan: AgentLike;
  readonly implement: AgentLike;
  readonly validate: AgentLike;
  readonly review: AgentLike;
  readonly finalize: AgentLike;
}

// Claude only by default. Codex is flaky on structured output AND the review step fans the `smart`
// pool into a panel (agents.smart.map) — so a codex member there is not a fallback, it runs on every
// build and 400s on a ChatGPT-subscription login. Keeping the default pools pure Claude removes that
// landmine. Set XIV_ENGINE=codex to run every step on codex alone instead (e.g. to spare the Claude
// limit); that path needs a subscription-supported model (gpt-5.5) or an OPENAI_API_KEY.
export const providers: Providers =
  engine === "codex"
    ? { claude: codex, codex, claudeLight: codex, claudeAuto: codex }
    : { claude: claudeHeavy, codex, claudeLight, claudeAuto };

export const agents: AgentPools =
  engine === "codex"
    ? { cheapFast: [codex], smart: [codex], smartTool: [codex], autonomous: [codex] }
    : {
        cheapFast: [claudeLight, claudeHeavy],
        smart: [claudeHeavy],
        smartTool: [claudeHeavy],
        autonomous: [claudeAuto],
      };

export const linearImplementAgents: LinearImplementAgents = {
  fetchIssue: claudeLight,
  // BALANCED default: plan + review run on CODEX (codexPlanner gpt-5.4/5.5 medium, codexReviewer
  // gpt-5.4/5.5 high). Force Claude per step with XIV_PLAN_ENGINE=claude / XIV_REVIEW_ENGINE=claude.
  // CAUTION: because these default to codex, EVERY build hits codex — codex dies on startup when
  // ~/.codex/config.toml registers figma-desktop MCP @ 127.0.0.1:3845 and Figma Desktop is closed.
  // Remove that MCP or keep Figma Desktop running. implement/validate/finalize stay on Claude:
  // heavy file-editing, near-free Haiku, git work respectively.
  plan: stepEngine("XIV_PLAN_ENGINE", "codex") === "codex" ? codexPlanner : claudeHeavy,
  implement: claudeHeavy,
  validate: claudeLight,
  review: stepEngine("XIV_REVIEW_ENGINE", "codex") === "codex" ? codexReviewer : claudeHeavy,
  finalize: claudeAuto,
};
