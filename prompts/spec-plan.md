---
description: Scaffold (if needed) a pilot dir, then draft a disambiguated spec plus ticket decomposition from a rough idea
argument-hint: "<rough-input-path> [pilot-dir, default: current directory]"
---

Start (or continue) a `ticket_runner.py` pilot from a rough idea. `$2`
is the pilot dir (default: current directory); `$1` is the rough input
-- a few paragraphs, a bullet list, or freeform prose. It does not need
to be precise. Your job is to make it precise, and to make every place
you had to guess visible rather than silently baked into downstream
tickets.

**Resolve `$2` to a concrete path before running anything below:** if
`$2` was not given, set it to `$(pwd)` -- do not let it stay empty and
flow into the commands below as-is, which would target `/spec/tickets`,
`/spec/acceptance`, and `/workspace` at the filesystem root instead of
the current directory.

## 0. Scaffold the pilot dir, if it isn't one yet

**Before writing anything, check `$2` in this order and pick exactly one
branch -- do not proceed past this check on a guess:**

- **`$2/Makefile` already exists** -> skip this whole step. The pilot
  dir is already scaffolded (from a prior run of this command, or by
  hand); re-running the commands below would truncate an
  already-reviewed `spec/spec.md`'s sibling files. Go straight to
  section 1.
- **`$2` does not exist, or exists and is completely empty** -> safe.
  Run the commands below.
- **`$2` exists, is non-empty, and has no `Makefile`** -> **stop and do
  not run anything below.** Report exactly this and end the turn: "`$2`
  already exists, is non-empty, and has no `Makefile` -- refusing to
  scaffold into it. Point `$2` at an empty or new path, or confirm by
  hand that overwriting it is intended."

Nothing in the "safe" branch below is a judgment call: run every command
exactly as written, do not retype or reformat any of it, and report each
command's real output -- do not report a step done without having
actually run it.

```
mkdir -p "$2/spec/tickets" "$2/spec/acceptance" "$2/workspace"
```

```
cd "$2" && git init
```

This is the **pilot dir's own** git repo. Do not run `git init` or
commit anything inside `$2/workspace/` -- `build_app.py` creates that
repo separately on the first build round. The `.gitignore` written next
keeps the pilot dir's repo from tracking `workspace/`'s contents, plus
`/logs/` (this pipeline's own `/spec-plan`/`/contract-plan` transcripts,
root-scoped like `/data/` below -- goal_pilot.py's `logs_dir()` always
resolves to `pilot_dir / "logs"`, never nested)
and `/data/` (`factoryd`'s own default `-data-dir` output: durable run
records, isolation markers, project-check reports) -- neither is
tracked by anything else in this scaffold, and both are bulky,
run-specific evidence that has landed in a real project's git history
before a human happened to notice and hand-fix it (calculator-app
commit `00e27bb`, "stop tracking factoryd's own -data-dir output") --
fixed here so every new pilot dir starts right instead of relying on
that same manual catch each time.

Run this exact command as a single `bash` call, copied verbatim,
including the closing `EOF` line:

```
cat > "$2/.gitignore" <<'EOF'
workspace/
.ticket_runner.lock
/logs/
/data/
EOF
```

Run this exact command as a single `bash` call, copied verbatim,
including the closing `EOF` line. The lines starting `$(RUNNER)` and
`@ls` each begin with one literal tab character inside this heredoc --
do not replace it with spaces, Make requires a literal tab there.

```
cat > "$2/Makefile" <<'EOF'
# Human entry point for the zero-human pipeline pilot. This Makefile
# belongs to the control dir (spec/, reports/) -- it is distinct from
# workspace/Makefile, which the agent owns and which holds verify /
# verify-full. See plans/zero-human-fullstack-pipeline-plan-2026-08-20.md
# Phase 2.

RUNNER := python3 $(HOME)/code/agent-configs/pi/scripts/ticket_runner.py

.PHONY: run status reports

# Start or resume the build -- same command either way. ticket_runner.py
# derives its position from the workspace's git log (first ticket with no
# `ticket(NNN):` commit), so there is no separate resume mode to remember.
run:
	$(RUNNER) --pilot-dir $(CURDIR)

# Read-only: current position, tickets remaining, last gate outcome.
status:
	$(RUNNER) --pilot-dir $(CURDIR) --status

# List archived per-ticket evidence (BUILD_REPORT.md + gate log), latest first.
reports:
	@ls -t reports 2>/dev/null | sed 's/^/reports\//' || echo "(no reports yet)"
EOF
```

```
cd "$2" && git add .gitignore Makefile && git commit -m "chore: scaffold pilot dir"
```

