#!/bin/bash
# Symlink this repo into ~/.pi/agent/, where pi reads it from. Symlinking
# whole skill directories (not just SKILL.md) means scripts/ subdirs and
# future files stay live-synced automatically -- no separate copy step, ever.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE="${1:-}"

# Global skills adapted from https://github.com/mattpocock/skills for pi's
# single-agent, no-subagent, small-context constraints -- see
# skills/<name>/SKILL.md for what didn't port (code-review's parallel
# sub-agents, research's background agent). pre-pr-review and live-validation
# are harvested from Claude Code/software-factory practice (agent-configs).
PORTABLE_SKILLS=(tdd diagnosing-bugs resolving-merge-conflicts grill local-summarize docs-verify pre-pr-review live-validation)
# STACK_SKILLS is intentionally not globally linked: shipping all of these
# into every session's system prompt regardless of repo is measurable
# startup-token tax (see pi-harness-validation-status.md in the source
# project this was extracted from). stack-skill-overlay.ts loads only the
# ones a repo's own evidence matches, same pattern as PROJECT_SKILLS below.
# The names stay here as the canonical list this script un-links on upgrade
# from machines still holding old-style global symlinks.
STACK_SKILLS=(go-service python-service flutter-app typescript-service postgres-change kafka-processing temporal-go gcp-deploy)
# karpathy-guidelines is deliberately not linked into ~/.pi/agent/skills/:
# karpathy-guardrail.ts's before_agent_start hook already appends its
# guidance unconditionally every session, so also linking the skill would
# just advertise its name+description to pi's own relevance-matching a
# second time, redundant tax for guidance the session already has.
#
# PROJECT_SKILLS ship in this repo but are not linked globally by default:
# they encode one project's own workflow norms (see project-skill-overlay.ts
# and self-review/SKILL.md), not skills every repo you touch should get.
# project-skill-overlay.ts surfaces them per-project instead, gated on
# PI_PROJECT_SKILLS_REMOTE.
PROJECT_SKILLS=(backend-dev frontend-dev feature-dev pr-remediate release self-review)
DISABLED_EXTENSIONS=(co-change-suggest.ts continuation-nudge.ts)

link() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    echo "ok (already linked): $dst"
    return
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ "$FORCE" != "--force" ]]; then
      echo "skip (exists, not linked to this repo -- rerun with --force to replace): $dst" >&2
      return
    fi
    # Remove whatever is there first. `ln -sfn` cannot replace a non-empty
    # directory -- it nests the link inside it -- so an explicit rm is the
    # only way to force-replace a real dir (or a wrong/dangling symlink).
    rm -rf "$dst"
  fi
  ln -s "$src" "$dst"
  echo "linked: $dst -> $src"
}

link_skills() {
  local source_root="$1" target_root="$2"
  shift 2
  for name in "$@"; do
    [[ -d "$source_root/$name" ]] || continue
    link "$source_root/$name" "$target_root/$name"
  done
}

unlink_managed_skills() {
  local target_root="$1" source_root="$2"
  shift 2
  for name in "$@"; do
    local target="$target_root/$name"
    if [[ -L "$target" && "$(readlink "$target")" == "$source_root/$name" ]]; then
      rm "$target"
      echo "unlinked project-specific global skill: $target"
    fi
  done
}

# Skills auto-discover from ~/.pi/agent/skills/<name>/SKILL.md; extensions
# from ~/.pi/agent/extensions/<name>.ts or <name>/index.ts load unconditionally
# at startup, no project trust required; global instructions from
# ~/.pi/agent/AGENTS.md; prompt templates from ~/.pi/agent/prompts/<name>.md
# become /<name> slash commands.
#
# ~/.pi/agent/settings.json is deliberately NOT linked: pi rewrites it itself
# (/settings, package installs, lastChangelogVersion), so a symlink into this
# repo would mean pi editing tracked files behind your back. See README.md
# for the settings a fresh install expects, and settings.json here for a
# reference starting point to copy from.
link "$REPO_ROOT/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
unlink_managed_skills "$HOME/.pi/agent/skills" "$REPO_ROOT/skills" "${PROJECT_SKILLS[@]}" "${STACK_SKILLS[@]}" karpathy-guidelines
link_skills "$REPO_ROOT/skills" "$HOME/.pi/agent/skills" "${PORTABLE_SKILLS[@]}"
link "$REPO_ROOT/skills/before-done" "$HOME/.pi/agent/skills/before-done"
link "$REPO_ROOT/skills/wiring-verify" "$HOME/.pi/agent/skills/wiring-verify"
for f in "$REPO_ROOT"/extensions/*.ts; do
  name="$(basename "$f")"
  if [[ " ${DISABLED_EXTENSIONS[*]} " == *" $name "* ]]; then
    target="$HOME/.pi/agent/extensions/$name"
    if [[ -L "$target" && "$(readlink "$target")" == "$f" ]]; then
      rm "$target"
      echo "unlinked evidence-gated extension: $target"
    fi
    continue
  fi
  link "$REPO_ROOT/extensions/$name" "$HOME/.pi/agent/extensions/$name"
done
for d in "$REPO_ROOT"/extensions/*/; do
  name="$(basename "$d")"
  link "$REPO_ROOT/extensions/$name" "$HOME/.pi/agent/extensions/$name"
done
for f in "$REPO_ROOT"/prompts/*.md; do
  name="$(basename "$f")"
  link "$REPO_ROOT/prompts/$name" "$HOME/.pi/agent/prompts/$name"
done

echo "done."
