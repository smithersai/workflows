# Reviewing PRs

There are three distinct "review" tools. Choosing wrong is the most common mistake here, so decide
deliberately. Two questions settle it: **whose PR is it?** and **do they want it submitted?**

## First: resolve what you're reviewing

The user often names a **Linear issue key** ("review ENG-123"), not a PR number. `xiv pr review`
and `xiv review --pr` both take a **PR number**, so bridge the key to its PR before running
anything:

- Run `xiv pr review` with **no argument** — it lists open PRs interactively, and you (or the
  human) pick the one for ENG-123. This is the simplest bridge and avoids guessing.
- Or look it up first: `gh pr list --search "ENG-123"` (issue keys usually appear in the PR title,
  body, or the `eng-123-*` branch name). Confirm you found the right PR before reviewing.

If no PR exists for the issue yet, there's nothing to `xiv pr review` — the work may be a local
branch only (see `references/implement.md`), or use the `xiv-review-core` skill to review the diff
directly. Don't invent a PR number.

## Whose PR? (the tiebreaker)

If the user doesn't say whose PR it is, infer from intent rather than guessing:

- "review X **but don't push/submit**", "leave comments on", "take a look at" → treat as a
  **review-only** task → **`xiv pr review`** (it supports review-without-submitting cleanly).
- "get my PR approved", "drive review on my PR", "loop until the bots approve" → it's **your own**
  PR and you want it shepherded → **`xiv review --pr`** (an autonomous fix-and-re-request loop that
  *does* push, so only when pushing is clearly wanted).

In short: a "don't push / don't submit" constraint rules out `xiv review --pr` and points to
`xiv pr review`. When ownership and intent are both unclear, ask the human.

## The fork

### 1. `xiv pr review` — someone else's PR, you decide what to submit
Interactive. An agent pulls the PR into an isolated git worktree, reviews the diff, and prints
structured findings; then *you* (with the human) pick the verdict (approve / request changes /
comment), select which findings to include, choose which become inline comments, edit the
top-level body, and submit via `gh`. This is the default when the user wants to **review another
person's PR**.

- Run `xiv pr review` to pick from open PRs interactively, or `xiv pr review <number>`.
- `--repo owner/name` reviews a repo you're not currently in (auto-clones if needed).
- `xiv pr review -h` for all flags (e.g. `--keep`, `--auto-submit`, `--prompt-file`).
- **It never submits without an explicit confirmation step**, and `--auto-submit` is opt-in by the
  human only. If the user says "review PR 88 but don't submit," just run the review and report the
  findings — do not pass `--auto-submit` and do not submit at the prompt.

For the *judgment* of what makes a finding worth flagging, the **`xiv-review-core` skill** is the
authority — it gathers context (linked Linear issue, prior PR comments, CI) and decides what the
author would actually fix. `xiv pr review` is the CLI that pulls the PR and submits; `xiv-review-core`
is how to think about the review. They compose.

### 2. `xiv review --pr N` — your own PR, drive it to approval automatically
Autonomous loop on **your own** open PR: triggers the AI reviewers (claude/codex), waits, fixes
findings, re-requests, and loops until they approve. Never merges. Use when the user wants their PR
shepherded to green without hand-holding. `xiv review --branch <name>` opens a fresh PR from a
branch first, then loops. `xiv review -h` for flags.

### 3. `xiv-review-core` skill — just the review, no CLI
When the user wants findings on a branch/diff/PR but **no command run and nothing posted** (e.g.
"review this change", "what's wrong with this branch"), defer to the `xiv-review-core` skill. It
prints prioritized findings and, by design, never submits anything.

## Decision shortcuts

- "review eng-123 / this PR but don't push/submit" → `xiv pr review <n>` (or `xiv-review-core` if no
  PR exists yet), report findings, **submit nothing**.
- "get my PR approved / drive review on #N" → `xiv review --pr N`.
- "review someone's PR and leave comments" → `xiv pr review`, then submit *after* the human confirms
  verdict + findings.

## Guardrails

- **Never submit or push a review without explicit instruction** — generating ≠ posting.
- **Never merge.**
- Don't force `--auto-submit`; it exists for the human to choose, not for you to default to.
