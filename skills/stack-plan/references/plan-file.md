# Plan file schema

Write this JSON to a temp path, then run:

```bash
xiv stack plan --feature <slug> --repo <key>=<path> [--repo <key>=<path> ...] --plan <file>
```

`xiv stack plan --plan` persists it **deterministically** (no agent re-guessing). The `--repo`
flags you pass MUST cover every `repo` key used in `order`.

## Shape

```json
{
  "order": [
    { "issueId": "ENG-401", "title": "ledger schema",  "repo": "ledger" },
    { "issueId": "ENG-402", "title": "api endpoint",   "repo": "api" },
    { "issueId": "ENG-403", "title": "ledger posting", "repo": "ledger" },
    { "issueId": "ENG-404", "title": "web form",       "repo": "web" }
  ],
  "excluded": [
    { "issueId": "ENG-410", "reason": "infra/manual: set GCP secrets" },
    { "issueId": "ENG-411", "reason": "docs: update the runbook" }
  ],
  "source": { "linearProjectId": "PROJ-42" }
}
```

## Rules

- **`order`** is the global build sequence, bottom → top (index 0 is built first). Each item is
  assigned a `repo` (a key you pass via `--repo`). Branch names are derived by the CLI — do not set
  them. Within a repo, each issue stacks on the previous issue *of that same repo*; the CLI computes
  the base, so interleaved repos are fine (e.g. ENG-403 above stacks on ENG-401, not ENG-402).
- **`excluded`** lists issues that are part of the feature but intentionally not built, each with a
  `reason`. They are recorded in the stack map and shown in `xiv stack status`, never built.
- **`source`** is one of `linearProjectId` or `parentIssueId` (for provenance).
- Every issue from the Linear source must appear in exactly one of `order` or `excluded`.
- `title` is optional but helpful (it shows in `xiv stack status` and PR titles).
