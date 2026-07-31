# Authoring workflows & tuning cost

For when the user is working **on xiv itself** — iterating on a workflow, installing/updating the
managed pack, or adjusting the model tier — rather than running a feature through it.

## Install / update the managed pack + skills

Both commands install **two separate things**, because they have different destinations:

| Layer | Where it goes | What reads it |
|---|---|---|
| the pack (`pack/`) | `SMITHERS_HOME` (`~/.smithers`) | the Smithers engine, when running a workflow |
| skills (`skills/`) | your agent dirs, via the `skills` CLI | the agent driving `xiv` |

- **`xiv init`** — first-time setup: install the pack, then the skills.
- **`xiv update`** — update managed pack files (backing up local drift before overwrite), then
  reinstall the skills. Run it after changing pack defaults (e.g. `pack/agents.ts`) **or after
  editing a skill**, so the installed copies match the repo.
- **`--no-skills`** on either — pack only. Use when offline, or when you deliberately want the
  agent to keep the skills it has.

The skills step installs **every** skill in the repo but **prompts for which agents** to install
into — so `xiv update` is interactive unless you pass `--no-skills`. If you are running it
unattended, expect to answer that prompt or skip the step.

Skills install from the **working tree**, not from a commit, so `xiv update` on a dirty repo hands
your agent unreleased instructions. That's the point during authoring; just know it's happening.
If the skills step fails (no network, npx unavailable), the pack update still succeeds and the
command warns — rerun the skills half alone with
`npx skills@latest add <repo> --skill '*' --global`.

The CLI itself (`src/`) needs no install: `bun link` points `xiv` at this repo, so changes to
commands and flags are live immediately.

## Iterate on a workflow (fast loop)

Workflows live in `pack/workflows/*.tsx`. Run them straight from the repo's `pack/` — no
`init`/`update` round-trip:

- **`xiv check <workflow>`** — render the workflow graph **without executing** (fast, free, no
  agents). Use to sanity-check structure.
- **`xiv dev <workflow>`** — run it **live** against a target repo.

Both take `--input '{…}'` (the workflow's JSON input) and default `--cwd` to the current directory
(`--cwd /path/to/repo` to target another). One-time: `cd pack && bun install` to install the pack's
own deps. Run `xiv check -h` / `xiv dev -h` for flags.

## Model tier / cost knobs

Agents default to a **cheap** tier, which is plenty when the work is fully specified in Linear. The
pipeline is deliberately **mixed** — codex Luna for mechanical steps (fetch, validate), codex Sol
for planning, Claude Sonnet 5 for implementing, codex Terra for review.

Both providers take an explicit **reasoning effort**, so a tier can be raised by model, by effort,
or by both. `XIV_TIER=quality` changes only three steps: implement → Opus 5, review → Sol,
planning → `xhigh` effort. The mechanical steps stay put, because capability buys nothing when the
job is an MCP call or shelling out to the repo's test command.

Override per run via env (passed through to the workflow):

- `XIV_TIER=quality` — the three-step upgrade above, for genuinely hard features.
- `XIV_MODEL_HEAVY` / `XIV_MODEL_LIGHT` — set the Claude models directly.
- `XIV_EFFORT_HEAVY` / `XIV_EFFORT_LIGHT` — Claude effort (`low`…`max`).
- `XIV_STACK_PLAN_MODEL` / `XIV_STACK_PLAN_EFFORT` — the stack planner (default Fable 5 at `xhigh`).
- `XIV_CODEX_MODEL` / `XIV_CODEX_REASONING` — codex model + effort.
- `XIV_ENGINE=codex` — run every step on codex, to spare the Claude subscription limit.
- `XIV_AGENT_MAX_USD` — hard per-agent spend cap.

**Stack planning is off the tier ladder**: `xiv stack plan` runs Claude Fable 5 at `xhigh` in both
tiers. It runs once per feature and fixes the issue order that every later command inherits, so a
bad plan is a rebuild rather than a bad paragraph.

**Effort is not universal.** `--effort` is a 5-family capability and the 4.5-generation models
reject it, so effort is attached only to models known to accept it. A model that doesn't
(cheap-tier Haiku, or a custom `XIV_MODEL_*` override) inherits the CLI default instead of failing.
If you add a model to `pack/agents.ts`, add it to `EFFORT_CAPABLE_MODELS` too if it takes the flag.

e.g. `XIV_TIER=quality xiv stack build --feature payments --all-repos`. These are **pack settings**,
so run `xiv update` after changing defaults in `pack/agents.ts`. Check the repo `README.md` for the
current, full table.

## Iteration cap

The implement loop is capped at **3** passes (`implement → validate → review`), overridable with
`--max-iterations` (clamped 1–10) on `xiv implement`, `xiv ship`, and `xiv stack build`. The clamp
lives in the workflow, not just the CLI, because the same input also arrives via `xiv dev --input`
and via the `stack-build` subflow.

## Guardrails

- Don't raise the tier on your own — default cheap; escalate cost only when the human asks or the
  task is clearly hard, and say so.
- `xiv check` is free and side-effect-free; prefer it over `xiv dev` when you only need to validate
  a workflow's shape.
