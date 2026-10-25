---
description: Completion gate — prove the work is actually done before saying so
---
Run the `before-done` skill against the current change. Do not report the task
complete until every check below has actually run and you have pasted its real
output.

1. `rtk git status` — confirm what changed, and that nothing unintended did.
2. Call the `verify` tool; paste its `ran:`/`skipped:`/`verdict:` table. It
   runs the canonical verification command (and any Node typecheck/lint
   scripts) itself and records the result — it covers what used to be
   separate format/test/lint steps here. (A human can also run this
   directly as `/verify` outside this flow; use the tool here since this
   prompt's own turn can't invoke another slash command.)
3. If a PR exists, check CI status and open review threads.

Then report, in this format:

```
ran:      <command>  -> <pass/fail, key output line>
ran:      <command>  -> <pass/fail, key output line>
skipped:  <command>  -> <why>
verdict:  DONE | NOT DONE
```

A check you did not run is `skipped`, never `pass`. If anything failed, the
verdict is `NOT DONE` — fix it and rerun rather than reporting the failure as
finished work.
