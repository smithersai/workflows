# xiv

Thin CLI for running the managed Smithers Linear/PR workflows from any repo.

```bash
bun install
bun link
xiv init
cd /path/to/target-repo
xiv implement ENG-123
xiv review --pr 1234
xiv ship ENG-123
```

`xiv` keeps Smithers runtime state in `SMITHERS_HOME` (default `~/.smithers`) and sets `SMITHERS_TARGET_CWD` to the repo where you invoked the command.

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

```bash
cd /path/to/target-repo
xiv stack init                                   # one-time: jj git init --colocate
xiv stack plan ENG-400 --feature checkout        # Linear project/parent -> ordered stack map
xiv stack build  --feature checkout              # overnight: build every entry locally, no push. Resumable.
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
GitHub — it opens PRs for the next batch and force-pushes/re-requests review on any open PR a later
`amend` re-flowed. `amend` is local-only: it applies your change to the located entry and lets jj
auto-rebase the descendants, then re-validates the tip.

## Authoring workflows

Workflows live in `pack/workflows/*.tsx`. To iterate, run them straight from the repo's `pack/` — no `xiv init`/`update` round-trip into `SMITHERS_HOME`:

```bash
cd pack && bun install   # one-time: install the pack's own deps
cd /path/to/target-repo  # the repo the workflow should operate on

xiv check linear-implement --input '{"issueId":"ENG-123"}'   # render the graph, no agents (fast, free)
xiv dev   linear-implement --input '{"issueId":"ENG-123"}'   # run it live against this repo
```

`dev`/`check` accept a bare workflow name or a path, and default `--cwd` to the current directory (override with `--cwd /path/to/repo`). They run against the in-repo `pack/` — the source of truth — so edit-and-rerun is a single command.
