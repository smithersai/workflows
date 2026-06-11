# xiv

Thin CLI for running the managed Smithers Linear/PR workflows from any repo.

```bash
bun install
bun link
xiv init
cd /path/to/target-repo
xiv implement ENG-123
xiv review --pr 1234
xiv ship ENG-123
```

`xiv` keeps Smithers runtime state in `SMITHERS_HOME` (default `~/.smithers`) and sets `SMITHERS_TARGET_CWD` to the repo where you invoked the command.
