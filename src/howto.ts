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

COMMANDS (always run inside the target repo)
  xiv stack init                                       one-time per repo: colocate jj
  xiv stack plan <project|ENG-400> --feature <slug>    build the ordered stack map from Linear
  xiv stack status  --feature <slug>                   human-readable map (positions, PRs)
  xiv stack triage  --feature <slug> [--json]          what-to-do-next oracle (start here)
  xiv stack build   --feature <slug> [--detach]        build all unbuilt entries locally; resumable
  xiv stack preview --feature <slug>                   checkout the tip = preview the whole feature
  xiv stack push    --feature <slug> --count <N>       open lowest N as stacked PRs (+ re-sync re-flowed)
  xiv stack amend   --feature <slug> -m "<change>" [--target <issue|branch>]
                                                       change one entry; jj re-flows it up the stack

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
