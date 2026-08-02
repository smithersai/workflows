import { type AgentLike, ClaudeCodeAgent, CodexAgent } from "smthrs";
import type { ModelName, ReasoningEffort } from "./types";

const cwd = process.env.SMITHERS_TARGET_CWD ?? process.cwd();

/**
 * Engine + cost knobs, all env-driven so a run can be retargeted without editing the pack:
 *
 *   XIV_ENGINE=codex            run EVERY step on codex only (no Claude) — e.g. to spare the
 *                               Claude subscription limit. Default: Claude only (codex off).
 *   XIV_TIER=quality            Claude: Opus 5 heavy / Sonnet 5 light (default cheap: Sonnet 5 /
 *                               Haiku 4.5). Codex: Sol at xhigh for plan, Sol for review (default
 *                               cheap: Sol at low / Terra).
 *   XIV_MODEL_HEAVY / XIV_MODEL_LIGHT   override the Claude models directly.
 *   XIV_EFFORT_HEAVY / XIV_EFFORT_LIGHT override Claude reasoning effort
 *                               (low | medium | high | xhigh | max). Ignored for models that do
 *                               not accept `--effort` — see EFFORT_CAPABLE_MODELS.
 *   XIV_STACK_PLAN_MODEL / XIV_STACK_PLAN_EFFORT   override the stack planner (default Fable 5
 *                               at xhigh; deliberately not on the XIV_TIER ladder).
 *   XIV_CODEX_MODEL             codex model for the all-codex pools (default Terra / Sol).
 *   XIV_CODEX_LIGHT_MODEL       codex model for the mechanical steps (default Luna).
 *   XIV_PLAN_MODEL              override the codex plan model (default Sol at both tiers).
 *   XIV_REVIEW_MODEL            override the codex review model (default Terra cheap / Sol quality).
 *   XIV_CODEX_REASONING         reasoning effort for the all-codex agent
 *                               (low | medium | high | xhigh | max).
 *   XIV_AGENT_MAX_USD           hard per-agent spend cap.
 *
 * Per-step engine overrides — each forces one linear-implement step onto the other provider:
 *   XIV_FETCH_ENGINE, XIV_PLAN_ENGINE, XIV_VALIDATE_ENGINE, XIV_REVIEW_ENGINE
 *     default to codex; XIV_IMPLEMENT_ENGINE, XIV_FINALIZE_ENGINE default to claude.
 *
 * Both providers take an explicit reasoning effort, so a tier can be raised by model, by effort,
 * or by both. Codex takes it as a config value; Claude Code takes it as a `--effort` CLI flag,
 * which ClaudeCodeAgentOptions has no field for — see `claudeAgent` for the passthrough. Steps
 * that leave effort unset inherit each CLI's own default.
 */
const engine = process.env.XIV_ENGINE === "codex" ? "codex" : "claude";
const tier = process.env.XIV_TIER === "quality" ? "quality" : "cheap";

// Claude. Sonnet 5 is both the cheap-tier workhorse and the quality-tier light model; Opus 5
// appears only under XIV_TIER=quality.
const heavyModel: ModelName = process.env.XIV_MODEL_HEAVY ?? (tier === "quality" ? "claude-opus-5" : "claude-sonnet-5");
const lightModel: ModelName = process.env.XIV_MODEL_LIGHT ?? (tier === "quality" ? "claude-sonnet-5" : "claude-haiku-4-5");
// Mechanical autonomous work (branch, commit, open a PR) is pinned rather than tiered: paying Opus
// rates to write a commit message buys nothing. Genuinely hard autonomous work — the jj re-flow in
// stack-amend — keeps the tiered `claudeAuto` below.
const autoLightModel: ModelName = "claude-sonnet-5";

// Codex. GPT-5.6 names its capability tiers (sol > terra > luna) so they can advance independently
// of the generation number; the cost lever here is model AND effort, not model alone.
const codexModel: ModelName = process.env.XIV_CODEX_MODEL ?? (tier === "quality" ? "gpt-5.6-sol" : "gpt-5.6-terra");
const codexLightModel: ModelName = process.env.XIV_CODEX_LIGHT_MODEL ?? "gpt-5.6-luna";
const planModel: ModelName = process.env.XIV_PLAN_MODEL ?? "gpt-5.6-sol";
const planReasoning: ReasoningEffort = tier === "quality" ? "xhigh" : "low";
const reviewModel: ModelName = process.env.XIV_REVIEW_MODEL ?? (tier === "quality" ? "gpt-5.6-sol" : "gpt-5.6-terra");

