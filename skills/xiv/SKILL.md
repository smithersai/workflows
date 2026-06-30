---
name: xiv
description: Home/router skill for the `xiv` CLI — the agent-operated front door to the managed Smithers Linear/PR workflows (implement, ship, review, pr review, the whole `xiv stack` lifecycle, plus run observability). Routes you to the right per-task reference doc and the right command, and carries the operator discipline for launching and babysitting agent workflows. Use this whenever the user invokes `/xiv`, says "use xiv to …", asks to implement/ship a Linear issue, review or drive a PR, build/manage a stacked feature, or check on / recover a running Smithers workflow — even if they don't name the exact subcommand.
metadata:
  internal: false
allowed-tools:
  - Bash(xiv:*)
  - Bash(smithers:*)
  - Bash(gh:*)
  - Bash(git:*)
  - Bash(jj:*)
---

# xiv

`xiv` is a thin CLI that runs managed **Smithers** workflows (Linear issue → branch/PR, PR review
loops, stacked-PR features) from whatever repo you're in. It was built to be driven **by you, an
agent** — you rarely run it for a human at a terminal; you launch its workflows, watch them, keep
them alive, and flag real trouble to the human. Think of yourself as the orchestrator of *other*
agent workflows.

This skill is a **router**. Figure out what the user is trying to do, open the reference doc that
matches that **intent**, and follow it. Don't read every doc up front. Most tasks need exactly one;
some span two areas (e.g. "is my stack build stuck?" is *observe* + *stack*) — in that case start
with the doc matching the intent and follow its cross-links to the other. When the surface word and
the intent disagree (a request mentions "stack" but is really asking you to *check on* a run), route
by intent.

## Operator mindset

A Smithers workflow is a long-running, multi-agent run, not a single command that returns. So your
job is a loop, not a one-shot:

1. **Launch** the right `xiv` command for the task (see the routing table).
2. **Watch** it — `xiv ps` (what's running), `xiv logs`, `xiv ui` (live graph), `xiv stack triage`
   for stacks. A quiet run is usually *working*, not stuck; judge by progress, not silence.
3. **Babysit** — resume transient failures, but **stop and escalate** anything you don't
   understand (auth expiry, merge/rebase conflicts, repeated test failures). When in doubt, ask
   the human rather than improvising.
4. **Report** what happened and what you did — especially anything you escalated.

## Standing guardrails

These hold across every xiv flow unless the human explicitly overrides them in this conversation:

- **Never merge a PR.** No `gh pr merge`, no auto-merge. Merging is the human's call.
- **Never submit or push a review without explicit instruction.** Generating a review is fine;
  posting it to GitHub is a separate, human-authorized step. When unsure, print and ask.
- **Never push someone else's branch** or force-push without being told to.
- **Default to the cheap model tier.** Only raise it (`XIV_TIER=quality`) when the human asks or
  the task is genuinely hard. See `references/authoring.md`.
- **Don't hardcode flags from memory.** The CLI is the source of truth: run `xiv <command> -h` for
  current flags, and `xiv how-to` for the full stacked-feature runbook.

## Routing table

Match the user's intent to a row, read that doc, then run the command it points to.

| The user wants to… | Read | Command family |
|---|---|---|
| Implement or ship a single Linear issue (e.g. "implement ENG-123", "ship ENG-123") | `references/implement.md` | `xiv implement` / `xiv ship` |
| Review **someone else's** PR and decide what to submit | `references/review.md` (+ the `xiv-review-core` skill for the actual review judgment) | `xiv pr review` |
| Drive **my own** PR to approval automatically | `references/review.md` | `xiv review --pr` |
| Build a whole Linear feature as a stack of PRs | `references/stack.md` → then the `stack-plan` and `xiv-operator` skills, and `xiv how-to` | `xiv stack …` |
| Check on, recover, or cancel a running workflow | `references/smithers-ops.md` | `xiv ps` / `logs` / `ui` / `inspect` / `down` / `cancel` |
| Author, test, or iterate a workflow itself | `references/authoring.md` | `xiv dev` / `check`, `xiv init` / `update` |

### Disambiguating "review"

"Review" is overloaded in xiv — pick deliberately:

- **`xiv review --pr N`** — autonomous loop on **your own** PR: triggers the AI reviewers and loops
  fix→re-request until they approve. Never merges.
- **`xiv pr review`** — interactive review of **someone else's** PR: an agent reviews it in a
  worktree, *you* pick the verdict and findings, then submit. Never submits without your say-so.
- **the `xiv-review-core` skill** — the code-review *judgment* itself (no CLI): gather context,
  find the findings, print them. It never posts anything on its own.

When the user says "review a PR," figure out **whose PR** and **whether they want it submitted** —
`references/review.md` walks through it.

## When something is off

If a command isn't a clean fit, or the run is in a state you can't classify, prefer
`references/smithers-ops.md` and `xiv how-to` over guessing — and escalate to the human with what
you saw rather than forcing an action.