Confirm `$2/workspace/` exists, is empty, and has no `.git` yet -- if it
does, something above ran in the wrong place; stop and say so rather
than proceeding.

## 1. `spec/spec.md`

This is the one step in this pipeline explicitly allowed to resolve
ambiguity rather than refuse to guess -- but every guess must be written
down as its own reviewable line, never absorbed silently into a ticket's
"Required changes" list where a human would have to reverse-engineer it
later. If you can't tell whether a real ambiguity exists or you're just
being cautious, resolve it and write down why; a resolved-and-flagged
assumption is useful, an unresolved question is not.

Write the detailed spec, in this order:

- **Scope**: what the app does, restated precisely enough that two
  different engineers would build the same thing from it.
- **Assumptions & Interpretations**: one bullet per place the input was
  vague, stating the interpretation you chose and why. This section is
  the actual deliverable of this step -- a human reviews this list line
  by line before anything here counts as frozen. Do not skip a genuine
  ambiguity because resolving it was easy; if you had to decide instead
  of transcribe, it goes here.
- **Non-goals**: anything intentionally out of scope, stated explicitly
  rather than left to be inferred from silence.
- **Open questions for the contract step**: do not invent API-contract
  detail here -- exact endpoint shapes, JSON field names/casing, status
  codes. If the input implies an API surface, name what needs deciding
  and leave the deciding to the contract-writing step (still cloud/human
  -- not this template, and not automated anywhere yet). Guessing at
  contract detail here duplicates work that step already owns and risks
  disagreeing with it.

Put a status line at the very top of the file:
`STATUS: DRAFT -- pending human review of Assumptions & Interpretations`.

## 2. `spec/tickets/NNN-<slug>.md`

Decompose `spec/spec.md` into ordered tickets, tracer-bullet style:
walking skeleton first (schema -> domain -> one endpoint -> one screen
wired end to end), then breadth. Sized to a single feature (the proven
envelope is a ~75-minute unit; if a ticket looks bigger than that, split
it). Do not reference acceptance-test file names -- none exist yet; that
stays the contract/test-generation step's job, same as it always has
been in this pipeline.

**Every ticket file must contain all five of these sections, in this
order** -- `ticket_runner.py`'s own gate deterministically rejects any
ticket missing one:

1. **Context line** (every ticket after 001): "This is an existing repo.
   Read `ARCHITECTURE.md`, `PROGRESS.md`, and `spec/contract.md` before
   changing anything, and preserve all existing functionality and
   passing tests -- this is an extension, not a rewrite."
2. **`## Goal`** -- one paragraph.
3. **`## Required changes`** -- a numbered list, files in scope, ending
   with the line: "Update `ARCHITECTURE.md` and append a `PROGRESS.md`
   entry before finishing." (verbatim -- this is the state-file update
   the gate checks for).
