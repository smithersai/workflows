# Allowed commands

These are the **only** commands you may run. Everything else is forbidden (see the guardrails
in `SKILL.md`). `<slug>` is the feature slug the human gave you.

## Observe (read-only — always safe)

```bash
xiv how-to                                 # the orchestration runbook (read once to learn the lifecycle)
xiv stack triage --feature <slug> --json   # PRIMARY: structured status + suggested action + raw run list
xiv stack triage --feature <slug>          # same, human-readable
xiv stack status  --feature <slug>         # the full stack map: every entry's status, branch, PR
xiv ps                                     # active / paused / recent Smithers runs
xiv logs                                   # tail the latest run's event log
smithers ps --all                          # all runs with status
smithers why <runId> --json                # structured reason a run is blocked/paused
smithers events <runId> --json --type run  # NDJSON run events (look for failures/errors)
smithers inspect <runId>                   # detailed run state
cat <stack-map-path>                        # the path is printed by triage's `hint`/errors
```

## Recover (safe — only these mutate anything)

```bash
xiv stack build --feature <slug> --detach  # (re)start/resume the build in the background. Idempotent: already-built entries are skipped.
smithers supervise                         # auto-resume stale/crashed runs (Smithers' own recovery loop)
smithers inspect <runId>                   # confirm a resume took
```

`xiv stack build` is **idempotent** — running it again never rebuilds finished entries, so
"resume the build" is always just `xiv stack build --feature <slug> --detach`.

**Carry the original launch flags through on a resume.** Idempotent means finished entries are
skipped; it does **not** mean the flags persist. Anything the human passed the first time —
`--max-iterations N`, `--skip-acceptance-review`, `--repo <key>`, or an env prefix like
`XIV_TIER=quality` — has to be repeated, or the remaining entries build under different settings
than the ones already done. `--max-iterations` silently falls back to 3 if you omit it.

```text
# launched as:
XIV_TIER=quality xiv stack build --feature payments --max-iterations 5 --detach
# resume as (identical, plus nothing):
XIV_TIER=quality xiv stack build --feature payments --max-iterations 5 --detach
```

If you can't tell how it was launched, ask the human rather than guessing a flag set.

## Forbidden (escalate to the human instead — never run these)

```text
xiv stack push      # opens real PRs — human decision
xiv stack amend     # changes code + needs a human-written message
git / gh / jj       # any direct VCS or GitHub action
anything that logs in, refreshes tokens, or edits files
```
