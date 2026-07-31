# xiv

Thin CLI for running the managed Smithers Linear/PR workflows from any repo.

```bash
bun install
bun link
xiv init
cd /path/to/target-repo
xiv implement ENG-123
xiv pr refine 1234
xiv ship ENG-123
```

`xiv` keeps Smithers runtime state in `SMITHERS_HOME` (default `~/.smithers`) and sets `SMITHERS_TARGET_CWD` to the repo where you invoked the command.

### What `init` / `update` install

Two things, with different destinations:

| Layer | Destination | Read by |
|---|---|---|
| the pack (`pack/`) | `SMITHERS_HOME` | the Smithers engine, when running a workflow |
| skills (`skills/`) | your agent dirs, via the `skills` CLI | the agent driving `xiv` |

```bash
xiv update                 # both
xiv update --no-skills     # pack only (offline, or keep the agent's current skills)
```

The skills step installs **all** of this repo's skills but **prompts for which agents** to install
them into — that choice is yours, not the tool's, so it is never auto-answered.

Both install from the **working tree**, not a commit — so `xiv update` on a dirty repo hands your
agent unreleased instructions. If the skills step fails, the pack update still succeeds and the
command warns; rerun that half alone with `npx skills@latest add <repo> --skill '*' --global`.

The CLI itself needs no install — `bun link` points `xiv` at this repo, so command and flag changes
are live immediately.

## Review model

Code review happens **locally**, inside the implement loop, before anything is pushed: a review
agent reads the working-tree diff against the issue's acceptance criteria and returns a verdict
(`approve` / `comment` / `request_changes`) plus prioritized findings. The judgment it applies is
the `xiv-review-core` skill in `skills/`. Nothing ever waits on a review bot on GitHub.

Once a PR exists, the only signals left that GitHub alone can supply are **CI status** and
**comments from human reviewers**. `xiv pr refine` and `xiv stack review` read exactly those, fix
what they raise, and push — they do not poll, do not tag anyone, and never merge.

## Stacked features (`xiv stack`)

`xiv stack` takes a whole Linear feature — a project, or a parent issue with sub-issues — and
builds it overnight as a **stack of locally-committed branches**, one reviewable branch per
issue, each stacked on the one below it. You then publish them to GitHub a few at a time, and
when you need a change low in the stack, it re-flows up through every descendant automatically.

The rebase engine is [jj (Jujutsu)](https://github.com/jj-vcs/jj), run **colocated** alongside
git (`.jj/` lives next to `.git/`; remove it anytime to undo). GitHub, CI, and reviewers see a
normal git repo with normal branches and PRs — you `git checkout pr-17` and review diffs in your
usual tools as always. The rule: **read** with git, **edit/restack** through `jj` or `xiv stack`.
Requires `jj` on `PATH` (`brew install jj`).

Run `xiv how-to` any time for the full orchestration runbook — it's also what the `xiv-operator`
skill points agents at to get up to speed.

### Model tiers (cost)

Agents default to a **cheap** tier, which is plenty when the work is already fully spec'd in Linear.
Both providers take an explicit reasoning effort, so a tier is raised by model, by effort, or by
both — the per-step assignment is a mixed pipeline, not a single provider:

| Step | Cheap | Quality (`XIV_TIER=quality`) |
|---|---|---|
| fetch-issue | `gpt-5.6-luna` low | *same* |
| plan | `gpt-5.6-sol` low | `gpt-5.6-sol` **xhigh** |
| implement | `claude-sonnet-5` medium | **`claude-opus-5`** xhigh |
| validate | `gpt-5.6-luna` low | *same* |
| review | `gpt-5.6-terra` high | **`gpt-5.6-sol`** high |
| finalize | `claude-sonnet-5` low | *same* |

Only three steps change between tiers. The other three are mechanical — an MCP call, running the
repo's own lint/test commands, and committing — where capability buys nothing.

**Stack planning sits off this ladder entirely**: `xiv stack plan` runs **Claude Fable 5 at
`xhigh`** in both tiers. It runs once per feature and decides the issue order every later command
inherits, so getting it wrong is a rebuild, not a bad paragraph.

Override per run via env (passed through to the workflow):

| Env | Default (cheap) | Effect |
|---|---|---|
| `XIV_TIER=quality` | `cheap` | Raise implement to Opus 5, review to Sol, plan to xhigh |
| `XIV_MODEL_HEAVY` | `claude-sonnet-5` | Model for implement + autonomous jj work |
| `XIV_MODEL_LIGHT` | `claude-haiku-4-5` | Claude model for mechanical steps |
| `XIV_EFFORT_HEAVY` | `medium` | Claude effort: `low`\|`medium`\|`high`\|`xhigh`\|`max` |
| `XIV_EFFORT_LIGHT` | `low` | Claude effort for mechanical steps |
| `XIV_STACK_PLAN_MODEL` | `claude-fable-5` | Stack planner model |
| `XIV_STACK_PLAN_EFFORT` | `xhigh` | Stack planner effort |
| `XIV_CODEX_MODEL` | `gpt-5.6-terra` | codex model for all-codex mode |
| `XIV_CODEX_REASONING` | `low` | codex reasoning effort |
| `XIV_ENGINE=codex` | `claude` | Run every step on codex (spares the Claude limit) |
| `XIV_AGENT_MAX_USD` | (none) | Hard per-agent spend cap |

`--effort` is a 5-family capability; the 4.5-generation models reject it. Effort is therefore
attached only to models known to accept it — a model that doesn't (cheap-tier Haiku, or a custom
`XIV_MODEL_*` override) simply inherits the CLI's own default rather than failing.