4. **`## Verification`.** Two parts, in this order, both required:
   - The prose `ticket_runner.py`'s own gate doesn't check but every
     ticket has always carried: "`make verify` must pass" and "Confirm
     `make verify-full` still passes."
   - Immediately after that prose, on their own lines, the same
     information restated as three machine-parseable keys —
     `software-factory`'s `internal/ticketspec` parses these, and this
     is what lets the *same* ticket file drive a `software-factory`
     `factoryd` run directly instead of only this pipeline's own
     `ticket_runner.py` loop (see `software-factory/
     lights-off-agent-factory-plan.md`'s "gap 1" entry, 2026-08-30).
     Required for every ticket **except** one whose `## Required
     changes` list creates a repo from nothing (a true ticket-001
     walking skeleton, where every path is a guess) — every other
     ticket, including one that scaffolds several new files in an
     otherwise-existing repo, has concrete paths and must declare them:
     - `Verify-Command: <a command that fails if either sentence above
       would>` — since both `make verify` and `make verify-full` must
       pass per the prose, join them: `make verify && make verify-full`.
       Do not declare only `make verify` alone; that reports success on
       a regression the prose itself says must be checked.
     - `Allowed-Files: <comma-separated paths, workspace-relative, no
       leading ./, no absolute paths>` -- every path named or clearly
       implied by `## Required changes` (a new file's own path, an
       existing file being edited). Include `ARCHITECTURE.md`/
       `PROGRESS.md` too -- they are NOT exempted on the `factoryd`
       side (only `.gitignore`/`BUILD_REPORT.md`/`BUILD_EVIDENCE.json`/
       `.pi-build-session/` are), and every ticket after 001 edits both
       via the mandatory closing instruction above. Never `spec/
       contract.md`/`spec/spec.md` -- reference documents this ticket
       reads, never edits. Never a route, URL, or directory reference
       (`/health`, `docs/`, `https://...`) -- only an actual file this
       ticket's own diff touches.
     - `Required-Changed-Files: <comma-separated paths>` -- the subset
       of `Allowed-Files:` that *must* actually change, not merely files
       it's permitted to touch. Usually identical to `Allowed-Files:`.

     If a ticket genuinely has no nameable path yet (only the walking-
     skeleton exception above), omit all three lines for that ticket
     rather than inventing plausible-looking paths -- an absent
     declaration skips the scope gate cleanly; a wrong one produces a
     false quarantine.
5. **`## Commit`** -- "Commit once both pass. Commit message must be
   exactly: `ticket(NNN): <slug>`" with the ticket's actual number and
   slug filled in -- this exact string is what
   `commit_and_state_files_ok()` matches against.

   Example `## Verification` section for a ticket that edits
   `cmd/isprime/main.go` and `internal/prime/prime.go` (copy this shape,
   substituting this ticket's own real command and paths -- do not paste
   these exact paths into an unrelated ticket):

   ```
   ## Verification

   `make verify` must pass. Confirm `make verify-full` still passes.

   Verify-Command: make verify && make verify-full
   Allowed-Files: cmd/isprime/main.go, internal/prime/prime.go, ARCHITECTURE.md, PROGRESS.md
   Required-Changed-Files: cmd/isprime/main.go, internal/prime/prime.go, ARCHITECTURE.md, PROGRESS.md
   ```

## 2b. Deterministic ticketspec-key injection

Run this exact command as a single `bash` call, copied verbatim, before
moving to step 3. This is not optional and not covered by the ticket
structure you just wrote by hand in step 2 -- it fills in the
`Verify-Command:`/`Allowed-Files:`/`Required-Changed-Files:` keys
deterministically from the file paths your own `## Required changes`
lists already name, rather than relying on you to restate them (found
via review: models running this exact prompt do not reliably restate
them, even when told to, even with a worked example -- this step exists
specifically so that unreliability doesn't matter).

`"$2"` is quoted (a pilot dir containing whitespace would otherwise split
into multiple shell arguments and this command would fail). The script
is looked up at a few candidate locations rather than one fixed path,
because it is only guaranteed to exist for the clone + `install.sh`
setup ("What's installed" in `README.md` does not currently ship
`scripts/*.py` at all under the recommended no-clone `pi install` --
this is a real, separate gap in that installed-package footprint, not
something this one command can fix):

```
INJECTOR=""
for candidate in \
  "$HOME/code/agent-configs/pi/scripts/goal_pilot.py" \
  "$HOME/code/pi-harness/scripts/goal_pilot.py" \
  "./scripts/goal_pilot.py"; do
  if [ -f "$candidate" ]; then INJECTOR="$candidate"; break; fi
done
if [ -n "$INJECTOR" ]; then
  python3 "$INJECTOR" --inject-only "$2"
else
  echo "goal_pilot.py not found at any known location -- skipping deterministic ticketspec-key injection. Tickets in $2/spec/tickets/ do NOT yet declare Verify-Command:/Allowed-Files:/Required-Changed-Files: and cannot drive a factoryd run directly until that's fixed by hand or by running inject_ticketspec_keys() from wherever this pipeline is actually installed." >&2
fi
```

If this command errors for a reason other than the script being missing,
report the exact error and continue to step 3 anyway -- do not attempt
to hand-write the three keys yourself as a substitute; an absent
declaration is safe (it skips the scope gate cleanly), a hand-guessed
one is not. If the "not found" message above prints, report it exactly
as part of step 3's own report -- do not silently continue as if
injection had happened.

## 3. Report

Print, in this order:
- The tree scaffolded in step 0, if it ran (`find $2 -not -path
  '*/workspace/*'` or similar) -- omit this if step 0 was skipped.
- The full Assumptions & Interpretations list (even though it's also in
  the file -- this is what actually gets reviewed).
- The full Non-goals list.
- Ticket count and one line per ticket: number, slug, one-sentence goal.

Then this exact banner, and stop:

```
HUMAN REVIEW REQUIRED before this is a frozen spec.
Read spec/spec.md's Assumptions & Interpretations section and approve or
correct each line. Do not run ticket_runner.py against this output, and
do not run /contract-plan, until that review has happened -- this step
is allowed to guess; nothing downstream is.

Once reviewed, freeze the spec by replacing spec/spec.md's first line --
`STATUS: DRAFT -- pending human review of Assumptions & Interpretations`
-- with `STATUS: FROZEN -- reviewed <date>`. /contract-plan checks for
exactly this: it refuses to run against a spec whose first line still
says DRAFT.
```
