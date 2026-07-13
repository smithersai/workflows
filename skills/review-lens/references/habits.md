# Habits this skill trains

Each active lens should tag one habit. Habits are the lasting residue; probes are disposable scaffolds. Name habits consistently so the human learns to summon them without the skill.

## Habit catalog

| Habit name | What you practice | Graduation cue |
|---|---|---|
| `trace-lifecycle` | Follow create → use → expire → revoke for identities, sessions, resources | You automatically ask "what's left after logout/expiry?" on auth diffs |
| `name-the-denied` | Explicitly invent the unauthorized actor and where they're stopped | You check authorization before polishing happy-path logic |
| `preserve-the-invariant` | State the money/data invariant in one sentence, then find what upholds it under retry | You refuse to approve ledger/billing changes without an idempotency story |
| `expand-contract` | Ask whether old and new binaries can coexist on this data | You spot single-step destructive migrations before reading the rest |
| `count-the-callers` | Treat shared modules as leveraged risk; scan importers mentally or via search | A one-line shared helper change feels scarier than a 200-line leaf |
| `two-at-once` | Mentally dualize the request (concurrency, double-click, duplicate webhook) | You reach for races/idempotency before nitpicking names |
| `who-controls-input` | Label each input trusted/untrusted and find the first validation | You stop assuming server shapes are safe because TypeScript compiled |
| `fail-closed` | Ask what happens when config/flag/secret is missing | Missing env feels like a security review item, not an ops footnote |
| `state-the-states` | Enumerate empty/loading/error/success (and back/refresh) for UI flows | You notice missing error/empty states before visual polish |
| `carry-the-shape` | Track a changed type/schema from definition through every consumer | Contract drifts feel like the first thing to read, not the last |
| `test-the-gap` | Ask what buggy code would still make the new tests green | You distrust mirrors-of-implementation tests instinctively |
| `diff-the-intent` | Diff the PR description against the file list; question orphans | Drive-by scope jumps out without a checklist |
| `stale-read` | After writes, ask which cache/read path can lie | Caching changes trigger invalidation questions automatically |
| `what-does-oncall-see` | On each new failure branch, ask what is logged/metric'd vs swallowed | Silent `catch` blocks feel as loud as logic bugs |
| `calibrated-skepticism` | Under polished, confident diffs, slow down and hunt for invented truth | You apply AI-pressure probes to any too-smooth large change |

## How the agent should talk about habits

- In **Habit Focus**, list only the habits tied to *this* PR's active lenses (usually 2–3).
- Phrase graduation as aspiration, not grade school: "Goal: next similar PR, run these probes yourself before opening this skill."
- Never score the human. Never say they're junior. The frame is **deliberate practice toward independence**.
- If the human says they're reviewing without the skill, celebrate briefly and offer to be a backstop only when they get stuck — don't push the scaffold.

## Pairing with review-path

Suggested deliberate-practice loop for a PR:

1. `review-path` — where attention goes.
2. `review-lens` — which questions to carry.
3. Human reads the diff and answers probes privately (or aloud).
4. Only then, if they want an independent findings pass, `xiv-review-core` / `xiv pr review`.

Repeating steps 1–3 is how the lenses become automatic; step 4 is optional QA, not a teacher.
