import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Surfaces PROJECT_SKILLS only inside one specific project (identified by its
// git remote), instead of shipping into every session's system prompt
// regardless of repo -- same problem stack-skill-overlay.ts solves for the
// stack skills, via the same resources_discover mechanism.
//
// Config-driven rather than hardcoded to any one person's project: set
// PI_PROJECT_SKILLS_REMOTE to a pattern (used as a case-insensitive regex,
// falling back to a plain substring match if it isn't valid regex syntax)
// that matches your project's origin remote, e.g. "yourorg/yourrepo". Unset,
// this extension is a no-op.
const PROJECT_SKILLS = ["backend-dev", "frontend-dev", "feature-dev", "pr-remediate", "release", "self-review"];

export function matchesProjectRemote(remote: string, pattern: string): boolean {
	try {
		return new RegExp(pattern, "i").test(remote.trim());
	} catch {
		return remote.trim().toLowerCase().includes(pattern.toLowerCase());
	}
}

export async function resolveProjectSkillsRoot(extensionFile = import.meta.filename): Promise<string> {
	return resolve(dirname(await realpath(extensionFile)), "..", "skills");
}

export default function projectSkillOverlay(pi: ExtensionAPI): void {
	const pattern = process.env.PI_PROJECT_SKILLS_REMOTE?.trim();
	if (!pattern) return;

	pi.on("resources_discover", async (event) => {
		const remote = await pi.exec("git", ["remote", "get-url", "origin"], {
			cwd: event.cwd,
			timeout: 5000,
		}).catch(() => undefined);
		if (!remote || remote.code !== 0 || !matchesProjectRemote(remote.stdout, pattern)) return undefined;
		const skillsRoot = await resolveProjectSkillsRoot();
		return { skillPaths: PROJECT_SKILLS.map((name) => resolve(skillsRoot, name)) };
	});
}
