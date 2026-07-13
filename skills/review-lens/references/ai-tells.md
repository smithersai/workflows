# AI-pressure probes

Authorship is a soft prior, not a verdict. Activate **AI-pressure probes** when several of these show up; skip the section when the diff looks tightly human-scoped.

## Soft authorship signals

- Large, evenly confident diff with little struggle evidence (no TODOs, no "we tried X," uniform naming).
- Tests that restate the implementation function-by-function, especially with identical branch structure.
- Comments that narrate what the next line does rather than why a non-obvious choice was made.
- Drive-by renames, import reshuffles, or "cleanup" outside the ticket's blast radius.
- New helpers/abstractions that nothing else needs yet (speculative generality).
- Error handling that looks complete (many branches) but maps everything to one generic path.
- Config/env/docs added with plausible defaults never verified against how this repo actually runs.

## Probe bank (pick 1–3)

- Which part of this diff would you be embarrassed to claim you understood if it broke Friday night?
- Where does the test suite reward matching the implementation rather than protecting a user/invariant?
- What would you delete from this PR without changing the stated outcome — and why is it there?
- Which new abstraction has a single caller, and what simpler shape would that caller use instead?
- If the model hallucinated an API this repo doesn't have, where would that lie most convincingly?
- What edge case is handled in comments or names but not in executable branches?
- Which "obvious" default (timeout, limit, flag, permission) was invented here rather than read from existing house style?
- Cross-file consistency: if two files both define a similar constant/type/helper, which one is authoritative after merge?

## How to phrase them

Keep AI-pressure probes framed as **review hygiene**, not model-shaming:

- Good: "What would you delete without changing the stated outcome?"
- Bad: "This was clearly written by AI so distrust everything."

The habit being trained is **calibrated skepticism under polished certainty** — useful for human PRs too.
