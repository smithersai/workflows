# Watching and recovering runs

Every `xiv` workflow is a long-running Smithers run living in `SMITHERS_HOME` (default
`~/.smithers`). These commands are how you observe and recover them — they forward to `smithers`
under the hood. Run `xiv <command> -h` for current flags. For the concepts *behind* these runs
(tasks, the persist-each-step render loop, why re-running is safe) and how to reach the Smithers
docs, see `references/smithers.md`.

## Observe

- **`xiv ps`** — what's running right now. Your first check for "is it still going / did it finish?"
- **`xiv logs`** — run output; use it to see what step a run is on and to read failures.
- **`xiv ui`** — live workflow graph in the browser; best for seeing where a multi-step run actually
  is.
- **`xiv inspect`** — detailed state for a specific run.
- **`xiv stack triage --feature <slug>`** — for stacks, the compact "what's the next action" view
  (see `references/stack.md`).

## Reading state: working vs. stuck

A Smithers run is multi-agent and bursty — long quiet stretches during a hard implement or review
step are normal. Judge by **progress**, not silence:

- Step advancing in `xiv ui` / new lines in `xiv logs` over time → **working**, leave it alone.
- No progress for a long time **and** logs show an error, a prompt waiting on input, or a crashed
  process → **stuck**, act.
- Not sure which → check `xiv logs` for the last event before deciding; don't cancel a run just
  because it's quiet.

## Recover

- **`xiv cancel <run>`** — cancel one specific run.
- **`xiv down`** — cancel **all** active/orphaned runs (like `docker compose down`). Use to clear
  stale "running" runs that no longer have a live process — but confirm with the human first if any
  real work might be in flight, since it stops everything.
- **`xiv panic`** — same effect as `xiv down`, but it's the emergency verb: when a run is *actively*
  looping or burning credits, don't wait to ask — kill everything now and diagnose after. The
  "confirm first" caveat on `down` is for clearing quiet/stale runs; panic is for stopping the fire.
- **Resume** — most workflows are resumable (stacks especially: re-running `xiv stack build` skips
  built entries). Prefer resuming over restarting from scratch.

For a one-off "is it still going / is it stuck?" question, just observe it yourself with the
commands above and answer. Reach for the **`xiv-operator` skill** only when the run needs *ongoing*
supervision (a long or overnight stacked build) — it automates this observe→classify→act loop and
knows which failures are safe to resume versus escalate.

## When to escalate instead of act

Stop and tell the human (with what you saw) rather than improvising on:

- auth / token expiry (`gh`, Linear, model provider),
- jj or git merge/rebase conflicts,
- the same test or validation step failing repeatedly,
- any state you can't confidently classify.

## Guardrails

- `xiv down` is broad — don't reach for it as a default; it kills every run.
- Never "unstick" a run by merging a PR or force-pushing.
