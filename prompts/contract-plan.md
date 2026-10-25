---
description: Draft the API contract and acceptance-test oracle from a frozen spec (local draft only -- cloud review is a required, separate, human-triggered step)
argument-hint: "<pilot-dir, default: current directory>"
---

Draft `spec/contract.md` and `spec/acceptance/NNN/*` for the pilot dir
at `$1` (default: current directory), from the already-frozen
`spec/spec.md` and `spec/tickets/NNN-*.md`.

**Resolve `$1` to a concrete path before running anything below:** if
`$1` was not given, set it to `$(pwd)` -- do not let it stay empty and
flow into the self-check commands below as-is, which would expand
`"$1"/spec/acceptance/*/*.go` to a root-relative glob that matches
nothing instead of the current directory's acceptance slices.

**This is the highest-stakes step in the pipeline, and this template
only does half of it.** A wrong contract or test oracle doesn't fail
loudly -- it silently certifies broken app code as correct later. This
template's output is a **local draft plus a mechanical self-check**
(does it compile/analyze), nothing more. **Cloud review and correction
of this draft is a separate, required, human-triggered step** -- this
template must never claim or imply that step happened; it didn't run it
and can't verify it did.

## 0. Preconditions -- refuse rather than guess

Check both before writing anything:

- `$1/spec/spec.md` must exist and its first line must NOT be
  `STATUS: DRAFT ...`. If it's missing or still draft, stop and report:
  "spec/spec.md is not frozen yet -- run `/spec-plan` and get human
  review of its Assumptions & Interpretations first." Do not proceed.
- `$1/spec/tickets/` must contain at least one `NNN-*.md` file. If not,
  stop and report that ticket decomposition hasn't happened yet.

## 1. `spec/contract.md`

Read every ticket's Goal and Required Changes to enumerate the full API
surface implied by the spec. For each endpoint: exact path, method,
request/response JSON shape with exact field names and casing (pick one
casing convention and use it everywhere -- a wire-format casing mismatch
is invisible to round-trip decode), every status code with its error
code and message shape. Do not leave a field name or status code "TBD"
-- if `spec.md`'s "Open questions for the contract step" section flagged
something as undecided, decide it here: resolve what you can and note
only genuine forks in direction, not routine detail, as remaining
questions.

## 2. `spec/acceptance/NNN/*`

For each ticket, write its acceptance-test slice sized to what that
ticket alone must turn green -- not the whole app's behavior, just this
ticket's. Follow the conventions below -- **do not** read a sibling pilot's
`spec/acceptance/` for reference: an unbounded directory like that can
overflow the local model's context budget on the very first turn, and
this template runs headless with no human present to notice a silent
failure. Everything the shape actually requires is spelled out
explicitly below instead:

**A note on "where does the app live" before any of this, for every
stack -- read this even if you think you already know:** there is no
single fixed answer, and guessing one from a slice's own `__file__`
location is exactly the mistake a real build made (notes-app,
2026-09-06). This pipeline has more than one way to actually build a
ticket -- `factoryd`'s own default (`-isolate-workspace`) builds in a
separate git worktree and merges the accepted result into the pilot
dir's own repository root; `ticket_runner.py`'s own standalone flow
(what a pilot dir's `make run` invokes) builds directly inside
`<pilot-dir>/workspace/`, a real, non-empty repo of its own in that
flow -- and a slice's test code has no reliable way to know in advance
which one produced the checkout it's about to test.

**The fix is to never need to know.** `make verify`/`make verify-full`
-- however either flow invokes it -- always runs with its current
working directory already set to the real app root, whichever flow
produced it (`build_app.py`'s own `run_verification` passes exactly
that directory as `cwd`, in both flows, without exception). A slice
that needs "the directory the app is checked out in" should resolve it
as **the process's own current working directory** (`os.getcwd()` /
`Path.cwd()`), never a `__file__`-relative parent-directory computation
at all. The real build got this wrong by inventing a fixed
`__file__`-relative chain (`<this test's dir>/../../../workspace`) that
happened to match neither flow correctly -- and, separately and
independently, an agent building against that same ambiguous
convention wrote a whole real app's worth of files into a literal
`workspace/` subdirectory of its own, both silently invisible to git
since `workspace/` is exactly what `.gitignore` excludes in the
`-isolate-workspace` flow. `os.getcwd()` has no such ambiguity to get
wrong: it does not need to guess which flow ran, or how many `..`
segments separate a slice's own file from the app root, because it
never asks that question.

