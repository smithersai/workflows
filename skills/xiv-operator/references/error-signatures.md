# Error signatures

Substring/keyword matches that identify a failure category. Search the text of
`smithers why <runId> --json`, `smithers events <runId> --json`, `xiv logs`, and the
`activeRuns` field of triage. Matching is case-insensitive. Pick the first category that hits.

## auth → ESCALATE (never retry)

```
401            403            unauthorized
authentication  "invalid api key"   "token expired"   "expired credentials"
"not logged in"   "please log in"   "gh auth"   OAuth   "refresh token"
```
Likely fix for the human (pick by which tool failed):
- Claude/Anthropic agent → re-login the `claude` CLI (or set `ANTHROPIC_API_KEY`).
- Codex/OpenAI agent → re-login the `codex` CLI (or set `OPENAI_API_KEY`).
- GitHub (`gh`) → `gh auth login`.
- Linear MCP → the Linear MCP connection needs re-auth in the agent harness.

## rate-limit → RESUME after wait (max 3)

```
429   rate_limit   "rate limit"   overloaded   "over capacity"   "try again later"   "529"
```

## quota-hard → ESCALATE

```
insufficient_quota   "quota exceeded"   "billing"   "payment required"   "402"
```

## crash / stale → RESUME

```
heartbeat   "no heartbeat"   "process exited"   "process spawn failed"   killed
SIGKILL   SIGTERM   ECONNRESET   "worker died"   stale
```

## jj-conflict → ESCALATE

```
conflictsRemaining   conflict   "unresolved"   "rebase"   "merge conflict"
```

## network / disk → ESCALATE

```
ENOTFOUND   ETIMEDOUT   "Could not resolve host"   ENETUNREACH   ENOSPC   "no space left"
```

## waiting-on-human → ESCALATE (relay, don't answer)

```
waiting-approval   waiting-event   "needs approval"   "human input required"
```

Anything that matches **none** of these → treat as **unknown** → ESCALATE.
