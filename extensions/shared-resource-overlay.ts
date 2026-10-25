/**
 * Cross-project resource discovery (plan-2026-09-11.md piece 3): loads
 * skills/prompts that already exist in another config repo (`hermes-config`,
 * `agent-configs`) into a pi session for any project, via one declared
 * registry, instead of a second hand-written copy per repo -- the
 * `karpathy-guidelines`/`wiring-verify` duplication the plan documents as
 * real, not hypothetical.
 *
 * Registry file, not settings sprawl: `~/.pi/agent/harness-resources.json`,
 * a JSON array of `{root, skills?, prompts?}` entries, e.g.
 * `[{"root": "~/code/hermes-config", "skills": ["karpathy-guidelines"]}]`.
 * Kept outside this repo because it names machine-local paths -- the class
 * of content README's extraction note says was removed from this release.
 * Absent file means no-op, same contract as `PI_PROJECT_SKILLS_REMOTE`
 * (project-skill-overlay.ts).
 *
 * An explicit allowlist per root, never "load everything under that
 * directory": `hermes-config/skills/` holds ~30 skills, most
 * Hermes-specific, and globbing it in would recreate the startup-token tax
 * stack-skill-overlay.ts exists to avoid.
 *
 * Extensions are deliberately not shared this way: pi's `resources_discover`
 * hook cannot contribute extension paths, and an extension from another repo
 * would need this repo's `lib/` on its import path anyway.
 *
 * Collision policy: pi keeps the first skill found on a name collision and
 * only warns (skills.md: "Name collisions ... warn and keep the first skill
 * found"). Internally, a registry-contributed path is always merged in
 * *after* pi's own natively-discovered skill paths
 * (`DefaultResourceLoader.extendResources` calls `mergePaths(lastSkillPaths,
 * extensionSkillPaths)`, primary first) -- so a same-named local skill
 * always wins, unconditionally. There is no hook available to change that
 * ordering from inside `resources_discover`, so unlike the plan's original
 * text, this does not implement a `"prefer": true` override: that would be
 * a flag that silently does nothing, which is worse than not offering it.
 * What this *does* do is make a collision visible instead of silently
 * shadowed: a `routing` trace names which copy wins whenever a registry
 * skill collides with one already in this repo's own `skills/` or the
 * global `~/.pi/agent/skills/` -- with one exception, see
 * `NEVER_LOADED_FROM_OWN_SKILLS_ROOT`'s own doc comment: a directory
 * existing in this repo's `skills/` does not always mean it is ever
 * actually loaded as a skill.
 */
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendHarnessTrace } from "./lib/harness-telemetry.ts";

interface RegistryEntry {
	root: string;
	skills?: string[];
	prompts?: string[];
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(() => true, () => false);
}

function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function resolveOwnSkillsRoot(extensionFile = import.meta.filename): Promise<string> {
	return resolve(dirname(await realpath(extensionFile)), "..", "skills");
}

// `karpathy-guidelines` has a real directory under this repo's own `skills/`,
// but install.sh deliberately never links it into `~/.pi/agent/skills/` (see
// its own comment) -- `karpathy-guardrail.ts` injects the same guidance as a
// system-prompt string on every session instead, so this repo's copy is
// never contributed to any session's skillPaths through the skill-loading
// mechanism at all. Directory-existence alone would misreport a collision
// that can never actually happen: the registry-contributed copy would be the
// *only* one ever loaded, not the loser of a shadowing it never enters.
const NEVER_LOADED_FROM_OWN_SKILLS_ROOT = new Set(["karpathy-guidelines"]);

async function collisionSource(name: string, ownSkillsRoot: string, globalSkillsRoot: string): Promise<string | undefined> {
	if (!NEVER_LOADED_FROM_OWN_SKILLS_ROOT.has(name) && (await exists(join(ownSkillsRoot, name)))) return "this repo's skills/";
	if (await exists(join(globalSkillsRoot, name))) return "~/.pi/agent/skills/";
	return undefined;
}

export default function sharedResourceOverlay(
	pi: ExtensionAPI,
	deps: { registryPath?: string; ownSkillsRoot?: string; globalSkillsRoot?: string } = {},
): void {
	const registryPath = deps.registryPath ?? join(homedir(), ".pi", "agent", "harness-resources.json");
	const globalSkillsRoot = deps.globalSkillsRoot ?? join(homedir(), ".pi", "agent", "skills");

	pi.on("resources_discover", async (_event, ctx) => {
		let body: string;
		try {
			body = await readFile(registryPath, "utf8");
		} catch (error) {
			// Only a genuinely absent file is the documented no-op contract.
			// Anything else (permission denied, the path being a directory, a
			// transient I/O error) is a real misconfiguration that would
			// otherwise silently drop every registry-shared resource with no
			// way to notice -- warn instead of treating it the same as
			// "nothing configured".
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
				ctx.ui.notify(`harness-resources.json could not be read -- ignoring it: ${registryPath} (${(error as Error).message})`, "warning");
			}
			return undefined;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			ctx.ui.notify(`harness-resources.json is not valid JSON -- ignoring it: ${registryPath}`, "warning");
			return undefined;
		}
		if (!Array.isArray(parsed)) {
			ctx.ui.notify(`harness-resources.json must be a JSON array of {root, skills, prompts} entries -- ignoring it: ${registryPath}`, "warning");
			return undefined;
		}

		const ownSkillsRoot = deps.ownSkillsRoot ?? (await resolveOwnSkillsRoot());
		const skillPaths: string[] = [];
		const promptPaths: string[] = [];

		for (const raw of parsed) {
			if (!raw || typeof raw !== "object" || typeof (raw as { root?: unknown }).root !== "string") {
				ctx.ui.notify(`harness-resources.json entry is missing a "root" string -- skipping it: ${JSON.stringify(raw)}`, "warning");
				continue;
			}
			const entry = raw as RegistryEntry;
			const realRoot = await realpath(expandHome(entry.root)).catch(() => undefined);
			if (!realRoot) {
				ctx.ui.notify(`harness-resources.json root does not exist -- skipping it: ${entry.root}`, "warning");
				continue;
			}

			for (const name of asStringArray(entry.skills)) {
				const candidate = join(realRoot, "skills", name);
				if (!(await exists(candidate))) {
					ctx.ui.notify(`harness-resources.json skill not found -- skipping it: ${candidate}`, "warning");
					continue;
				}
				skillPaths.push(candidate);
				const wins = await collisionSource(name, ownSkillsRoot, globalSkillsRoot);
				if (wins) {
					appendHarnessTrace(pi, {
						extension: "shared-resource-overlay",
						diffHash: null,
						event: "routing",
						outcome: "blocked",
						durationMs: 0,
						metadata: { name, registryRoot: entry.root, wins },
					});
				}
			}

			for (const name of asStringArray(entry.prompts)) {
				const candidate = join(realRoot, "prompts", `${name}.md`);
				if (await exists(candidate)) promptPaths.push(candidate);
				else ctx.ui.notify(`harness-resources.json prompt not found -- skipping it: ${candidate}`, "warning");
			}
		}

		if (skillPaths.length === 0 && promptPaths.length === 0) return undefined;
		return { skillPaths, promptPaths };
	});
}
