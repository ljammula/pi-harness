---
name: self-review
description: >
  Review one of your own PRs using a second GitHub account, then guarantee
  the switch back to your primary account. Trigger on: "self review", "review the PR",
  "review PR #N", "approve the PR", or any review action that needs the second account.
  User-triggered only — invoke via /self-review.
disable-model-invocation: true
---

# Self-Review

This skill **posts public review comments and approvals** and switches the machine-wide
`gh` account. Never fire it as a side effect of another task — the user invokes it
explicitly (`feature-dev` step 6 tells the user to run it; it does not auto-run).

Two-account flow: `<primary-account>` authors, `<review-account>` reviews. Configure
these two names for your own setup (e.g. in AGENTS.md) before using this skill — the
placeholders below are not real accounts. The invariant that must never break: **the
session ends with `<primary-account>` active**, even if the review fails midway. Every
exit path goes through step 5.

## 1. Record and switch

```bash
gh auth status                        # note the active account
gh auth switch --user <review-account>
```

Account permissions: `<review-account>` can submit reviews, approve, comment, and resolve
threads on `<primary-account>`-owned repos. It cannot push.

## 2. Review the diff

```bash
gh pr view <N> --repo <primary-account>/<repo>
gh pr diff <N> --repo <primary-account>/<repo>
```

**Optional local second opinion first** — on machines that can reach a local model, localhost or a LAN host via `AI_STACK_HOST` (check: `curl -sf --max-time 2 "http://${AI_STACK_HOST:-127.0.0.1}:8080/v1/models" >/dev/null`):

```bash
gh pr diff <N> --repo <primary-account>/<repo> | ~/.pi/agent/skills/before-done/scripts/local-review.sh
```

Treat its output as candidates to check, not confirmed findings — verify each against the actual diff yourself before posting. In Pi's default local configuration it is a blind second pass by the same model as the primary agent, not a differently-trained or independent reviewer. If the port isn't reachable, note it in one line (e.g. `local model unreachable - skipping local second opinion`) and proceed with your own review.

Apply the karpathy-guidelines criteria, in priority order:
1. Correctness bugs (logic, error handling, concurrency, edge cases)
2. Surgical scope — changed lines that don't trace to the PR's stated purpose
3. Simplicity — speculative abstractions, dead configurability
4. Project conventions (repo's own documented patterns: feature wiring, l10n coverage, sentinel errors)

## 3. Post findings

For each real issue, post an inline comment anchored to the file/line:

```bash
gh api repos/<primary-account>/<repo>/pulls/<N>/comments \
  -f body="..." -f commit_id=<head-sha> -f path=<file> -F line=<line>
```

If there are open findings, submit the review as `COMMENT` with a summary.
Do not approve with unresolved findings.

## 4. Approve when clean

When there are no findings, or all previous findings are fixed and re-verified:

```bash
gh pr review <N> --repo <primary-account>/<repo> --approve --body "..."
```

Always `APPROVE`, never a bare `COMMENT`, once all issues are resolved.

## 5. Switch back — unconditional

```bash
gh auth switch --user <primary-account>
gh auth status    # confirm <primary-account> is active before reporting done
```

Run this even if an earlier step errored or the review was abandoned. A report that
does not show `<primary-account>` active is not a completion report.

## Report

```
✓ Reviewed PR #N as <review-account> — M findings posted / approved
✓ Review state: COMMENT (M open) | APPROVED
✓ Account restored: <primary-account> active
```
