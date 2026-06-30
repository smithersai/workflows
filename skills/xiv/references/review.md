# Reviewing & driving PRs — the `xiv pr` family

Four tools cover "review"-shaped work. Choosing wrong is the most common mistake here, so decide
deliberately. The axis that matters most is **does code get changed and pushed?** — inbound
(evaluate, comment) vs. outbound (fix my code, push).

| Tool | Direction | Pushes code? | Use for |
|---|---|---|---|
| `xiv pr review [N]` | inbound | no (comments only) | reviewing a PR (usually someone else's) |
| `xiv pr fix [N]` | outbound, one-shot | yes, once | applying the findings already on a PR, then stopping |
| `xiv pr refine [N]` | outbound, loop | yes, repeatedly | driving a PR to all-AI-approved |
| `xiv-review-core` skill | inbound, no CLI | no | just printing findings, nothing posted |

## First: resolve what you're acting on

The user often names a **Linear issue key** ("review ENG-123"), not a PR number. Every `xiv pr`
command takes a **PR number** (or defaults to the current branch for `fix`/`refine`), so bridge the
key to its PR first:

- For `review`: run `xiv pr review` with **no argument** — it lists open PRs interactively and you
  pick the one for ENG-123. Simplest bridge, no guessing.
- Otherwise look it up: `gh pr list --search "ENG-123"` (the key usually appears in the PR title,
  body, or an `eng-123-*` branch name). Confirm the right PR before acting.
- For `fix`/`refine` on your own work, if you're **on the branch**, omit the number — they default
  to the current branch's PR.

If no PR exists yet, there's nothing for these commands — the work may be a local branch only (see
`references/implement.md`), or use the `xiv-review-core` skill to review the diff directly. Don't
invent a PR number.

## Choosing among the four

Two questions settle it: **do they want code changed/pushed?** and **do they want it submitted /
looped?**

- "review X", "leave comments on", "take a look", "but don't push/submit" → **`xiv pr review`**
  (inbound; posts only what you approve, pushes no code).
- "apply the review comments", "address the findings and push", "fix what the bots flagged" (once,
  no babysitting) → **`xiv pr fix`**.
- "get my PR approved", "drive it to green", "loop until claude/codex approve" → **`xiv pr refine`**.
- "what's wrong with this branch/PR", findings only, **nothing run or posted** → the
  **`xiv-review-core` skill**.

A "don't push / don't submit" constraint rules out `fix` and `refine` and points to `xiv pr review`
(or `xiv-review-core`). When intent is genuinely unclear, ask the human rather than guessing —
`fix` and `refine` mutate and push code, so don't reach for them on ambiguity.

**`xiv pr review` vs the `xiv-review-core` skill, when both are "report-only":** they overlap when
the user wants findings on a real PR but nothing posted. Tiebreaker — if they *just want to know
what's wrong*, prefer **`xiv-review-core`** (lighter, no worktree, purpose-built for the judgment).
Reach for **`xiv pr review`** when they might submit after seeing the findings, or specifically want
the PR pulled into a local checkout (e.g. to run or poke at the code). A bare "tell me what's wrong,
don't post" leans `xiv-review-core`; "take a look and leave comments" leans `xiv pr review`.

## The tools

### `xiv pr review [N]` — review and (optionally) submit
Interactive. An agent pulls the PR into an isolated git worktree, reviews the diff, and prints
structured findings; then *you* (with the human) pick the verdict (approve / request changes /
comment), select findings, choose which become inline comments, edit the top-level body, and submit
via `gh`. `xiv pr review` picks from open PRs; `xiv pr review <n>` jumps to one; `--repo owner/name`
reviews a repo you're not in (auto-clones). **Never submits without an explicit confirmation step**,
and `--auto-submit` is the human's choice, not your default — "review but don't submit" means run it
and report findings, nothing posted. `xiv pr review -h` for flags.

For the *judgment* of what's worth flagging, the **`xiv-review-core` skill** is the authority
(linked issue, prior comments, CI). `xiv pr review` is the CLI that pulls the PR and submits;
`xiv-review-core` is how to think about the review. They compose.

### `xiv pr fix [N]` — address existing findings once, push
Reads the findings already on the PR (across all comment surfaces), fixes the valid ones with real
changes + tests, commits, and pushes **once** — no waiting, no loop, no re-request. Defaults to the
current branch's PR. Use when the user wants the outstanding feedback applied and then to stop.
`xiv pr fix -h` for flags.

### `xiv pr refine [N]` — drive to AI approval (loop)
The full loop on a PR: trigger the AI reviewers, wait, fix findings, re-request, repeat until they
approve. Edits and pushes your branch each round. Never merges. Defaults to the current branch's PR;
`xiv pr refine --branch <name>` opens a fresh PR first, then loops. Use when the user wants their PR
shepherded to green hands-off. `xiv pr refine -h` for flags.

### `xiv-review-core` skill — findings only, no CLI
When the user wants findings on a branch/diff/PR but **nothing run and nothing posted** ("review
this change", "what's wrong with this branch"), defer to the `xiv-review-core` skill. It prints
prioritized findings and, by design, never submits or pushes.

## Guardrails

- **Never submit or push a review without explicit instruction** — generating ≠ posting.
- **`fix` and `refine` push code; `review` and `xiv-review-core` do not.** Match the tool to what
  the user actually authorized.
- Don't force `--auto-submit`; it's the human's lever, not your default.
- **Never merge.**
