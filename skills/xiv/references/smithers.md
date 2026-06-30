# Smithers — the engine under xiv

Read this when you need to understand *why* an xiv run behaves the way it does, read its logs/UI
fluently, or dig into Smithers itself. For just launching and watching runs, `references/smithers-ops.md`
is enough — come here when that isn't.

## What it is

**Smithers orchestrates AI coding agents at scale with composable, model- and harness-agnostic
workflows.** Every `xiv` command (`implement`, `ship`, the `pr` family, `stack …`) is really a
Smithers *workflow run*; `xiv` is the thin wrapper that launches and manages it. So when you read a
run's output, you're reading Smithers.

## How xiv sits on top

- `xiv init` / `xiv update` install the managed workflow pack into `SMITHERS_HOME` (`~/.smithers`).
- An `xiv` command starts a workflow run there, pinned to the repo you invoked it from
  (`SMITHERS_TARGET_CWD`).
- `xiv ps` / `logs` / `ui` / `inspect` / `down` / `cancel` forward straight to the `smithers` CLI.
  The full CLI has more (e.g. `up`, `graph`, `why`, `events`, `supervise`, `ask-human`) — reach for
  raw `smithers` only when `xiv` doesn't expose what you need.

## Core vocabulary (what you'll see in logs and the UI)

- **Workflow** — a JSX/TSX tree defining the orchestrated steps (lives in `pack/workflows/*.tsx`).
- **Task** — one step; its output is validated against a **Zod schema** (structured output, not prose).
- **Agent** — the model instance assigned to a task (xiv picks these by tier; see `authoring.md`).
- **Run** — one execution of a workflow, with persistent state.
- **Render loop** — Smithers persists each completed step immediately, so a crashed run **resumes
  from the last persisted step** instead of redoing finished work. This is why "re-run it" is safe
  and usually the right recovery (e.g. `xiv stack build` skips built entries).
- **Sequence / Parallel / Loop** — ordered, concurrent, and repeat-until control flow inside a workflow.
- **Gateway** — the HTTP API for launching runs, streaming events, and approvals.
- **State** — runs, outputs, and events persist to **SQLite under `SMITHERS_HOME`**; stack maps live
  at `~/.smithers/stacks/`.

## Authoring (when changing workflows, not running them)

Workflows are `pack/workflows/*.tsx` (JSX/TSX) with prompts as `pack/prompts/*.mdx`. Iterate with
`xiv dev` / `xiv check` — see `references/authoring.md`.

## Digging deeper into the Smithers docs

Only three URLs resolve on the docs site — there are no per-topic pages:

- **Human overview:** https://smithers.sh/introduction — the conceptual intro.
- **Agent index:** https://smithers.sh/llms.txt — a short table of contents.
- **Full reference:** https://smithers.sh/llms-full.txt — the complete bundle (runtime, CLI, JSX,
  components, Memory, Observability, Events, Effect-ts authoring, Integrations).

**Context discipline:** `llms-full.txt` is large — do **not** load it wholesale. Use `WebFetch`
with a *specific question* (e.g. "the exact `smithers events` subcommand and its flags", "how Loop
`onMaxReached` works", "the SmithersEvent union") so you pull only the slice you need. Start from
`/introduction` or `/llms.txt` to find the topic, then query `/llms-full.txt` for that one thing. If
a dedicated Smithers docs skill is ever installed, prefer it over fetching these URLs.
