# Failure playbook

Match the most specific row. Each maps to exactly one action: **WAIT**, **RESUME**, **NOTE**,
or **ESCALATE**. When two rows could apply, prefer ESCALATE.

## How to read the situation

1. `xiv stack triage --feature <slug> --json` → `action`, `phase`, `inFlight`, `staleBranches`, `activeRuns`.
2. If a run looks failed/stuck, get detail: find the run id in `activeRuns`, then
   `smithers why <runId> --json` and `smithers events <runId> --json --type run`.
3. Match the error text against `error-signatures.md` to get a category, then use the table.

## The table

| Category | How you recognize it | Action | Exactly what to do |
|---|---|---|---|
| **Healthy / progressing** | a run is `running`; `inFlight` or `counts` advanced since last poll | **WAIT** | sleep 5–10 min, re-poll. |
| **Crash / exited** | `action: build` but no `running` run in `activeRuns`; or status `failed` with a crash/heartbeat signature | **RESUME** | `xiv stack build --feature <slug> --detach`. Confirm a run appears in `xiv ps`. Count this attempt. |
| **Stale run** | run shows but Smithers flags it stale / no heartbeat | **RESUME** | `smithers supervise` (it resumes stale runs), or resume the build. |
| **Rate limit / overloaded** | error matches `429`, `rate_limit`, `overloaded`, `capacity` | **RESUME after wait** | wait ~5 min, then resume the build. Max 3 attempts, then ESCALATE. |
| **Quota exhausted (hard)** | `insufficient_quota`, "quota exceeded", billing | **ESCALATE** | a human must top up; retrying won't help. |
| **Auth expired** | `401`/`403`, "authentication", "unauthorized", "not logged in", "token expired", "gh auth" | **ESCALATE** | report the exact re-auth command (`claude` login, `codex` login, or `gh auth login`). NEVER retry — it will just fail again. |
| **jj conflict** | triage/amend output has `conflictsRemaining: true`, "conflict", "unresolved" | **ESCALATE** | a human resolves it. Name the affected entry + the tip branch. |
| **Stuck / no progress** | `inFlight` unchanged across **two** polls and no error | **ESCALATE** | report the stuck entry id and the last events. |
| **Tests failing on a built entry** | entry is `implemented` but its validation was red | **NOTE** | do NOT block on it (build is "best last attempt"). Record it for the human's review; keep going. |
| **Waiting on a human/approval** | run status `waiting-approval` / `waiting-event`; `smithers why` says so | **ESCALATE** | relay the question verbatim; the human answers. Do not answer for them. |
| **Disk / network** | `ENOSPC`, `ENOTFOUND`, `ETIMEDOUT`, "Could not resolve host" | **ESCALATE** | environment problem; a human fixes the machine/network. |
| **Unknown** | anything not matched above | **ESCALATE** | dump the raw `smithers why` / events and ask. |

## Resume budget

Track resume attempts per run in your head. After **3** resumes of the same run with the same
failure, stop resuming and ESCALATE — the failure is not transient.

## What "done for now" looks like

`action: push`, `action: wait`, or `action: done` means there's nothing for *you* to do:
the build is finished or everything is published. Report the status and hand back — opening
PRs (`push`) and code changes (`amend`) are the human's calls, not yours.
