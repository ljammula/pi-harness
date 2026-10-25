import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import projectSkillOverlay, { matchesProjectRemote, resolveProjectSkillsRoot } from "../extensions/project-skill-overlay.ts";
import { ExtensionHarness } from "./extension-api-harness.ts";

const ENV_KEY = "PI_PROJECT_SKILLS_REMOTE";

function withEnv<T>(value: string | undefined, fn: () => T): T {
	const prior = process.env[ENV_KEY];
	if (value === undefined) delete process.env[ENV_KEY];
	else process.env[ENV_KEY] = value;
	try {
		return fn();
	} finally {
		if (prior === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = prior;
	}
}

test("remote pattern matches as a case-insensitive regex, falling back to substring", () => {
	assert.equal(matchesProjectRemote("git@github.com:yourorg/yourrepo.git", "yourorg/yourrepo"), true);
	assert.equal(matchesProjectRemote("https://github.com/yourorg/yourrepo", "yourorg/yourrepo"), true);
	assert.equal(matchesProjectRemote("git@github.com:someoneelse/yourrepo.git", "^git@github.com:yourorg/"), false);
	assert.equal(matchesProjectRemote("https://github.com/example/backend", "yourorg/yourrepo"), false);
	// Invalid regex syntax degrades to a plain substring check instead of throwing.
	assert.equal(matchesProjectRemote("https://github.com/yourorg/your(repo", "yourorg/your(repo"), true);
});

test("skill root follows the extension symlink back to repository source", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-overlay-link-"));
	const installed = join(root, "agent", "extensions");
	await mkdir(installed, { recursive: true });
	const source = join(import.meta.dirname, "..", "extensions", "project-skill-overlay.ts");
	const link = join(installed, "project-skill-overlay.ts");
	await symlink(source, link);
	assert.equal(await resolveProjectSkillsRoot(link), join(import.meta.dirname, "..", "skills"));
});

test("unset PI_PROJECT_SKILLS_REMOTE makes this extension a no-op", async () => {
	withEnv(undefined, () => {
		const harness = new ExtensionHarness({ exec: () => ({ code: 0, stdout: "git@github.com:yourorg/yourrepo.git\n", stderr: "", killed: false }) });
		projectSkillOverlay(harness.api);
		assert.equal(harness.handlers.get("resources_discover"), undefined);
	});
});

test("unrelated repositories receive no project skill paths", async () => {
	await withEnv("yourorg/yourrepo", async () => {
		const harness = new ExtensionHarness({ exec: () => ({ code: 0, stdout: "https://github.com/example/backend.git\n", stderr: "", killed: false }) });
		projectSkillOverlay(harness.api);
		const [result] = await harness.emit({ type: "resources_discover", cwd: "/workspace", reason: "startup" } as any);
		assert.equal(result, undefined);
	});
});

test("the configured project keeps its project-scoped workflows", async () => {
	await withEnv("yourorg/yourrepo", async () => {
		const harness = new ExtensionHarness({ exec: () => ({ code: 0, stdout: "git@github.com:yourorg/yourrepo.git\n", stderr: "", killed: false }) });
		projectSkillOverlay(harness.api);
		const [result] = await harness.emit({ type: "resources_discover", cwd: "/workspace", reason: "startup" } as any);
		const paths = (result as { skillPaths: string[] }).skillPaths;
		assert.equal(paths.some((path) => path.endsWith("backend-dev")), true);
		assert.equal(paths.some((path) => path.endsWith("release")), true);
	});
});