const REASONING_LEVELS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Parse an env-supplied effort, falling back rather than trusting unvalidated external input. */
function parseReasoning(value: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  return REASONING_LEVELS.find((level) => level === value) ?? fallback;
}

/**
 * `--effort` is a 5-family capability (plus Opus/Sonnet 4.6+); the 4.5-generation models reject the
 * flag outright, so a cheap-tier step on Haiku would die on startup if we passed it unconditionally.
 * Attach effort only for models known to accept it — anything unrecognised (including a custom
 * XIV_MODEL_* override) silently inherits the CLI's own default, which is the safe direction to
 * fail. This list is about flag COMPATIBILITY, not about which models we actually use.
 */
const EFFORT_CAPABLE_MODELS: readonly ModelName[] = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];

function effortFor(model: ModelName, level: ReasoningEffort): ReasoningEffort | undefined {
  return EFFORT_CAPABLE_MODELS.includes(model) ? level : undefined;
}

// Claude effort, tiered the same way the models are. Heavy carries the reasoning-shaped work
// (implementing a change, resolving a jj re-flow); light shells out to lint/test and reads output.
const heavyEffort: ReasoningEffort = parseReasoning(process.env.XIV_EFFORT_HEAVY, tier === "quality" ? "xhigh" : "medium");
const lightEffort: ReasoningEffort = parseReasoning(process.env.XIV_EFFORT_LIGHT, "low");

const codexReasoning: ReasoningEffort = parseReasoning(
  process.env.XIV_CODEX_REASONING,
  engine === "codex" || tier === "quality" ? "medium" : "low",
);
const maxBudgetUsd = process.env.XIV_AGENT_MAX_USD !== undefined ? Number(process.env.XIV_AGENT_MAX_USD) : undefined;

/**
 * Per-step engine for linear-implement. Each step carries a BALANCED default — the point is a
 * mixed pipeline, not a single provider. Force a step the other way per-run, e.g.
 * XIV_PLAN_ENGINE=claude. A global XIV_ENGINE=codex forces codex everywhere.
 *
 * A codex step fails at startup when a stdio MCP server registered in ~/.codex/config.toml cannot
 * be reached — a server pointed at a local port only serves while that app is running. Most steps
 * default to codex, so an unreachable entry there breaks the run at its first codex step rather
 * than degrading; comment the entry out instead of leaving it registered.
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
  /**
   * Reasoning effort. ClaudeCodeAgentOptions has no first-class field for it, but the CLI takes
   * `--effort <level>`, so it goes through the `extraArgs` passthrough. Omit to accept the CLI's
   * own default rather than pinning one here.
   */
  readonly effort?: ReasoningEffort;
}

function claudeAgent(model: string, extra: ClaudeExtra = {}): AgentLike {
  const { effort, ...options } = extra;
  return new ClaudeCodeAgent({
    model,
    cwd,
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(effort !== undefined ? { extraArgs: ["--effort", effort] } : {}),
    ...options,
  });
}

