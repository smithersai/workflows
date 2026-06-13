# Escalation report

When you STOP and hand back to the human, post one message in this shape. Be factual and
concrete. Never speculate beyond what the signals show.

```
🚧 xiv stack "<slug>" needs you.

What happened: <one sentence — the category, e.g. "the Claude agent's auth expired" or
                "ENG-407's restack has an unresolved conflict">
Where:         entry <ISSUE-KEY> (<branch>) / run <runId> / phase <phase>
Evidence:      <the key line(s) from `smithers why` or events — quote the actual error>
Progress so far: <counts, e.g. "11/22 built, 5 merged, 0 stale">
Resumes tried: <N> (capped at 3)

Suggested fix:
  <exact command or step the human should take — e.g. `gh auth login`, or
   "resolve the conflict in feat/eng-407, then run `xiv stack amend` again">

I have stopped and will not touch the run until you tell me to continue.
```

## Notes

- For **auth**: include the exact re-login command from `error-signatures.md`. Do not retry.
- For **conflicts**: name the entry and the tip branch, and tell them they can preview with
  `xiv stack preview --feature <slug>`.
- For **tests-failing-but-built** entries (a NOTE, not a stop): you don't have to halt — just
  list them at the end of your status updates so the human reviews those PRs more carefully.
- If you escalated only because the signal was **unknown**, say so plainly and paste the raw
  `smithers why <runId> --json` output so the human can decide.
