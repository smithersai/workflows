# Stacked-PR features (`xiv stack`)

`xiv stack` takes a whole Linear feature — a project, or a parent issue with sub-issues — and
builds it as a **stack of locally-committed branches**, one reviewable PR per issue, each stacked
on the one below. You build the stack locally, publish a few PRs at a time, and when a low change
needs editing it re-flows up through every descendant (via **jj**, run colocated with git).

This doc is intentionally thin: the stack lifecycle has two dedicated skills and a live runbook
that are the real source of truth. Your job is to route to them.

## The lifecycle (and who owns each part)

1. **Plan** — order the issues, assign each to a repo, exclude non-code work. → **use the
   `stack-plan` skill.** It's interactive: it auto-assigns the obvious issues and makes the human
   decide the unclear/non-code ones, then persists a resolved plan with `xiv stack plan --plan`.
2. **Build** — `xiv stack build` runs every entry through `linear-implement` locally, bottom to
   top. Resumable. Long/overnight. → **while it runs, use the `xiv-operator` skill** to babysit it:
   it polls `xiv stack triage`, resumes transient failures, and escalates real problems.
3. **Inspect** — `xiv stack status` (positions/branches/PRs), `xiv stack preview` (check out the
   tip to try the whole feature), `xiv stack triage` (compact next-action state).
4. **Publish** — `xiv stack push` is the **only** command that touches GitHub: opens PRs for the
   next batch and re-syncs any open PR a later amend re-flowed.
5. **Amend** — `xiv stack amend -m "…"` applies a change to one entry and lets jj re-flow it through
   the descendants, then re-validates. Local-only until you `push` again.
6. **Review** — `xiv stack review` drives the open stacked PRs to all-approved, fixing each finding
   in its owning branch and cascading up. Never merges.

Multi-repo features fan out with `--all-repos` / `--repo <key>`; each repo gets its own substack.

## How to drive it

- **Full runbook:** run `xiv how-to` — it prints the authoritative, current orchestration guide
  (the triage-driven loop and the action→command mapping). Prefer it over anything memorized here.
- **Current flags:** `xiv stack <subcommand> -h`.
- **One-time setup per repo:** `xiv stack init` (switches on jj colocated; reversible). Requires
  `jj` on PATH.

## Guardrails

- **Never merge** any stacked PR.
- Building is local and resumable — a crash mid-stack resumes by skipping built entries; don't
  restart from scratch, and don't `push` to "fix" a build problem.
- Hand long builds to `xiv-operator` rather than watching them yourself step by step, and let it
  escalate jj conflicts / auth expiry / repeated test failures to the human.
