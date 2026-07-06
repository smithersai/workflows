---
name: review-path
description: Plan a human-friendly code review path for a change without finding bugs. Use when the user asks for a review order, guided review, file criticality, attention budget, or wants help understanding a PR/diff from unstaged work, staged work, a commit/range, or a GitHub PR number.
---

# review-path

Create a review path: the order a human should read changed files, plus how much attention each file deserves. Do **not** perform a bug-finding code review unless the user separately asks for one.

## Workflow

1. **Resolve the diff source.**
   - For worktree changes, inspect both staged and unstaged changes: `git diff --cached` and `git diff`.
   - For a commit or range, inspect the requested range with `git diff --name-status`, `git diff --stat`, and per-file diffs.
   - For a PR number, inspect the PR metadata and full diff with GitHub tooling such as `gh pr view <number>` and `gh pr diff <number>`.
   - If the source is ambiguous, choose the safest local default: current staged + unstaged changes.
2. **Inventory every changed file.** Include renamed, deleted, generated, lockfile, docs, and test files. Read surrounding source context when the diff alone does not reveal the file's role.
3. **Infer one dominant review angle.** Pick the sequence that makes the change easiest for an engineer to understand, then state it in one short sentence.
4. **Order files for comprehension.** Prefer a path that explains cause before effect: contracts before implementations, entrypoints before downstream flow, core logic before wrappers, or risk-heavy files before supporting changes.
5. **Assign criticality to each file.** Use exactly `low`, `med`, `high`, or `crit`.
6. **Return only the review path.** Do not list bugs, suspected issues, or line comments.

## Review Angles

Choose the best fit, or invent a short angle if the change needs it:

- **Data flow:** entrypoint -> validation/schema -> core logic -> persistence/side effects -> tests/docs.
- **Contract first:** API/schema/types/migrations -> producers -> consumers -> tests.
- **Core first:** domain logic/core functions -> adapters/wrappers -> UI/CLI/workflows -> tests.
- **Risk first:** security/auth/data-loss/concurrency/migration files -> dependents -> supporting cleanup.
- **Surface first:** user-facing view/command -> state/data hooks -> implementation details -> tests.
- **Mechanical last:** behavior files first, then renames, barrels, formatting, generated output, docs.

## Criticality

- **crit:** Read every line carefully. Core business logic, security/auth/permissions, money/billing, data writes or deletion, migrations, public contracts, workflow orchestration, concurrency, parsers, or the main file where the PR's behavior happens.
- **high:** Important behavior or integration code. Callers of critical logic, validation, error handling, state transitions, runtime config, cross-service boundaries, or tests that define the intended behavior of risky changes.
- **med:** Meaningful but bounded changes. Helpers, adapters, UI wiring, ordinary tests, docs that explain behavior, or localized changes with limited blast radius.
- **low:** Low-attention files. Import barrels, pure re-exports, formatting-only changes, generated files, lockfiles, snapshots, small docs copy, or obvious mechanical renames.

Escalate criticality when a small file has high leverage. Do not downgrade a file just because its diff is short if it controls behavior, data, permissions, or contracts.

## Output

Use this exact structure:

```markdown
**Review Angle**
<one short sentence explaining the chosen sequence.>

| # | File | Criticality | Why Here | Focus |
|---|---|---|---|---|
| 1 | `path/to/file` | crit | Starts the request flow. | Validate every branch and side effect. |
```

Keep `Why Here` and `Focus` to one short sentence each. Include every changed file exactly once. If there are many low-value mechanical files, keep them individual rows but place them near the end.

## Guardrails

- Stay read-only. Never commit, push, post PR comments, or submit reviews.
- Do not provide bug findings, approval advice, or merge recommendations.
- Do not turn this into a full architecture explanation. The output is a map for reading the diff.
- If a file cannot be inspected, include it with the best inferred criticality and say what blocked inspection in `Focus`.
