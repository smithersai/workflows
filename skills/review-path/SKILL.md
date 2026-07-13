---
name: review-path
description: Plan a human-friendly code review path for a change without finding bugs. Use when the user asks for a review order, guided review, file criticality, attention budget, blast-radius-based prioritization, or wants help understanding a PR/diff from unstaged work, staged work, a commit/range, or a GitHub PR number. For Socratic "what should I look for" hints and habit-building probes, use review-lens instead or alongside.
---

# review-path

Create a review path: the order a human should read changed files, how those files group, and how much attention each deserves. Do **not** perform a bug-finding code review unless the user separately asks for one.

**Companion:** for *what questions to ask while reading* (Socratic probes by concern domain, habit-building, especially on AI-authored diffs), use **`review-lens`**. Path = where/how much to look; lens = what to think about. Keep the outputs separate.

## Workflow

1. **Resolve the diff source.**
   - For worktree changes, inspect both staged and unstaged changes: `git diff --cached` and `git diff`.
   - For a commit or range, inspect the requested range with `git diff --name-status`, `git diff --stat`, and per-file diffs.
   - For a PR number, inspect the PR metadata and full diff with GitHub tooling such as `gh pr view <number>` and `gh pr diff <number>`.
   - If the source is ambiguous, choose the safest local default: current staged + unstaged changes.
2. **Inventory every changed file.** Include renamed, deleted, generated, lockfile, docs, and test files. Read surrounding source context when the diff alone does not reveal the file's role.
3. **Infer one dominant review angle.** Pick the sequence that makes the change easiest for an engineer to understand, then state it in one short sentence.
4. **Cluster related files.** For anything beyond a handful of files, group them by subsystem or concern before ordering.
5. **Order for comprehension.** Explain cause before effect, keep coupled files adjacent, and let the reviewer trace one shape through the change rather than hop around.
6. **Assign criticality** to each file from the Signals below, using exactly `low`, `med`, `high`, or `crit`.
7. **Set the attention budget.** Say where the bulk of attention goes and what can be skimmed.
8. **Return only the review path.** Do not list bugs, suspected issues, or line comments.

## Review Angles

Choose the best fit, or invent a short angle if the change needs it:

- **Data flow:** entrypoint -> validation/schema -> core logic -> persistence/side effects -> tests/docs.
- **Contract first:** API/schema/types/migrations -> producers -> consumers -> tests.
- **Core first:** domain logic/core functions -> adapters/wrappers -> UI/CLI/workflows -> tests.
- **Risk first:** security/auth/data-loss/concurrency/migration files -> dependents -> supporting cleanup.
- **Surface first:** user-facing view/command -> state/data hooks -> implementation details -> tests.
- **Mechanical last:** behavior files first, then renames, barrels, formatting, generated output, docs.

## Signals

Criticality and order come from signals, not diff size. Weigh these:

**Raise attention (toward `high`/`crit`):**
- **Blast radius / leverage** — high fan-in (many importers), exported or public contracts, shared utilities, base types. A one-line change to a widely-used module outranks a large isolated one.
- **Risk domain** — auth/permissions, money/billing, data writes or deletion, migrations, concurrency/async ordering, parsing or trusting external input.
- **Change shape** — deletions and removed branches, new dependencies, config/env/secret changes, and any file whose diff is broader than the change's stated scope.
- **Contract/data seams** — where a changed shape, type, or schema meets its consumers.
- **Uncertainty** — a file whose role you could not determine. Do not hide it; flag it as needing a human's eyes in `Focus`.

**Lower attention (toward `low`):**
- Pure formatting, generated output, lockfiles, snapshots.
- Re-exports/barrels, mechanical renames, isolated leaf files with existing pre-change test coverage (tests written in the same diff do not count — they may assert the new behavior rather than the intended one).

## Grouping, Order, and Tracing

For diffs beyond a few files, cluster before ordering:

- **Cluster by subsystem or concern** (e.g. contract, data layer, UI, tests, mechanical). Order the clusters by the review angle, then order files within each.
- **Give each cluster one sentence** of context so the reviewer knows what they are about to read and why it comes here.
- **Keep coupled files adjacent** — a contract next to its consumer, an implementation next to the test that pins its behavior — so the reviewer never loses the thread.
- **Trace, don't hop** — for contract/data-flow angles, tell the reviewer to carry the changed shape in mind from its definition through each consumer, in that order.

## Attention Budget

Attention is scarce; spend it deliberately. A reviewer told "everything matters" reads nothing carefully. Beyond per-file criticality, name where the bulk of attention goes — the `crit`/`high` files and the seams between them — and say explicitly what can be skimmed or skipped.

## Criticality

- **crit:** Read every line carefully. Core business logic, security/auth/permissions, money/billing, data writes or deletion, migrations, public contracts, workflow orchestration, concurrency, parsers, or the main file where the PR's behavior happens.
- **high:** Important behavior or integration code. Callers of critical logic, validation, error handling, state transitions, runtime config, cross-service boundaries, or tests that define the intended behavior of risky changes.
- **med:** Meaningful but bounded changes. Helpers, adapters, UI wiring, ordinary tests, docs that explain behavior, or localized changes with limited blast radius.
- **low:** Low-attention files. Import barrels, pure re-exports, formatting-only changes, generated files, lockfiles, snapshots, small docs copy, or obvious mechanical renames.

Escalate criticality when a small file has high leverage. Do not downgrade a file just because its diff is short if it controls behavior, data, permissions, or contracts.

## Output

Use this structure:

```markdown
**Review Angle**
<one short sentence explaining the chosen sequence.>

**Attention Budget**
<one line: where most attention goes, and what to skim or skip.>

**<Cluster name>** — <one sentence on what this group is and why it comes here.>

| # | File | Criticality | Why Here | Focus |
|---|---|---|---|---|
| 1 | `path/to/file` | crit | Starts the request flow. | Validate every branch and side effect. |
```

Repeat the cluster heading and table for each group. For small diffs (a handful of files), drop the cluster headings and use a single table. Keep `Why Here` and `Focus` to one short sentence each. Include every changed file exactly once, and place mechanical/low files together near the end.

## Guardrails

- Stay read-only. Never commit, push, post PR comments, or submit reviews.
- Do not provide bug findings, approval advice, or merge recommendations.
- Do not turn this into a full architecture explanation. The output is a map for reading the diff.
- If a file cannot be inspected, include it with the best inferred criticality and say what blocked inspection in `Focus`.
