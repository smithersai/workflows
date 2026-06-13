# Classifying issues into repos

Put every issue into exactly one bucket. When two buckets could apply, prefer the one that asks
the human (ambiguous/non-repo) over guessing.

## confident → assign automatically

Strong, unambiguous signal for one repo:
- A repo/service label: `svc:ledger`, `team:payments-api`, `area:web`.
- The Linear project or sub-team maps 1:1 to a repo.
- The title/description names a service or a path that lives in exactly one repo
  (e.g. "POST /payments endpoint" → the api repo; "Rust posting engine" → the ledger repo).
- Only one repo is registered (single-repo feature) — everything is confident.

## ambiguous → ask the human

Clearly a code change, clearly one repo, but the signal is split or weak:
- A capability several repos share ("refactor the auth flow" when both `api` and `web` have auth).
- No label and the description doesn't name a service.
- Conflicting signals (label says one thing, title another).

Present the top 1–2 candidate repos and why; let the human pick.

## not-repo-specific → recommend EXCLUDE

Not a code change in any registered repo. Common shapes:
- Infra / ops: "set GCP secrets", "create the Pub/Sub topic", "scale the cluster".
- Manual / process: "notify customers", "schedule the migration window", "get legal sign-off".
- Docs / external: "update the runbook", "write the launch post" (unless docs live in a repo here).
- Config in a system xiv can't build (dashboards, feature flags, IAM).

Default recommendation: **EXCLUDE** with a one-line reason. The human may instead assign it to a
repo if that work really is code there (e.g. infra-as-code lives in an `infra` repo you registered).

## Tie-breakers

- Prefer the **lowest/most-foundational** repo when a change spans layers but originates in one.
- If an issue is really two changes in two repos, flag it to the human — it may need splitting in
  Linear first. Don't invent a second issue.
