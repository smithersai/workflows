# Implement / ship a Linear issue

Two commands turn a Linear issue into code. Pick by **how far** the user wants to go:

- **`xiv implement <issueId>`** — plan → implement → validate → review **on a dedicated branch**,
  locally. It does *not* open a PR. Use this when the user wants the work done but is keeping
  control of when/whether it's published — e.g. "implement ENG-123", "implement ENG-123 but don't
  push".
- **`xiv ship <issueId>`** — `implement`, then open a PR and settle its CI status and human review
  comments. Use when the user wants the whole thing taken to a review-ready PR — e.g. "ship
  ENG-123".

Run `xiv implement -h` / `xiv ship -h` for current flags. As of now both take a `--tdd` flag (plan
tests before production code) and `--skip-acceptance-review` (drop the local review step;
validation still gates), and `ship` takes `--base` (PR target branch).

## The review step

The `review` in that loop is a **local** review agent: it reads the working-tree diff against the
issue's acceptance criteria and returns `approve` / `comment` / `request_changes` plus prioritized
findings, following the `xiv-review-core` skill's judgment. Only `request_changes` sends the work
back for another pass, and validation (tests/lint/typecheck) is always the real gate — a review
that crashes or returns nothing can never wedge the loop. Nothing is pushed and nothing is posted
during implement.

## "implement but don't push"

`xiv implement` already stops at a local branch — it never pushes or opens a PR. So "implement
ENG-123 but don't push" maps to **`xiv implement ENG-123`** (not `ship`). Don't add a `git push`
afterward unless the user asks. If they later say "now open the PR and get it reviewed," that's
`xiv pr refine --branch <name>` (see `references/review.md`) or `xiv ship`.

## Where the work lands

These run the `linear-implement` Smithers workflow against the repo you invoke them from
(`SMITHERS_TARGET_CWD`). The branch is created in that repo. Watch progress with `xiv ps` / `xiv ui`
(see `references/smithers-ops.md`) — implementation is a multi-step agent run, so give it time and
judge by progress, not silence.

## Cost

Defaults to the cheap model tier, which is right when the issue is already well-specified in
Linear. For a genuinely hard issue, the human may want `XIV_TIER=quality` (implement → Opus 5,
review → Sol, planning → `xhigh`) — see `references/authoring.md`. Don't raise the tier on your own.

The other lever is `--max-iterations` (default 3, clamped 1–10): how many
`implement → validate → review` passes an issue may take before the run returns its last attempt.
Raising it only costs anything for issues that actually fail a pass, so `--max-iterations 5` is a
reasonable ask for a gnarly issue; `--max-iterations 1` fails fast when you want to see the first
attempt before spending more. Don't raise it on your own either — if the loop is burning passes,
that's usually a signal to stop and escalate, not to add passes.

## Guardrails

- Never merge the resulting PR (for `ship`).
- If validation or review keeps failing, stop and escalate with the failure output rather than
  forcing the run forward.
