# Domain probe banks

Use these as raw material. **Never dump a full bank into the response.** Pick 2–4 probes that fit *this* diff; rewrite them so they name concrete symbols, flows, or files from the change when that makes the question sharper.

## Auth & session lifecycle

- What credentials or session artifacts does this change create, refresh, or destroy?
- After a successful logout (or expiry), what can still be done with an old token, cookie, or tab?
- What happens to in-flight requests that started authenticated and finish after the session ends?
- If auth fails midway through a multi-step flow, which step's side effects have already landed?
- Where does "logged in" get decided vs. where the UI *assumes* it?

## Authorization boundaries

- For the new or changed action, who is *denied*, and where is that enforced — edge, service, or data layer?
- Does any ID in the request (user, org, resource) get trusted without proving ownership?
- If role/permission checks moved or were "simplified," which caller paths skip them now?
- Cross-tenant: what stops tenant A's credential from operating on tenant B's resource ID?

## Money & ledger invariants

- What is the invariant (balance, uniqueness, "charge once") and which line of code upholds it under retries?
- If the same request arrives twice, what double-effect becomes possible?
- Rounding, currency, tax: which arithmetic path is newly authoritative?
- Failure after a successful charge but before recording success — what reconciles?

## Data migration safety

- Expand/contract: can old and new code run concurrently against this schema version?
- What happens to rows that don't match the migration's assumed shape (nulls, duplicates, legacy)?
- Is backfill online or locking — and who feels the lock?
- Rollback: if this deploy reverts, is the data still readable by the old binary?

## Deletion & data loss

- Soft vs hard delete — which dependents still need the row, and for how long?
- Cascades: what else disappears when this disappears, intentionally or not?
- Can a user undo; if not, is that obvious at the call site?
- Orphaned artifacts (files, credentials, webhooks) left behind after the primary delete?

## Blast radius / leverage

- Who imports this module/type, and did the change alter a shared contract or only a leaf?
- If this helper's return meaning shifted, which distant caller silently changes behavior?
- Defaults: did a default argument / config / flag flip for *everyone* or only the new path?

## Concurrency & ordering

- Two of these operations at once — which shared state do they contend on?
- Retries: is the operation idempotent, or does retry create duplicates?
- Time ordering: which event must happen before which, and what enforces that?
- Partial failure inside `Promise.all` / batch — what is committed vs. abandoned?

## Trust boundary / input

- Which inputs are attacker-controlled, and where are they first validated?
- Concatenation into SQL, shell, HTML, paths, or URLs — what sanitizes or parameterizes?
- Error messages / logs: do they echo secrets or raw untrusted payloads back out?

## Config & fail-closed defaults

- If the new env var / flag is missing in prod, does the system fail closed or open?
- Which environments need the value, and what is the unsafe default if someone forgets?
- Feature flag off mid-flight — do both code paths remain safe?

## User-visible state machine

- Empty, loading, error, success — which states are newly reachable, and how does the UI exit them?
- Navigation: refresh, back button, deep link — does the new state survive?
- Double-submit / double-click — what happens on the second attempt?

## Contract seams

- Who produces the new shape, and who consumes it — are both in this PR?
- Serialization: optional vs required, null vs absent, renamed fields — which consumer breaks first?
- Versioning: how do old clients talk to new servers (or the reverse)?

## Test honesty

- What scenario would still pass these tests while breaking production behavior?
- Do the tests assert outcomes and invariants, or only that mocks were called as the implementation does today?
- Which failure mode from the active domain lenses has **no** test that would catch it?

## Intent vs. blast

- Holding the PR description as the contract: which hunk is unexplained by that intent?
- If you reverted the drive-by files, would the stated feature still work?
- Are renames/refactors mixed with behavior changes in a way that hides the risky delta?

## Cache coherence

- After a write path this PR touches, what cached read can stay stale — and for how long?
- Invalidation key: too coarse (evicts everyone) or too fine (misses a sibling key)?
- Cold start / empty cache: does the code assume warm state?

## Failure visibility

- When this new path fails, what does an on-call see — log, metric, silent catch?
- Are errors swallowed and replaced with a success-shaped return?
- Which branch is untested *and* unlogged?
