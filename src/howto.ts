const GUIDE = `xiv — orchestrating a Linear feature to completion

WHAT THIS IS
You drive a whole Linear feature (a project, or a parent issue with sub-issues) to completion
as a STACK of branches — one reviewable branch per issue, each built on the one below it. The
Smithers workflows do the coding; you just sequence the commands below. Run EVERY command from
INSIDE the target git repo (not the xiv repo).

THE LOOP — how to know what to do next
  1. Run:   xiv stack triage --feature <slug> --json
  2. Read the "action" field. It is your next step:
       action=plan   -> not planned yet            -> run: xiv stack plan ...
       action=build  -> entries need building       -> run: xiv stack build ...
                        (a crashed run also shows build — just re-run build; it resumes)
       action=push   -> built entries ready to ship  -> run: xiv stack push ...
                        (also shown when re-flowed PRs need re-syncing)
       action=wait   -> all published; nothing to do until humans review/merge
       action=done   -> every entry merged; the feature is complete
  3. Run the matching command, then go back to step 1.

COMMANDS (run orchestration commands from your "home" repo; init/build operate per repo)
  xiv stack init                                       one-time per repo: colocate jj
  xiv stack plan <project|ENG-400> --feature <slug>    build the ordered stack map from Linear
       [--repo key=path]...                            multi-repo: assign issues across repos (repeatable)
  xiv stack status  --feature <slug>                   human-readable map (grouped by repo)
  xiv stack triage  --feature <slug> [--json]          what-to-do-next oracle (start here)
  xiv stack build   --feature <slug> [--all-repos|--repo <key>] [--detach]   build entries locally; resumable
  xiv stack preview --feature <slug>                   checkout every repo at its tip = preview the feature
  xiv stack push    --feature <slug> --count <N> [--all-repos|--repo <key>]  open lowest N as stacked PRs
  xiv stack amend   --feature <slug> -m "<change>" [--target <issue|branch>]
                                                       change one entry; jj re-flows it up its repo's stack

MULTI-REPO (microservices)
  A feature can span repos. \`plan\` assigns each issue a repo (one --repo key=path per repo;
  omit for single-repo = current dir). Each repo gets its own independent substack — stacking
  is WITHIN a repo only. \`build --all-repos\` fans out one pinned run per repo, in parallel
  (run init in each repo first). \`preview\` checks out every repo at its tip so all services
  are feature-complete together for local testing. Cross-repo contract breaks are NOT
  auto-propagated — they surface at integration test time / to a human.

  For interactive planning (assign obvious issues, confirm the unclear ones, exclude non-code
  work like "set GCP secrets"), use the \`stack-plan\` skill — it writes a resolved plan and
  persists it via \`xiv stack plan --plan <file>\`. Excluded issues are recorded and shown in
  \`xiv stack status\`, never built.

PREREQUISITES
  - jj installed (brew install jj) and colocated here (xiv stack init).
  - gh authenticated (for push). The claude + codex CLIs logged in, with Linear MCP configured.
  - The repo is a git repo on its base branch (default main; pass --base to plan otherwise).

ONE ISSUE (no stack needed)
  xiv implement <ENG-123>     build it on a branch, local
  xiv ship <ENG-123>          build it + open a PR + drive AI review to approval
  xiv review --pr <N>         attach to an existing PR and drive review

IF SOMETHING GOES WRONG
  A failing run is usually transient: re-run "xiv stack build" (it skips finished entries) or
  "smithers supervise". For the full failure -> action playbook (auth, conflicts, rate limits),
  use the xiv-operator skill. STOP and ask a human for: auth errors, jj conflicts you cannot
  resolve, or anything you do not recognize.

HARD RULES
  - Never merge PRs. Do not run "xiv stack push"/"amend" or git/gh/jj unless that is your job.
  - Edit code only through "xiv stack amend". Read code however you like (git/IDE) — it is a
    normal git repo underneath.
  - "push" opens REAL PRs on GitHub — only when the human wants that batch published.
`;

/** The orchestration runbook printed by \`xiv how-to\` and pointed to by the xiv-operator skill. */
export function howToGuide(): string {
  return GUIDE;
}