const claudeHeavy = claudeAgent(heavyModel, { effort: effortFor(heavyModel, heavyEffort) });
const claudeLight = claudeAgent(lightModel, { effort: effortFor(lightModel, lightEffort) });
// Autonomous = allowed to run git/gh/jj unattended, and told never to merge. Two variants because
// the work splits cleanly: claudeAuto for judgement-heavy autonomy (resolving a jj re-flow through
// a stack), claudeAutoLight for the mechanical majority (branch, commit, open a PR).
const claudeAuto = claudeAgent(heavyModel, {
  permissionMode: "bypassPermissions",
  appendSystemPrompt: NEVER_MERGE_PROMPT,
  effort: effortFor(heavyModel, heavyEffort),
});
const claudeAutoLight = claudeAgent(autoLightModel, {
  permissionMode: "bypassPermissions",
  appendSystemPrompt: NEVER_MERGE_PROMPT,
  effort: effortFor(autoLightModel, lightEffort),
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
// Used as the claude-mode fallback and as the general agent in XIV_ENGINE=codex mode.
const codex = codexAgent(codexModel, codexReasoning);
// Luna at low effort for the mechanical steps — fetching an issue and shelling out to the repo's
// lint/test commands is retrieval and transcription, not reasoning, and it is ~25x cheaper per
// token than the planning tier.
const codexLight = codexAgent(codexLightModel, "low");
const codexPlanner = codexAgent(planModel, planReasoning);
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

// Claude only by default: codex is flaky on structured output, so keeping the shared pools pure
// Claude means a codex member can never end up running on every build. Set XIV_ENGINE=codex to run
// every step on codex alone instead (e.g. to spare the Claude subscription limit); that path needs
// a model your codex login actually serves — the "-codex" suffixed variants require an
// OPENAI_API_KEY and 400 on a ChatGPT-subscription login, while the plain tiers work.
export const providers: Providers =
  engine === "codex"
    ? { claude: codex, codex, claudeLight: codex, claudeAuto: codex }
    : { claude: claudeHeavy, codex, claudeLight, claudeAuto };

export const agents: AgentPools =
  engine === "codex"
    ? { cheapFast: [codexLight], smart: [codex], smartTool: [codex], autonomous: [codex] }
    : {
        cheapFast: [claudeLight, claudeHeavy],
        smart: [claudeHeavy],
        smartTool: [claudeHeavy],
        autonomous: [claudeAuto],
      };

/**
 * Stack planning is the single highest-leverage call in the whole lifecycle: it decides which
 * issues enter the stack, in what order, and against which repo — and because each entry is built
 * on top of the previous one's branch, every later command inherits that ordering from the stack
 * map. Getting it wrong is not a bad paragraph, it is a rebuild. It also runs exactly ONCE per
 * feature, so the most capable model at high effort costs a rounding error next to the N build
 * subflows it governs. Hence Fable 5 at xhigh, deliberately off the XIV_TIER ladder.
 */
const stackPlanModel: ModelName = process.env.XIV_STACK_PLAN_MODEL ?? "claude-fable-5";
const stackPlanEffort: ReasoningEffort = parseReasoning(process.env.XIV_STACK_PLAN_EFFORT, "xhigh");

export const stackPlanAgent: AgentLike =
  engine === "codex"
    ? codexPlanner
    : claudeAgent(stackPlanModel, { effort: effortFor(stackPlanModel, stackPlanEffort) });

/**
 * BALANCED defaults: the two cheap mechanical steps and the two reasoning-heavy steps run on codex;
 * writing the code and committing it stay on Claude. Every assignment is overridable per-run via
 * the XIV_*_ENGINE variables, and XIV_ENGINE=codex moves all six onto codex.
 *
 * Why each one lands where it does:
 *   fetchIssue  Luna    — an MCP call and a transcription; no reasoning to pay for.
 *   plan        Sol     — the step whose quality most determines the rest of the run. Tiered by
 *                         effort (low → xhigh) rather than by model.
 *   implement   Claude  — sustained multi-file editing, where Claude Code's harness earns its keep.
 *   validate    Luna    — runs the repo's own lint/test commands and reports pass/fail. This is the
 *                         loop's ARBITER, but it arbitrates on command exit codes, not judgement,
 *                         so capability buys nothing here.
 *   review      Sol/Terra at high — findings must be trustworthy; a false approval ends the loop.
 *   finalize    Sonnet 5 + bypassPermissions — branch, commit, report. Mechanical.
 */
export const linearImplementAgents: LinearImplementAgents = {
  fetchIssue: stepEngine("XIV_FETCH_ENGINE", "codex") === "codex" ? codexLight : claudeLight,
  plan: stepEngine("XIV_PLAN_ENGINE", "codex") === "codex" ? codexPlanner : claudeHeavy,
  implement: stepEngine("XIV_IMPLEMENT_ENGINE", "claude") === "codex" ? codex : claudeHeavy,
  validate: stepEngine("XIV_VALIDATE_ENGINE", "codex") === "codex" ? codexLight : claudeLight,
  review: stepEngine("XIV_REVIEW_ENGINE", "codex") === "codex" ? codexReviewer : claudeHeavy,
  finalize: stepEngine("XIV_FINALIZE_ENGINE", "claude") === "codex" ? codex : claudeAutoLight,
};
