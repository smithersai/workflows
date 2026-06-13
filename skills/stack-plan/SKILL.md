---
name: stack-plan
description: Plan a stacked-PR feature across one or more repos before building it. Fetch the Linear issues for a project or parent issue, order them into per-repo substacks, auto-assign the obvious ones to a repo, and CONFIRM the unclear and non-code ones with the human (recommending exclusion for things like "set GCP secrets"). Then write a resolved plan and persist it with `xiv stack plan --plan`. Use when starting an `xiv stack` feature — especially multi-repo (microservices) — so issue→repo assignment is correct and nothing non-buildable sneaks into the stack.
metadata:
  internal: false
---

# stack-plan

You plan a stacked-PR feature for the human, then hand a **resolved plan** to `xiv stack plan`.
You are interactive: assign what's obvious yourself, but **never silently guess** on the unclear
or the non-code — surface those and let the human decide.

The human gives you: a **Linear source** (a project, or a parent issue with sub-issues) and the
**repos** the feature may span as `key=path` (one for single-repo). A short feature **slug** too.

## Steps

1. **Learn the repos.** For each repo path, read its README / `package.json` / `Cargo.toml` so you
   know what each service is (e.g. `api` = payments REST, `ledger` = Rust ledger). One line each.
2. **Fetch the issues.** Use Linear MCP (`get_project` / `get_issue` / `list_issues` /
   `list_comments`) to list every issue in the source, with title, description, labels.
3. **Classify each issue** into one of three buckets (see `references/classification.md`):
   - **confident** — repo is clear (label, project/sub-team, service in the title) → assign it.
   - **ambiguous** — clearly code, clearly one repo, but unclear which → needs the human.
   - **not-repo-specific** — not a code change in any repo ("set GCP secrets", "update the
     runbook", "notify customers") → recommend **EXCLUDE**; the human confirms or assigns.
4. **Order the issues** into a build sequence (foundations first; respect dependencies). Order is
   global; each repo's substack is just its issues in that order.
5. **Show ONE table and ask once.** Present every issue with its proposed repo + order in a single
   compact table: confident rows marked `✓`, ambiguous/non-code rows flagged with a recommendation.
   Ask the human to correct the flagged rows in one reply — do not prompt per issue.

   ```
   #   issue    proposed        why
   0   ENG-401  ledger ✓        labeled svc:ledger
   1   ENG-402  api ✓           "POST /payments" in title
   2   ENG-403  api | web  ?    touches auth — which service?        <- needs you
   -   ENG-410  EXCLUDE  ?      "set GCP secrets" — not buildable     <- confirm/assign
   ```
6. **Resolve.** Apply the human's corrections. Default non-code issues to `excluded` (with a
   reason). Keep excluded issues out of `order` but record them under `excluded`.
7. **Write the plan file** (schema in `references/plan-file.md`) to a temp path, then persist:
   ```bash
   xiv stack plan --feature <slug> --repo <key>=<path> [--repo ...] --plan <file>
   ```
8. **Hand off.** Tell the human the map is written and the next step is
   `xiv stack init` in each repo (if not done) then `xiv stack build --all-repos --feature <slug>`.

## Guardrails

- **Read-only on code.** Your only writes are the plan file and running `xiv stack plan --plan`.
  Do not edit repos, create branches, or run other `xiv stack` commands.
- **Never silently assign a non-code issue to a repo.** Always surface it with an EXCLUDE
  recommendation; the human decides.
- Every issue in the source must end up either in `order` (assigned a repo) or in `excluded`.
- If you can't read a repo or fetch the issues, stop and tell the human what's missing.

## References

- `references/classification.md` — how to bucket each issue, with examples.
- `references/plan-file.md` — the exact JSON schema you write for `--plan`.
