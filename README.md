# pi-harness

Config for the [pi coding agent](https://pi.dev) — extensions, skills, and
prompts that harden a pi session. See "Quick start" below to install it.

pi is deliberately minimal: four default tools (`read`, `write`, `edit`,
`bash`), plus optional read-only built-ins (`grep`, `find`, `ls`) that are off
by default, and no built-in MCP, subagents, permission prompts, plan mode,
todos, or web search (pi's own `README.md`, `docs/usage.md`). Everything here
re-adds a piece of that. It was built running pi against a **local model**
with a 64K-96K context window, not a cloud model, so the harness has to carry
weight the model cannot — but nothing here is tied to any specific model or
provider; see "Bring your own model" below.

This file documents what each extension, skill, and prompt does and why. It
was extracted from a private project's own machine-specific configuration —
comments throughout occasionally reference dated investigation logs from that
project that aren't included in this release; the trial evidence they
describe is real, the logs themselves just aren't public. Where a component
is explicitly marked "adopted," that means it survived live-trial evidence in
that project, not that it's guaranteed to fit yours.

## Global vs. local

Everything under `extensions/`, `skills/`, and `prompts/` at the repo root
is global: portable, no hardcoded machine paths or accounts, and what
`pi install`/`install.sh` ship by default to anyone cloning this repo. Real,
machine-specific config (a specific inference route's provider registration,
filled-in account names, a real `settings.json`) does not belong in this
repo at all — this repo's own history (see `UPGRADING.md` and the initial
extraction commit) is specifically about keeping that class of content out,
since `pi install git:...` and a plain `git clone` both hand out everything
committed here regardless of what any install manifest ships by default.
That config lives in whatever private repo you already keep your own agent
config in, alongside this repo as a sibling or however you organize it;
`examples/` shows the shape (e.g. `ai-stack-local.ts.example`) without being
a real, loadable copy of anything.

## Quick start

Requires [pi](https://pi.dev) already installed (`pi --version` to check).

**1. Install this config.** Pick one:

```bash
# Recommended: pi's own package manager, no clone needed
pi install git:github.com/ljammula/pi-harness@v0.3.0
```

```bash
# Alternative: clone + symlink, if you want to read or edit the source
git clone https://github.com/ljammula/pi-harness.git
cd pi-harness
./install.sh
```

Use the clone if you plan to poke at an extension, add your own, or send a
PR — its files stay live-editable in place. Use `pi install` for everything
else; see "pi install vs. install.sh" below for the full tradeoff.

The `@v0.3.0` pins the install to that tagged commit: `pi update
--extensions`/`--all` reconciles the checkout back to it instead of floating
to whatever's newest on `main` (see `UPGRADING.md`). To move to a newer
release on purpose, re-run `pi install git:github.com/ljammula/pi-harness@v0.4.0`
(or whatever tag you're moving to) — that's how pi documents updating a
pinned git package.

**2. Point pi at a model**, if you haven't already — nothing here hardcodes
one. Hosted provider: `/login` inside `pi`. Local/self-hosted endpoint: see
"Bring your own model" below. Skip this step if `pi` already works for you
today.

**3. Verify it loaded:**

```bash
pi -p "list your available skills"
```

You should see skills like `tdd`, `diagnosing-bugs`, and `docs-verify` in the
response. From here, just use `pi` normally — the harness applies itself; see
"What's installed" below for what each piece does.

## pi install vs. install.sh

Both produce the same running config — `pi install`'s manifest and
`install.sh`'s symlink list are kept in sync on purpose. Differences:

|  | `pi install` | `install.sh` |
|---|---|---|
| Setup | one command, no clone | clone the repo first |
| Updates | `pi update --extensions` | `git pull` (symlinks pick it up immediately) |
| Editing the source | not convenient | edit in place, changes are live |
| Managed via | `pi list` / `pi config` / `pi remove` | rerun `install.sh`, or delete the symlinks by hand |

If you're not sure, use `pi install` — switch to the clone later if you find
yourself wanting to change something.

## Bring your own model

Nothing in this repo hardcodes a model or provider. Point pi at whatever you
run:

- **A hosted provider** (Anthropic, OpenAI, etc.) — `/login` in an
  interactive session, or set the provider's API key env var. See pi's own
  [providers docs](https://pi.dev) for the full list.
- **A local or self-hosted OpenAI-compatible endpoint** (Ollama, vLLM,
  LM Studio, llama.cpp, or a custom proxy like the example below) — pi's
  native `~/.pi/agent/models.json` mechanism handles this without any code
  here; see `examples/models.json.example` for a minimal starting point, and
  copy `settings.json.example` to `~/.pi/agent/settings.json` (not symlinked
  — see "Settings" below) to set `defaultProvider`/`defaultModel` once you've
  picked one.
- **A local endpoint with quirks** (needs sampling defaults injected because
  the server silently defaults to greedy decoding, needs a specific
  thinking-mode wire format, rejects the `developer` role, or you want the
  provider's host to follow an env var so the same config works across
  machines) — `models.json` alone can't express all of that.
  `examples/ai-stack-local.ts.example` is the actual extension this project
  runs against its own local model; copy it into `extensions/` and adapt it
  as a starting point if you hit one of these cases. It is not linked by
  `install.sh` — nothing here assumes you have (or want) a matching setup.

Several extensions (`cross-model-review.ts`'s reviewer route,
`searxng-search.ts`, the local-review step in `self-review`) follow
`AI_STACK_HOST` as the hostname for optional local services. It defaults to
`127.0.0.1` if unset; set it to wherever (if anywhere) you run such services.
None of these extensions require it — each degrades to inert/unreachable
gracefully.

Current state: this project itself runs pi 0.83.0 against a resident local
model, with a distinct second model configured through
`AI_REVIEW_BASE_URL`/`AI_REVIEW_MODEL` for independent review. Same-primary
review requires `AI_REVIEW_ALLOW_SELF=1` and is labeled `blind-self-review`,
never cross-model. The write/edit guard resolves symlinks, and an
external-effect guard blocks deploy, publish, infrastructure, production
database, Kafka-admin, and Kubernetes mutations without an explicit category
opt-in. Whole-process confinement is the job of `containment/`; see its own
README for what's been live-verified there and what hasn't.

The committed `package.json`, pinned Pi API dependency, and `tests/`
directory provide repeatable type and behavior checks. `quality-gate.ts`
binds passing evidence to the current diff hash, rejects truncated or
shell-masked results, runs the repository's canonical broad check directly
at settlement, and caps automatic corrective follow-ups at three.
`stack-router.ts` names, in an explicit `before_agent_start` nudge, which of
the Go, Python, Flutter, TypeScript/JavaScript, PostgreSQL, Kafka, Temporal,
or GCP skills the repo's evidence matches; `stack-skill-overlay.ts` is what
actually makes only those matching skills discoverable, via
`resources_discover`, instead of shipping all 8 stack skills into every
session's system prompt globally regardless of repo (measurable startup
token tax for guidance most sessions never need). Versioned trace entries
support later evaluation without recording prompts, source, secrets, or full
command output.

## Launching pi

From any directory, in a normal terminal:

```
pi                     # interactive session
pi -p "<prompt>"        # non-interactive: process one prompt and exit
pi -p "<prompt>" --mode json   # non-interactive, structured event stream
```

Once you've set a `defaultProvider`/`defaultModel` in `~/.pi/agent/settings.json`
(see "Settings" below), no flags are required for day-to-day use —
`~/.pi/agent/extensions/` (symlinked from this repo's `extensions/`) is
loaded unconditionally on every launch, interactive or `-p`. You only need
explicit `--provider`/`--model`/`-e`/`--no-extensions` flags when
deliberately overriding these defaults, e.g. for a harness-vs-no-harness
comparison:

```bash
pi --no-extensions -p "<prompt>"   # same provider/model, extensions/skills/prompts stripped
```

That's the baseline arm used to evaluate this harness against an unmodified
pi session. If you find yourself running this often, a shell function/alias
wrapping your usual provider/model flags is worth adding — this repo doesn't
ship one, since that's a personal shortcut, not something with behavior to
document.

## What's installed

| Path | Becomes | What |
|---|---|---|
| `AGENTS.md` | `~/.pi/agent/AGENTS.md` | Global instructions, read on every session |
| `skills/<name>/` | `~/.pi/agent/skills/<name>` | Portable skills, pi-flavored |
| `prompts/<name>.md` | `~/.pi/agent/prompts/<name>.md` | `/<name>` slash commands |
| `extensions/*.ts`, `extensions/*/` | `~/.pi/agent/extensions/…` | Loaded unconditionally at startup |
| `examples/*` | *(not linked)* | Reference configs to copy and adapt, not installed as-is |

Adding a new customization: extension if it needs to intercept a tool call
or hold state across turns (`git-safety.ts`, `goal-gate.ts`); skill if it's
reusable procedure that should only cost context when relevance-gated
(`stack-skill-overlay.ts`'s routed skills); prompt if it's a fixed,
deterministic one-shot invocation (`/review`, `/before-done`). See `/goal`
vs. `/review` under "Prompt templates" below for the prompt/extension
boundary case.

`continuation-nudge.ts` and `co-change-suggest.ts` also remain beside their
tests under `extensions/`, but the installer explicitly removes/skips their
runtime links. Their existing evidence does not meet this project's own
paired-adoption threshold for shipping on by default. `cross-model-review.ts`
is linked so it can report its resolved identity, but remains internally
disabled unless truthful reviewer configuration is supplied.

### Extensions

Written here:

- **`karpathy-guardrail.ts`** — appends the karpathy-guidelines rules to the
  system prompt on every turn, since pi surfaces skills by relevance-matching
  rather than unconditionally. Since this is the sole enforcement path for
  pi, `install.sh` does not also link a `karpathy-guidelines` skill folder
  into `~/.pi/agent/skills/` — doing so would just advertise the skill's
  name+description to pi's own relevance-matching a second time, redundant
  tax for guidance the session already has unconditionally.
- **`full-stack-dev.ts`** — activates Pi's complete standard development
  toolset: `read`, `edit`, `write`, `find`, `grep`, and `bash` (Pi's terminal
  and command/test runner). It applies to backend-only as well as full-stack
  repositories: the name is historical, while the workflow itself is generic.
  It requires acceptance criteria, autonomous routine decisions, small
  implementation chunks, focused verification after each chunk, a persistent
  edit/test/debug loop until the check passes or an evidenced external blocker
  is reached, and a final broad verification plus diff review.
- **`rtk-rewrite.ts`** — routes bash commands through the `rtk rewrite` CLI
  (a token-optimizing proxy over `git`/`ls`/`find`/etc., not part of this
  release) for 60-90% less output, when that binary is present. If it isn't
  installed, this extension probes once and then no-ops for the rest of the
  session — safe to leave linked either way.
- **`format-on-edit.ts`** — gofmt/dart format after every write/edit. Local
  models produce unformatted code far more often than cloud models, and
  `make verify` fails on it.
- **`searxng-search.ts`** — a `web_search` tool backed by a local SearXNG
  instance at `AI_STACK_HOST:8888`. Chosen over the published `pi-web-access`
  package, which requires a cloud search API key. Registered as a *tool*
  rather than as a skill because a small model reliably calls a tool in
  front of it and unreliably remembers to shell out via a skill. Inert if
  nothing is listening on that port.
- **`continuation-nudge.ts`** — **default-disabled, pending paired
  evaluation.** Targets the plan-then-abandon failure mode (model announces
  an edit in prose, no tool call, turn ends with `stopReason: "stop"`, or
  stops with zero text content) by injecting a follow-up nudge instead of
  letting the turn end, when no passing verification command covers the
  current ask. Verification is tracked by outcome, so a failing check
  triggers a corrective follow-up instead of disarming the nudge; up to
  three nudges are allowed per run. A verification command feeding a shell
  pipeline is treated as inconclusive unless `pipefail` is set, so tools
  like `head` or `grep` can't mask a failing test exit. Deterministic branch
  tests pass; the widened empty-content-stop trigger has zero real-trial
  field evidence.
- **`co-change-suggest.ts`** — **default-disabled**; its one retrospective
  adoption case does not meet the paired-adoption threshold. Ports a
  co-change ranking (git co-change count² ÷ total historical touch count)
  into pi. On the first prompt that actually has grep-matchable identifiers,
  on repos with ≥20 commits of history, ranks files that historically
  co-change with those identifiers and appends a suggested-reading list to
  the system prompt, minus the identifier-matched seed files themselves.
  No-op by construction on fixture-sized repos with no history to mine; git
  subprocess cost capped and `ctx.signal`/timeouts wired through. Needs
  identifier-rich prompts to work (a purely generic paraphrase correctly
  surfaces nothing) — an inherent scoping limit of identifier-grep-based
  discovery, not a bug.
- **`git-safety.ts`** — adopted. Blocks destructive git commands run via the
  `bash` tool (`reset --hard`, `push --force` without `--force-with-lease`,
  `clean -f`, `branch -D`, `checkout`/`restore -- .`). Each block names a
  safe alternative rather than a bare refusal, since a blocked local model
  thrashes when given no alternative. Built after a live `pi -p` run once
  ran `git reset --hard main` unprompted to resolve a self-inflicted
  conflict, discarding a prior commit; verified live by reproducing the
  exact command against a scratch repo (blocked, repo untouched).
- **`cross-model-review.ts`** — the blind-reviewer pass: diffs against
  session base SHA, sends diff + spec to a second model for a second
  opinion, feeds back a flagged issue. An independent endpoint/model is
  labeled `independent-review`; the primary route/model is rejected unless
  `AI_REVIEW_ALLOW_SELF=1`, in which case it is labeled `blind-self-review`.
  Configure `AI_REVIEW_BASE_URL`/`AI_REVIEW_MODEL` to a genuinely different
  model than your primary route for real `independent-review`. The
  bounded-loop design (3-round cap, outcome-typed `runReview`,
  last-non-empty-line marker matching) is validated by unit tests
  (`tests/cross-model-review.test.ts`). `agent_settled` awaits any in-flight
  review, bounded by `REVIEW_TIMEOUT_MS` — an earlier fire-and-forget design
  let `pi -p` routinely exit before a review round (60-120s round trip) had
  time to finish, silently never getting a chance to flag anything.
- **`new-project-scaffold.ts`** — a `before_agent_start` nudge, not an
  autonomous write, since an extension running `git init` on every launch
  risks doing so inside a directory meant to be part of a parent repo. When
  no repo exists yet, tells the model to `git init`, seed a `.gitignore`,
  and make an initial commit — the commit matters as much as the `git init`,
  since an unborn `HEAD` leaves `quality-gate.ts` and `cross-model-review.ts`
  inert the same way a missing repo does. Bundles two more nudges gated on
  the same "no repo yet" signal: up-front layered Go structure (`cmd/`,
  `internal/domain/{errors.go,ports.go}`, `internal/handler`) instead of a
  size threshold that would fire mid-project and contradict this harness's
  own no-speculative-refactor rule, and a minimal README once a repo doesn't
  have one.
- **`makefile-scaffold-nudge.ts`** — when no Makefile and no documented
  verification command exist, hands the model `verification.ts`'s actual
  resolved command and asks it to wire `test`/`lint`/`verify` Makefile
  targets to it — prompt-only rather than an autonomous write, so a
  generated `verify` that silently missed one component of a multi-language
  repo can't shrink coverage versus the nested scan without the model seeing
  the exact command it's supposed to preserve. Arms on `tool_result` when a
  manifest file appears and nudges once at the next `turn_end` if still
  eligible — a design that only ever checked this from
  `before_agent_start` (which fires once before any files exist) would be
  silently unreachable for a genuinely new project, the exact scenario this
  targets.
- **`artifact-guard.ts`** — checks for untracked, staged, or
  recently-committed files over 1MB or bearing an ELF/Mach-O magic number
  (a real incident this was built for: a multi-megabyte compiled binary left
  in the working tree). Also a performance fix: `verification.ts`'s
  `hashUntrackedPath` sha256-streams every untracked file, including such a
  binary, on every settle event. Primary detection is on `tool_result` for
  build-shaped bash commands (`go build`, `-o `, `cargo build`, ...),
  checking in-band the moment the artifact is produced; `agent_settled`
  (also checking paths changed since the session's `baseSha`, not just
  working-tree status) is a backstop, not the primary path — see "Hook
  semantics" below for why.
- **`error-leak-guard.ts`** — rather than trying to gate "is the
  architecture layered" (no observer exists for that), scans for
  `http.Error(w, err.Error(), ...)` — a raw error string written straight
  into an HTTP response, leaking internal detail (SQL errors, file paths) to
  API clients instead of mapping to a stable domain error. Primary detection
  is on `tool_result` for `write`/`edit`, scanning the file the instant it
  changes, independent of git state entirely; `agent_settled` is a backstop.
- **`goal-gate.ts`** — a Claude-Code-style `/goal <condition>` command:
  registers a real slash command (not a prompt template) that sets a goal
  for the rest of this pi process and immediately kicks off a follow-up turn
  to start working on it. On every turn that looks like a stopping point
  (`stopReason: "stop"`), the gate checks whether the model has earned the
  right to stop — its message must end with a literal `GOAL COMPLETE:
  <evidence>` line, and the most recent broad verification command run
  since then must have passed — and if not, nudges it to keep going instead.
  Bounded by `PI_GOAL_MAX_ROUNDS` (default 15). Deliberately does not use an
  LLM to judge whether the goal is met the way `cross-model-review.ts` does:
  a same-model completion judge would carry the exact self-report bias this
  file already documents (models told to "run the gate" report success
  without running anything) — a passing verification command is the one
  signal this harness treats as real evidence elsewhere, so `goal-gate.ts`
  reuses that instead of inventing a weaker one. `/goal clear` ends a goal
  early; `/goal status` reports the current condition and round count.
  State is session-scoped, held only in the extension's own memory — a
  fresh `pi -p --continue` process (a new OS process against the same
  session file) starts with no active goal; for a batch build that must
  survive process restarts, use `scripts/build_app.py`'s outer round loop
  instead. That loop inherits installed thinking settings, shares
  `quality-gate.ts`'s canonical verifier, and consumes verification,
  reviewer, Pi-failure, and stall signals. Direct `build_app.py` use
  requires clean independent review by default; the `ticket_runner.py`
  workflow selects advisory review and records its verdict without making
  it a blocker. Use `--review-policy required` for a strict
  release-hardening run.
- **`verify-pack.ts`** — a `/verify` command and an identically-behaved
  `verify` tool: both run the repo's resolved canonical verification
  command itself via `pi.exec` (same resolver `quality-gate.ts` and
  `goal-gate.ts` use), plus any separately defined Node `typecheck`/`lint`
  scripts the canonical command doesn't already cover, plus one
  independent-review round if `AI_REVIEW_BASE_URL`/`AI_REVIEW_MODEL` are
  configured, and write a JSON record to `~/.pi/agent/verify/<repo-slug>/`
  — outside the project tree, so a client repo never gets a verify record
  committed into it — and a `pi-harness-trace` entry. Registered as both a
  command and a tool because a model executing a prompt template's own
  turn (e.g. `/before-done`'s) cannot invoke another registered slash
  command mid-turn — `sendUserMessage`-sourced input explicitly skips
  slash-command dispatch — so the tool is what `before-done` actually
  calls; the command is for a human's own direct/interactive use,
  including `/verify status` (the last record plus whether the diff has
  moved since) and `/verify last` (reprints it without rerunning
  anything). A killed/timed-out run, truncated captured output, or a
  masking shape `-o pipefail` doesn't neutralize (`|| true`, a trailing
  `; ...`, a leading `!`) records `inconclusive`, never `pass`; an
  unavailable git diff snapshot (a non-git cwd, a transient git error)
  blocks `DONE` even if the command itself passed, since the evidence
  was never actually bound to a diff. Registers no `turn_end`/`agent_end`
  listener and sends no follow-up message: it records truthfully, same
  design constraint as `quality-gate.ts` and `cross-model-review.ts`
  above, so the model (or a human) reads the record and decides what to
  do next rather than being gated or nudged by it. A flagged review is
  recorded as evidence, never as authority over the deterministic checks,
  so it never flips `verdict`. `prompts/before-done.md` and
  `skills/before-done/SKILL.md` both point here for their format/test/lint
  step instead of describing it by hand.
- **`shared-resource-overlay.ts`** — cross-project resource discovery: on
  `resources_discover`, reads a machine-local registry at
  `~/.pi/agent/harness-resources.json` (absent means a true no-op, the same
  contract `project-skill-overlay.ts`'s `PI_PROJECT_SKILLS_REMOTE` uses) —
  a JSON array of
  `{"root": "<path>", "skills": ["<name>", ...], "prompts": ["<name>", ...]}`
  entries — and surfaces the allowlisted `skills/<name>` and
  `prompts/<name>.md` under each root, so a skill that already exists in
  another config repo (`hermes-config`, `agent-configs`) loads in a pi
  session for any project instead of being copied in by hand per repo.
  Each root is realpathed (so a symlinked root works the way `install.sh`'s
  own links do); a missing root or a missing named skill/prompt is skipped
  with one warning, never a crash. Deliberately an explicit allowlist per
  root, never "load everything under that directory" — same startup-token
  reasoning as `stack-skill-overlay.ts`. Extensions are not shared this way:
  `resources_discover` cannot contribute extension paths, and an extension
  from another repo would need this repo's `lib/` on its import path
  anyway. On a name collision with a skill already in this repo's own
  `skills/` or the global `~/.pi/agent/skills/`, records a `routing` trace
  naming which copy wins — pi's own loader always merges a
  `resources_discover`-contributed path in *after* its natively-discovered
  ones, so the local copy always wins unconditionally; there is no hook
  available to override that ordering, so (unlike the original plan text)
  this does not offer a `"prefer"` flag that would silently do nothing.
  The registry file itself is never created by `install.sh` (`tests/
  install-scope.test.ts` asserts this) and is not part of this repo, since
  it names machine-local paths — the class of content this release's
  extraction note says was removed.

Canonical copies of skills shared this way: this repo is the canonical
source for `karpathy-guidelines`, `wiring-verify`, `docs-verify`,
`local-summarize`, and `before-done`. A shared skill maintained elsewhere
(e.g. `hermes-config/skills/wiring-verify`) should become a symlink or a
documented re-export pointing here rather than a second hand-edited copy —
that change belongs to the other repo's own review, not this one.

All extensions above `shared-resource-overlay.ts` are unit-tested
(`tests/*.test.ts`). A
live end-to-end test (a `pi -p` run building a small Go+SQLite backend from
an empty directory) found that the original `agent_settled`/
`before_agent_start`-only designs of several of them were structurally blind
to the exact scenarios they were built for — see "Hook semantics for
extension authors" below for the root cause and the fix.

Vendored from pi's `examples/extensions/`, with changes noted in each file:

- **`protected-paths.ts`** — blocks Pi `write`/`edit` calls to
  sensitive/generated files and paths outside the working directory. The guard
  is not a sandbox: it does not cover shell redirection or commands run through
  `bash`, and it does not resolve symlink escapes. The `write`/`edit` catch is
  not theoretical: a small local model, asked to write `main.go` in a temp
  dir, once emitted an absolute path to an unrelated directory and pi's
  write tool obeyed. With the guard, the model gets a corrective message and
  retries correctly.
- **`plan-mode/`** — `/plan` or Ctrl+Alt+P for read-only exploration using
  PI's native inspection tools, with `/plan-todos` for the current plan steps.
- **`todo.ts`** — task list tool with persistent state.
- **`git-checkpoint.ts`** — per-turn checkpoints (base SHA + stash + loose
  blobs for untracked files, all non-destructive) so `/fork` can restore
  code to that point, including reverting a clean-start edit and preserving
  pre-existing uncommitted work — see the file's own header comment for why
  a plain `git stash create`/`apply` pair silently didn't work for either
  case.
- **`notify.ts`** — terminal notification when the agent finishes. Vendored
  change: gated on `hasUI`, since in `-p` mode the raw OSC escape would
  otherwise corrupt captured stdout.
- **`progress-stall-guard.ts`** — **adopted, with a default-on wall-clock
  backstop.** Retains shape-specific repeated-failure/cycle telemetry and an
  opt-in synchronous intercept (`PI_STALL_GUARD_INTERCEPT=1`), plus a
  shape-agnostic no-source-edit timer: soft warning after 10 minutes, hard
  `stall-timeout` abort after 20 by default. The independent timer catches a
  single tool call that never returns and was live-validated on a real
  task. Its lifecycle resets on `before_agent_start`, so each top-level
  interactive prompt gets a fresh deadline while retry/compaction
  `agent_start` events preserve evidence.
- **`wall-clock-budget-nudge.ts`** — closes the specific gap that let the
  `progress-stall-guard.ts` run above end in a silent kill: Pi has no notion
  of an external caller's timeout, so when one exists (an outer harness
  script passing `PI_HARNESS_TIMEOUT_MINUTES`), this warns once near 75% of
  it — "land what you've diagnosed now" — rather than letting the process
  die with no chance to act. Inert (no listeners registered) unless that env
  var is set to a positive number, so normal interactive/`-p` use without an
  external deadline is unaffected.

### Prompt templates

`/review`, `/before-done`, `/wire`, `/l10n` — thin, explicit wrappers over the
matching skills. They spell out each step and demand pasted command output,
because a small model that is told "run the gate" will report success without
running anything.

`/spec-plan <rough-input-path> [pilot-dir]` — one command covers the whole
"start a pilot from a rough idea" operation:

1. **Scaffold**, only if `$2` isn't a pilot dir yet (no `Makefile`
   present): control-dir `spec/`, `.gitignore`, `Makefile`, an empty
   `workspace/`. Zero judgment calls by design — every file's content is a
   heredoc copied verbatim in the template rather than described for the
   model to reconstruct, specifically to avoid the failure mode a local
   model would hit reproducing `Makefile`'s literal-tab recipe lines from
   prose. Refuses outright (writes nothing) if `$2` already exists,
   is non-empty, and has no `Makefile` — that shape means "not a pilot
   dir this command made," and scaffolding into it risks silently
   overwriting an unrelated project's own files.
2. **Draft** `spec/spec.md` and `spec/tickets/NNN-*.md` from the rough
   input at `$1`. Unlike the other templates, this step is explicitly
   allowed to resolve ambiguity rather than refuse to guess — the one place
   in the pipeline this can happen *visibly*: every resolved ambiguity must
   land in the spec's own "Assumptions & Interpretations" section as
   its own reviewable line, never silently absorbed into a ticket. It
   still stops short of writing API-contract detail or acceptance
   tests (those stay their own step, see below) and ends every run
   with a mandatory human-review banner — a frozen-spec checkpoint still
   applies before `ticket_runner.py` ever sees the output.

Named to avoid colliding with `plan-mode/`'s own `/plan` command
(read-only exploration mode, see "Extensions" above) — two different
registrations can't share a slash-command name.

**Full pilot sequence, and what covers each step:**

| Step | Command / mechanism |
|---|---|
| Scaffold dir + draft spec + tickets | `/spec-plan <rough-input> <pilot-dir>` |
| Review Assumptions & Interpretations | human, no tooling |
| Contract + acceptance-test generation | `/contract-plan <pilot-dir>` **drafts locally**, then **cloud review is a required, separate, human-triggered step** — see below |
| Run the pipeline | `make run` (control-dir Makefile, wraps `ticket_runner.py`) |
| Check position | `make status` |
| Rescue a halted ticket | human + `build_app.py` by hand, or `ticket_runner.py --amend-canon` for a frozen-artifact bug |
| List archived evidence | `make reports` |
| Judge the final verdict | human reads `PROGRESS.md`/`reports/`, no tooling |

**`goal_pilot.py` (`scripts/goal_pilot.py`) drives this entire table
from one invocation** — `/spec-plan` → spec-freeze checkpoint →
`/contract-plan` → acceptance-suite checkpoint → `ticket_runner.py`'s
build loop → class-aware halt handling → a `VERDICT.md`. It is not a
prompt template (it's deterministic Python, alongside `ticket_runner.py`
and `build_app.py`) and it does not replace `/spec-plan`/`/contract-plan`
above — it drives them headlessly instead of a human typing each command
in turn. See `scripts/README.md`'s `goal_pilot.py` section for the full
design.

Contract and acceptance-test generation is the highest-stakes output in
the pipeline — a wrong contract or test oracle doesn't fail loudly, it
silently certifies broken app code as correct, and unlike ticket sizing
there's no cheap way to check "was this test actually right" before a
real build hits it.

`/contract-plan <pilot-dir>` handles only the half of this that's safe to
automate: a local draft plus a **mechanical self-check** (assemble every
staged Go acceptance slice into a scratch module and `go vet`/`go build`
it; best-effort the same for Dart via a scratch Flutter project, since a
bare `dart analyze` on an isolated file false-positives on unresolved
`package:flutter_test` imports). This catches syntax-class bugs a review
pass can miss on a read-through (an unescaped `$` in a Dart string literal,
a Go type error) — but says nothing about whether a test asserts the
*right* behavior. `/spec-plan`'s "surface every guess for review"
mitigation doesn't transfer to that half: a wrong business-rule assumption
reads as a sentence a human can approve or reject; a wrong JSON field
casing doesn't announce itself on read, it needs to actually run to be
caught, and no amount of local self-checking substitutes for a second, more
capable set of eyes on *meaning*. That half stays a manual, human-triggered
step — bring the draft to a cloud session (Claude Code or equivalent) for
review and correction before treating it as frozen. `/contract-plan` ends
every run with a banner saying exactly that, and must never claim or imply
cloud review happened when it didn't.

`/goal` is not one of these: it's a real command registered by
`goal-gate.ts` (see above), because a `/goal <condition>` needs persistent
state across turns and a gate on stopping, neither of which a `.md` prompt
template can do on its own.

### Hook semantics for extension authors

A live end-to-end test (`pi -p` against a fresh empty directory,
non-interactive mode) caught two extensions — `error-leak-guard.ts` and
`artifact-guard.ts` — making the same wrong assumption about when
`agent_settled` fires, and `makefile-scaffold-nudge.ts` assuming
`before_agent_start`'s one-shot precondition check would somehow still
apply once the project it was checking for came into existence. Both
mistakes trace to the same underlying fact: which hook fires *once* versus
*repeatedly*, and *when* relative to the model's own actions, is not
obvious from the hook names alone. Confirmed from the `--mode json` event
log of that test, not assumed:

| Hook | Fires | Notes |
|---|---|---|
| `before_agent_start` | Once per genuine top-level prompt, before its first tool call | The only hook that can amend the system prompt (`{systemPrompt}`). It does not fire for internal retries, compaction, or queued continuations, so it is also the correct boundary for resetting per-prompt state. |
| `agent_start` | Once per internal agent-loop segment | Cannot amend the prompt. It fires again on retry/compaction/queued-continuation segments, so one-time baselines need their own guard; timers that must survive those boundaries need to start idempotently on every firing. |
| `tool_call` / `tool_result` | Once per tool invocation, throughout the session | The only hooks with per-action granularity. `tool_result` can append/replace the tool's own result content in-band (`{content: [...]}`) — no new turn, no `sendUserMessage`, no nudge budget consumed. This is the cheapest and most immediate way to catch something the instant it's written, independent of git state entirely. |
| `turn_end` | Once per assistant turn | The actual "periodic sweep" hook. Cannot amend anything directly — a nudge from here needs `pi.sendUserMessage(..., {deliverAs: "followUp"})`, which queues a new turn. Fire nudges from here at a turn *boundary*, not mid-turn from `tool_result`, so a nudge reads as normal feedback rather than a non-sequitur interrupting an in-progress edit. |
| `agent_settled` | Once after a top-level run fully settles with no pending retry, compaction, or queued continuation | Later than `agent_end` and safe for stopping per-run timers. In `-p` it is normally the terminal checkpoint; an interactive process can emit it again for later prompts. Anything gated here that inspects only working-tree state can still miss content the model already committed, so use it as a backstop rather than the primary per-action detector. |

Concretely: `error-leak-guard.ts` and `artifact-guard.ts` now do their real
work in `tool_result` (scan a file the instant it's written; scan for a
build artifact the instant a build command runs) and keep their original
`agent_settled` diff/status scan only as a backstop for whatever bypassed
the tools they hook (e.g. content from a bash heredoc). Both also capture
`baseSha` at `agent_start` instead of always diffing from an unresolved
base, so the backstop itself is less bypassable too.
`makefile-scaffold-nudge.ts` still nudges immediately in `before_agent_start`
for an already-populated repo, but for a genuinely empty one it now arms on
`tool_result` when a manifest file (`go.mod`, `package.json`,
`pubspec.yaml`, `Cargo.toml`) gets written and nudges once at the next
`turn_end` — the precondition getting re-checked at all, instead of only
once before anything existed, was the fix.

## Dispatching pi for a code change

Pi advertises skill names and descriptions in the system prompt, then relies on
the model to read the matching `SKILL.md`. That relevance match is not
deterministic. Current Pi also exposes every skill as `/skill:<name>`, which is
the deterministic way to load it in interactive or `-p` mode. Prefer the slash
form for workflows whose exact instructions matter; naming a skill in ordinary
prose is only a weaker fallback.

Template:

```
/skill:<skill-name> <task>

Spec: <path, if one exists — feature-dev wants this>

Success condition: run `make verify` and fix any failures until it exits 0.
Do not stop, report done, or summarize until make verify has actually been
run and passed — a description of what you would do is not the same as
doing it.

<any task-specific constraints>

Do not commit or push.
```

Picking the skill name:

| Skill | When to name it |
|---|---|
| `feature-dev` | Net-new, multi-file, user-visible feature that'll need a PR — full spec→branch→implement→l10n→verify flow |
| `backend-dev` | Go-only change (handler/service/repository/middleware) |
| `frontend-dev` | Flutter-only change (widget/bloc/notifier/screen) |
| `wiring-verify` | After adding something with a documented N-step checklist (feature flags, routes) |
| `docs-verify` | Doc-only edit (URL, terminology rename) |
| `pr-remediate` | Addressing review comments on an existing PR |
| `self-review` | Review a PR under your second GitHub account (see note below) |

**`self-review` must use its slash command.** Its frontmatter sets
`disable-model-invocation: true`, so the skill is hidden from the system prompt
and cannot load through relevance matching or ordinary prose. This is
deliberate, not a gap: the skill posts public PR comments/approvals and
switches the machine's active `gh` account, so it must only run on an
explicit, unambiguous trigger, never as an inferred side effect of some
other task. Invoke it with `/skill:self-review` (works in `-p` mode too,
e.g. `pi -p "/skill:self-review review PR #214"` — requires
`enableSkillCommands` at its default of `true`).

Constraints worth stating explicitly, given what actually broke in real
dispatch runs against this harness:

- **If the branch might already exist**, say so:
  `"the branch <name> already exists; switch to it, do not create or reset
  it."` This is what triggered an unprompted `git reset --hard` that
  `git-safety.ts` now exists to block — the block still costs a wasted turn
  working out the alternative, so stating it up front avoids the detour.
- **If reusing an existing l10n key name**:
  `"grep the .arb files for this key name first -- don't assume it's
  unused."` `make lint` now catches a resulting duplicate, but catching it
  before pi writes broken translations is cheaper than catching it after.
- **Always end with the exact verification command and "stop only when it
  exits 0"** — not "when it passes," which is vaguer and, in a real trial
  against this harness, is exactly the instruction it silently didn't follow
  once.

One habit that lives outside the prompt: whatever pi reports at the end is a
claim, not a fact. Re-run the verification command yourself before trusting
it — that's what caught both a silent-stop failure and an l10n bug a review
pass missed in real trials. No prompt phrasing replaces that; it's a review
step you still own.

## Settings

`settings.json.example` is a starting point for `~/.pi/agent/settings.json`
— but that file is **not** symlinked from this repo: pi rewrites it itself
(`/settings`, package installs, `lastChangelogVersion`), so a symlink would
mean pi editing tracked files behind your back. Copy it deliberately, then
add your own `defaultProvider`/`defaultModel` (see "Bring your own model"
above) and `enabledModels` (for Ctrl+P selection — for OpenAI-completions
providers, pi matches path-style IDs by substring, not glob, so list the
model id's basename exactly).

Compaction reserve is set to match a typical local model's `maxTokens`, to
leave more of the available context for actual work — adjust to your own
model's output budget.

## Deliberately not installed

- **`pi-mcp-adapter`** — install it when you actually have an MCP server to
  adapt, not before.
- **`pi-subagents`** — subagent fan-out multiplies context use, which cuts
  directly against the small-context-window premise this harness was built
  for. Reconsider if you're running a large-context model.
- **Aider-style delegation to a local model** — see `AGENTS.md`; not
  benchmarked as a win against this harness's own tasks, and cost more
  cloud tokens while running slower in one such benchmark. Worth measuring
  again against your own setup rather than taking as a blanket verdict.