- **Go slices**: black-box `httptest`/HTTP-client tests hitting the real
  router, one `MANIFEST.md` naming what the slice verifies and what it
  depends on, a shared `helpers.go` in the first Go slice only (later
  slices reuse it once staged), a `go.mod` in the first Go slice only
  (`module <app>/acceptance`, matching what later slices will share once
  `ticket_runner.py`'s own staging -- see `STAGED_EXTENSIONS` -- copies
  everything into one shared `workspace/acceptance/` directory,
  `NNN_`-prefixed per file except the shared `go.mod`/`go.sum`/
  `helpers.py`, which keep their literal name -- do not add a `go.mod`
  to every slice, only the first). At least one raw-bytes JSON assertion
  per endpoint (gotcha #4 again -- a decoded-struct comparison can hide a
  casing bug a raw-bytes check catches).
- **Dart slices**: widget tests keyed to the ticket's screen, one
  `MANIFEST.md`, rendered-text assertions where strings mix literals and
  interpolation written carefully (see the self-check below for exactly
  the bug class to avoid).
- **Python slices**: black-box tests via the standard library only
  (`unittest`, `subprocess`, `urllib.request` -- no third-party HTTP
  client), one `MANIFEST.md`, a shared `helpers.py` in the first Python
  slice only (later slices `from helpers import ...`, relying on
  `unittest discover`'s own `-s <slice-dir>` adding that directory to
  `sys.path` -- true of both the canonical `spec/acceptance/NNN/`
  location and, once staged, the flat `workspace/acceptance/` one, since
  `helpers.py` keeps its literal name in either). Start the real server
  as the app's actual documented entrypoint (`python3 -m <package>.main`
  or equivalent) in a real subprocess, **launched with `cwd=os.getcwd()`
  (i.e. inherit the test process's own working directory, don't compute
  one) -- see the note above** -- configured the exact same way
  `contract.md`'s own Server & process contract says a deployer
  configures it (environment variables,
  most commonly) -- write both documents from the same decision in the
  same pass, never invent a CLI-flag convention here that
  `contract.md`'s own prose doesn't also commit to, since a mismatch
  between the two means the acceptance suite can never actually start the
  real server it's supposed to test against. At least one raw-bytes
  assertion per endpoint (`json.dumps(payload) == b'...'`, or an
  equivalent exact-bytes comparison) -- a decoded-dict comparison can
  hide a casing or field-order bug a raw-bytes check catches, the same
  gotcha as the Go bullet above.
- Every non-2xx response gets an assertion on both status code and the
  exact error code/message shape from `contract.md` -- never just the
  status code alone.

## 3. Mechanical self-check -- do this before finishing, not instead of cloud review

This catches syntax-class bugs a review pass can miss on a read-through
(an unescaped `$` inside a Dart string literal, a Go type error) --
cheap and deterministic, but it says nothing about whether a test
asserts the *right* behavior. Run it for real and paste the actual
output; do not report this step done without having run it.

**Go**: assemble everything staged so far into a scratch module and vet
it. Resolve every path from `$1` (default: current directory) rather
than the shell's cwd, and start from a clean scratch dir each run --
files left over from a previous draft or a different pilot in
`/tmp/contract-check` would otherwise get vetted/built alongside this
one and produce false failures (or worse, a false pass).

Copy per-slice, not with a single flattening glob: two slices can
legitimately pick the same ordinary basename (two `handler_test.go`), and
`cp spec/acceptance/*/*.go` into one flat directory silently drops one of
them -- the check then reports clean having never compiled the dropped
file. Prefix every non-module file with its slice number, the same
convention `ticket_runner.py` stages with at build time:

```
rm -rf /tmp/contract-check && mkdir -p /tmp/contract-check/acceptance
for d in "$1"/spec/acceptance/*/; do
  n=$(basename "$d")
  for f in "$d"*.go "$d"go.mod "$d"go.sum; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    case "$b" in
      go.mod|go.sum) cp "$f" /tmp/contract-check/acceptance/"$b" ;;
      *) cp "$f" /tmp/contract-check/acceptance/"${n}_${b}" ;;
    esac
  done
done
cd /tmp/contract-check/acceptance && go vet ./... && go build ./...
```

Fix anything that fails to compile, then re-run until clean.

**Dart**: this needs a real Flutter project context to resolve
`package:flutter_test`/widget imports -- a bare `dart analyze` on an
isolated file will false-positive on unresolved imports that have
nothing to do with the actual test. Use a separate scratch dir from the
Go check above (`/tmp/contract-check-dart`), and remove it first if it
already exists, for the same reason -- a prior draft's leftover test
files would otherwise get analyzed alongside this one. Same basename
collision risk as the Go check, and the same fix -- prefix each copied
test file with its slice number:

```
rm -rf /tmp/contract-check-dart
flutter create /tmp/contract-check-dart --project-name scratch
for d in "$1"/spec/acceptance/*/; do
  n=$(basename "$d")
  for f in "$d"*.dart; do
    [ -e "$f" ] || continue
    cp "$f" /tmp/contract-check-dart/test/"${n}_$(basename "$f")"
  done
done
cd /tmp/contract-check-dart && flutter analyze
```

If a scratch Flutter project is cheap to create in this environment, do
that and fix what it finds. If creating one is not practical here, say so
explicitly in the report below rather than silently skipping the check --
an unflagged gap is worse than a flagged one.

**Python**: no scratch project needed -- run each slice's own test module
directly against the shared `helpers.py`, prefixed the same way as the
Go/Dart checks above so a same-named `test_*.py` in two slices can't
silently shadow one another:

```
rm -rf /tmp/contract-check-py && mkdir -p /tmp/contract-check-py
for d in "$1"/spec/acceptance/*/; do
  n=$(basename "$d")
  for f in "$d"*.py; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    case "$b" in
      helpers.py) cp "$f" /tmp/contract-check-py/helpers.py ;;
      *) cp "$f" /tmp/contract-check-py/"${n}_${b}" ;;
    esac
  done
done
cd /tmp/contract-check-py && python3 -m unittest discover -s . -p 'test_*.py' -v
```

Use `unittest discover`, not bare `py_compile`: `py_compile` only
compiles source and never executes an `import` statement, so a
misspelled `from helpers import ...` name or a nonexistent module
passes it silently -- `unittest discover` actually imports every
matching module during collection, which is exactly where that class
of bug surfaces (found via a code-review pass: this section's own
first version used `py_compile` while claiming imports were checked,
which they were not).

Every individual test will still fail or error here -- the app under
test does not exist yet at this step, so nothing can actually start a
real server -- that is expected and not a problem this check is meant
to catch. What matters is *how* each one fails: a collection/import
error (unittest reports these distinctly, before any test method even
runs) means a real bug in the slice itself (a typo, a missing symbol);
an ordinary test failure or a connection error trying to reach a
not-yet-existent server does not. Skim the output for the former
specifically.

## 4. Report

Print:
- The full list of endpoints drafted into `contract.md`.
- Ticket count and which ticket each acceptance slice covers.
- The self-check's real output for whichever stack(s) apply (or an
  explicit note that the Dart self-check was skipped and why).
- For a Python project specifically: confirm in one sentence that no
  slice computes the app root as a `__file__`-relative parent-directory
  chain -- every one resolves it as `os.getcwd()` per this template's
  own note above, and `goal_pilot.py`'s own `check_acceptance_suite_paths`
  mechanical guard also checks for this before this checkpoint prints.

Then this exact banner, and stop:

```
CLOUD REVIEW REQUIRED before this is frozen.
This is a local draft plus a mechanical syntax check -- nothing here has
verified the contract or tests assert the RIGHT behavior, only that they
compile. Bring spec/contract.md and spec/acceptance/ to a cloud session
(Claude Code or equivalent) for semantic review and correction. Do not
run `make run` against this output until that review has happened.
```