e.g. `XIV_TIER=quality xiv stack build --feature payments --all-repos`. These are **pack settings**,
so `xiv update` after changing defaults in `pack/agents.ts`.

### Iteration cap

The implement loop runs `implement → validate → review` up to **3** times, stopping as soon as
validation passes and the review isn't requesting changes. Override with `--max-iterations`
(clamped 1–10) on `xiv implement`, `xiv ship`, or `xiv stack build`:

```bash
xiv implement ENG-123 --max-iterations 5      # give a gnarly issue more passes
xiv stack build --feature payments --max-iterations 1   # fail fast across the stack
```

Raising it only costs anything for issues that actually fail a pass — a clean issue still exits
after one.

The other big cost/time lever is `--skip-acceptance-review`: it drops the local review step from
the implement loop (validation — tests/lint/typecheck — still gates every entry), which is usually
the right trade when the issues are fully spec'd. Set it once at plan time to make it the
feature-wide default
(`xiv stack plan … --skip-acceptance-review`, recorded in the stack map), or per run on
`xiv stack build` / `xiv implement` / `xiv ship`. Per-run flags OR with the map default — they can
force skipping on, but never re-enable review for a map that opted out.

```bash
cd /path/to/target-repo
xiv stack init                                   # one-time: jj git init --colocate
xiv stack plan ENG-400 --feature checkout        # Linear project/parent -> ordered stack map
                                                 #   (--skip-acceptance-review records the no-local-review default)
xiv stack build  --feature checkout              # overnight: build every entry locally, no push. Resumable.
                                                 #   (--skip-acceptance-review to drop the local review step this run)
xiv stack status --feature checkout              # see positions, statuses, branches, PRs
xiv stack preview --feature checkout             # git checkout the tip = preview the whole feature
xiv stack push   --feature checkout --count 5    # publish the lowest 5 as stacked PRs (+ re-sync re-flowed PRs)
xiv stack amend  --feature checkout -m "rename the column" [--target ENG-401]
                                                 # edit one entry; jj re-flows it through every descendant
```

### Multi-repo features

A feature can span several repos (e.g. microservices). Pass one `--repo key=path` per repo to
`plan` (omit for single-repo = the current directory); the planner assigns each Linear issue to a
repo and gives each repo its **own independent substack** (stacking is within a repo only). Then
`xiv stack build --all-repos` fans out one pinned run per repo in parallel (`xiv stack init` each
repo first), and `xiv stack preview` checks out **every** repo at its tip so all services are
feature-complete together for local testing. Cross-repo contract breaks aren't auto-propagated —
they surface at integration-test time (or to you).

```bash
xiv stack plan PROJ-42 --feature payments \
  --repo api=/code/api --repo ledger=/code/ledger-rs --repo notifier=/code/notifier
xiv stack build --feature payments --all-repos
xiv stack preview --feature payments        # all three repos at their tips
```

When the repo for an issue isn't obvious, use the **`stack-plan` skill** (in `skills/stack-plan/`):
your agent fetches the issues, auto-assigns the obvious ones, asks you about the unclear ones, and
recommends **excluding** non-code work (e.g. "set GCP secrets") — then writes a resolved plan and
persists it with `xiv stack plan --feature <slug> --repo … --plan <file>`. Excluded issues are
recorded in the map and shown by `xiv stack status`, never built.

`plan` orders the issues into a dependency-respecting sequence and writes a **stack map** — the
source of truth linking each Linear issue to its branch, position, and PR. It lives in
`SMITHERS_HOME` at `stacks/<repo-slug>/<feature>.json` (per target repo). `build` runs each issue
through the `linear-implement` workflow on a branch stacked on the previous one, all local; a
crash mid-stack resumes by skipping already-built entries. `push` is the only command that touches
GitHub — it opens PRs for the next batch and force-pushes any open PR a later `amend` re-flowed.
`amend` is local-only: it applies your change to the located entry and lets jj auto-rebase the
descendants, then re-validates the tip.

## Authoring workflows

Workflows live in `pack/workflows/*.tsx`. To iterate, run them straight from the repo's `pack/` — no `xiv init`/`update` round-trip into `SMITHERS_HOME`:

```bash
cd pack && bun install   # one-time: install the pack's own deps
cd /path/to/target-repo  # the repo the workflow should operate on

xiv check linear-implement --input '{"issueId":"ENG-123"}'   # render the graph, no agents (fast, free)
xiv dev   linear-implement --input '{"issueId":"ENG-123"}'   # run it live against this repo
```

`dev`/`check` accept a bare workflow name or a path, and default `--cwd` to the current directory (override with `--cwd /path/to/repo`). They run against the in-repo `pack/` — the source of truth — so edit-and-rerun is a single command.
