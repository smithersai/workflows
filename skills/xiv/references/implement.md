# Implement / ship a Linear issue

Two commands turn a Linear issue into code. Pick by **how far** the user wants to go:

- **`xiv implement <issueId>`** — plan → implement → validate → review **on a dedicated branch**,
  locally. It does *not* open a PR. Use this when the user wants the work done but is keeping
  control of when/whether it's published — e.g. "implement ENG-123", "implement ENG-123 but don't
  push".
- **`xiv ship <issueId>`** — `implement`, then open a PR and drive the review loop to approval. Use
  when the user wants the whole thing taken to a review-ready PR — e.g. "ship ENG-123".

Run `xiv implement -h` / `xiv ship -h` for current flags. As of now both take a `--tdd` flag (plan
tests before production code) and `ship` takes `--base` (PR target branch).

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
Linear. For a genuinely hard issue, the human may want `XIV_TIER=quality` — see
`references/authoring.md`. Don't raise the tier on your own.

## Guardrails

- Never merge the resulting PR (for `ship`).
- If validation or review keeps failing, stop and escalate with the failure output rather than
  forcing the run forward.
