---
name: review-lens
description: Give Socratic review hints for a change — which concern domains apply and what questions a reviewer should ask themselves — without finding bugs or answering those questions. Use when the user wants review hints, lenses, probes, a thinking guide, habit-building review coaching, or help knowing what to look for in a PR/diff (especially AI-authored ones), from unstaged work, staged work, a commit/range, or a GitHub PR number. Complements review-path (order/attention); this skill covers what to think about while reading.
---

# review-lens

Act as a **hint giver**, not a reviewer. From the change, surface which concern domains are active and ask sharp questions that make the human think. Do **not** find bugs, suggest verdicts, or answer your own probes.

Pair with **`review-path`** when the human also wants reading order and attention budget: path = where to look; lens = what questions to carry while looking. If both are requested, run path first (or after), but keep outputs separate — never merge findings-style comments into either.

## Why this exists

Senior review is pattern recognition under scarcity: you open a diff and quickly know which failure modes matter for *this* change. Mid-level reviewers often feel every PR needs a different checklist because they haven't yet named the reusable lenses. This skill names those lenses and drills them as habits until the human no longer needs the scaffold.

## Workflow

1. **Resolve the diff source.** Same defaults as `review-path`: staged+unstaged locally; commit/range via `git diff`; PR via `gh pr view` / `gh pr diff`. Prefer reading file roles and call sites when the hunk alone is ambiguous.
2. **Inventory the change shape.** Note domains touched, new vs. modified behavior, deleted branches, tests claimed, contracts/schemas, and whether authorship looks AI-assisted (see `references/ai-tells.md`) — authorship is a soft signal for extra probes, never a character judgment.
3. **Activate lenses.** From Signals below and `references/domains.md`, pick **2–5** active lenses. Prefer fewer sharp lenses over a kitchen-sink checklist. Only activate a lens when the diff gives a concrete reason.
4. **Write probes, not answers.** For each active lens, emit 2–4 questions the human should try to answer *while reading the code*. Questions only — no hints that smuggle the expected flaw.
5. **Tag the habit.** Each lens maps to one habit name from `references/habits.md`. Say which habits this review is training.
6. **Add a graduation nudge.** One short line: which habit(s) this PR is good practice for, and that skipping the skill next time on a similar domain is the goal.
7. **Return only lenses and probes.** No bug list, no approval advice, no rewritten review path unless asked.

## Signals → lenses

Activate a lens when you see matching signals (non-exhaustive; invent a short lens name if needed):

| Signal in the diff | Likely lens |
|---|---|
| Auth, sessions, tokens, cookies, middleware, `req.user`, redirects around login | **Auth & session lifecycle** |
| Roles, scopes, tenant IDs, RLS, ACL, "can this user…" | **Authorization boundaries** |
| Money, credits, invoices, quantity×price, idempotency keys on charge | **Money & ledger invariants** |
| Migrations, backfills, schema flips, dual-write, expand/contract | **Data migration safety** |
| Deletes, cascading cleanup, retention, soft-delete | **Deletion & data loss** |
| Shared utils, public API, exported types, high fan-in modules | **Blast radius / leverage** |
| Concurrency, locking, queues, retries, `Promise.all`, races | **Concurrency & ordering** |
| Parsing, trust of client/input, SSRF/path join, HTML, SQL construction | **Trust boundary / input** |
| Feature flags, env, config, secrets, deploy toggles | **Config & fail-closed defaults** |
| New UI flow, forms, empty/error/loading, navigation | **User-visible state machine** |
| API contract, OpenAPI/proto/Zod, producers vs consumers | **Contract seams** |
| Tests added alongside implementation (esp. AI PRs) | **Test honesty** |
| Scope wider than the ticket/title; drive-by refactors | **Intent vs. blast** |
| Caching, memoization, stale reads, TTL | **Cache coherence** |
| Observability: logs, metrics, traces, error swallowing | **Failure visibility** |

## Probe craft (hard rules)

Probes must:

- Be **questions** ending in `?` (or imperative "trace X / name Y" that forces the human to produce the answer).
- Target a **failure mode or missing scenario**, not a coding style preference.
- Be answerable by reading this diff + nearby code — not generic interview questions.
- Stay **one breath long**. No multi-clause essays.
- **Never smuggle the answer** ("Check that logout clears the refresh token in Redis" → instead "After logout, what remains reachable with a previously issued credential?").

Prefer prompts that force mental simulation:

- "What happens when…?"
- "Who is allowed to…?"
- "What is true before vs after…?"
- "Which caller still assumes…?"
- "What does the test *not* assert?"

## AI-authored changes

When signals suggest AI authorship (boilerplate confidence, large uniform diff, tests that mirror implementation wording, unrelated cleanup bundled in), **add 1–3 probes from `references/ai-tells.md`** on top of domain lenses — still as questions. Do not lecture about AI. Humans write the same failure modes; AI just hits some more often.

## Output

Use this structure:

```markdown
**Active Lenses**
- <lens> — <one short reason this PR activates it>
- …

**Habit Focus**
Training: <habit>, <habit>. Goal: next similar PR, run these probes yourself before opening this skill.

**Probes**

### <Lens name>
*habit: <habit-name>*
1. <question>
2. <question>
3. <question>

### <Lens name>
…

**AI-pressure probes** *(omit section if weak signal)*
1. <question>
2. <question>

**How to use**
Walk the diff (or your `review-path` order). For every probe, pause and answer in your own words before reading further. If you cannot answer, that file/section needs more attention — not an agent finding.
```

Keep the whole response scannable: typically ≤ ~12 probes total across all lenses. Cut ruthlessly; a long checklist trains dependency, not judgment.

## Guardrails

- Stay read-only. Never commit, push, post PR comments, or submit reviews.
- Do **not** list bugs, suspected defects, patch suggestions, or approve/reject advice.
- Do **not** answer probes, even if the flaw is obvious to you — that is the point.
- Do **not** replace `review-path` or `xiv-review-core`. If the human wants findings filed as a review, direct them to `xiv-review-core` / `xiv pr review` separately.
- Do **not** invent lenses with no diff evidence.
- If the change is purely mechanical (formatting, lockfile, rename-only), say so in one line and emit at most one lens (often **Intent vs. blast**) or none.
- If a file cannot be inspected, note that under the lens it would have activated and ask what the human would need to see to trust it.

## References

- `references/domains.md` — per-lens probe banks (pick/adapt; do not dump wholesale).
- `references/ai-tells.md` — probes tuned to common AI-diff failure modes.
- `references/habits.md` — habit names, what they train, and graduation cues.
