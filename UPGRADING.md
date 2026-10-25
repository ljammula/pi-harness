# Upgrading the pinned pi version

This repo pins pi to one exact version across its four
`@earendil-works/pi-*` `devDependencies` (`package.json`) — not a standing
plan to track `latest`, but a procedure to follow when a bump is actually
warranted (a CVE, a fix or feature this harness needs, or upstream dropping
support for the pinned version).

## Why pinned

Every extension here typechecks against the pinned version's public types
(`npm run typecheck`), and the harness's own behavior — hook shapes, event
names, `pi-harness-trace` entry format — is only verified against that one
version. Letting the pin float would turn any future extension breakage
into a silent surprise instead of a loud, attributable one: an upstream
type rename or event-shape change lands as a hole in coverage, not a
failing test, if the pin moves without a deliberate check.

`extensions/harness-pin.ts` backs this up at runtime: it warns (never
blocks) if the `pi` you're actually running with has drifted from this
repo's pinned version — see its own header comment.

## Procedure, when it's time

1. **Bump the pin, all four packages in lockstep.** They cross-depend on
   each other via matching peer ranges — bumping one and leaving the
   others behind is exactly what `tests/lockstep-pin.test.ts` exists to
   catch, but fix it at the source instead of chasing that test:

   ```bash
   npm install @earendil-works/pi-agent-core@<version> \
     @earendil-works/pi-ai@<version> \
     @earendil-works/pi-coding-agent@<version> \
     @earendil-works/pi-tui@<version> --save-exact
   ```

   **Also bump the separate global CLI install.** This repo's four
   packages are project-local `devDependencies`, used for typecheck/test
   against the pinned public types; the `pi` binary you actually run
   sessions with resolves to a *separate* global npm install
   (`npm list -g @earendil-works/pi-coding-agent`). The two can diverge
   silently — confirm directly, don't assume the project-local bump moved
   it. Record the current version first — Rollback below needs it to put
   the global CLI back if step 2 or 3 fails, not just the local pin:

   ```bash
   npm list -g @earendil-works/pi-coding-agent   # note this down before bumping
   npm install -g @earendil-works/pi-coding-agent@<version>
   pi --version   # must match <version> before continuing
   ```

2. **Static checks** — cheap, catches breakage before spending any model
   time:

   ```bash
   npm run typecheck   # tsc --noEmit against the new package's public types
   npm test            # tsx --test tests/*.test.ts + the Python unittest suite
   ```

   `tests/lockstep-pin.test.ts` and `tests/manifest-sync.test.ts` are part
   of this — a lockstep miss or a manifest/install.sh drift introduced by
   the bump fails here, not silently later.

3. **One live smoke run**, on a scratch directory outside any repo you
   care about:

   ```bash
   pi --version
   cd "$(mktemp -d)"
   pi -p "list your available skills"
   ```

   Confirm it starts, loads the harness's skills without an error, and
   `extensions/harness-pin.ts` reports no mismatch warning against the
   version you just bumped to.

4. **Commit the bump, then tag that commit** -- in that order. `git tag`
   points at whatever commit is currently `HEAD`; tagging before
   committing the `package.json`/`package-lock.json` changes from step 1
   would tag the *old* pin, so the pushed release would silently still be
   the previous version even though README claims otherwise:

   ```bash
   git add package.json package-lock.json
   ```

   Then update `README.md`'s Quick start `pi install
   git:github.com/ljammula/pi-harness@vX.Y.Z` line to the new
   tag, add it to the same commit, and commit both together:

   ```bash
   git add README.md
   git commit -m "bump pinned pi to X.Y.Z"
   git tag vX.Y.Z
   git push && git push origin vX.Y.Z
   ```

## Rollback

If step 2 or 3 fails, revert and record why instead of silently retrying —
**both halves**, not just the local pin. Rolling back only
`package.json`/`package-lock.json` while leaving the global CLI on the
rejected version means every subsequent real `pi` session still runs the
version that just failed its own checks, and now also mismatches the
just-restored pin (exactly the drift `extensions/harness-pin.ts` exists to
warn about):

```bash
git checkout -- package.json package-lock.json
npm install
npm install -g @earendil-works/pi-coding-agent@<version noted in step 1>
pi --version   # must match the pre-bump version noted in step 1
```

A failed bump attempt is itself worth a line in the commit/PR description
that attempted it — the next person (or you, in six months) attempting the
same bump should not have to rediscover the same failure from scratch.
