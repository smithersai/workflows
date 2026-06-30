# Authoring workflows & tuning cost

For when the user is working **on xiv itself** — iterating on a workflow, installing/updating the
managed pack, or adjusting the model tier — rather than running a feature through it.

## Install / update the managed pack

- **`xiv init`** — install the managed Smithers workflow pack into `SMITHERS_HOME`. First-time
  setup.
- **`xiv update`** — update managed pack files, backing up local drift before overwrite. Run this
  after changing pack defaults (e.g. `pack/agents.ts`) so the installed copy matches.

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

Agents default to a **cheap** tier (Claude Sonnet for real work, Haiku for mechanical steps), which
is plenty when the work is fully specified in Linear. There's no separate "thinking level" — the
**model tier is the cost/reasoning lever**. Override per run via env (passed through to the
workflow):

- `XIV_TIER=quality` — lead with Opus (Sonnet for light steps) for genuinely hard features.
- `XIV_MODEL_HEAVY` / `XIV_MODEL_LIGHT` — set the models directly.
- `XIV_CODEX_REASONING` — codex fallback reasoning effort.
- `XIV_AGENT_MAX_USD` — hard per-agent spend cap.

e.g. `XIV_TIER=quality xiv stack build --feature payments --all-repos`. These are **pack settings**,
so run `xiv update` after changing defaults in `pack/agents.ts`. Check the repo `README.md` for the
current, full table.

## Guardrails

- Don't raise the tier on your own — default cheap; escalate cost only when the human asks or the
  task is clearly hard, and say so.
- `xiv check` is free and side-effect-free; prefer it over `xiv dev` when you only need to validate
  a workflow's shape.
