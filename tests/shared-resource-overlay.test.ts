import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharedResourceOverlay from "../extensions/shared-resource-overlay.ts";
import { ExtensionHarness } from "./extension-api-harness.ts";

// The extension realpaths every registry root (so a symlinked root works the
// way install.sh's links do) -- macOS's /tmp is itself a symlink to
// /private/tmp, so a raw mkdtemp() result must be realpath'd too before it's
// used to build an expected path, or the two disagree on that symlink alone.
async function tempDir(prefix: string): Promise<string> {
	return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

async function writeSkill(root: string, name: string): Promise<void> {
	const dir = join(root, "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test skill\n---\nbody\n`);
}

async function writePrompt(root: string, name: string): Promise<void> {
	const dir = join(root, "prompts");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${name}.md`), "---\ndescription: test prompt\n---\nbody\n");
}

async function setupRegistry(entries: unknown): Promise<{ home: string; registryPath: string }> {
	const home = await mkdtemp(join(tmpdir(), "pi-shared-resource-"));
	const registryPath = join(home, "harness-resources.json");
	await writeFile(registryPath, JSON.stringify(entries));
	return { home, registryPath };
}

async function discover(harness: ExtensionHarness) {
	const [result] = await harness.emit({ type: "resources_discover", cwd: harness.context.cwd, reason: "startup" } as any);
	return result as { skillPaths: string[]; promptPaths: string[] } | undefined;
}

test("no registry file: the hook returns undefined, a true no-op", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-shared-resource-"));
	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath: join(home, "does-not-exist.json"), ownSkillsRoot: home, globalSkillsRoot: home });
	assert.equal(await discover(harness), undefined);
});

test("a registry read failure other than ENOENT warns instead of silently no-oping", async () => {
	// Point the "registry path" at a directory: readFile on it fails with
	// EISDIR, not ENOENT -- a real misconfiguration, distinct from "nothing
	// configured", and must not be swallowed the same way.
	const home = await mkdtemp(join(tmpdir(), "pi-shared-resource-"));
	const registryPath = join(home, "a-directory");
	await mkdir(registryPath);
	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	assert.equal(await discover(harness), undefined);
	assert.ok(harness.notifications.some((n) => n.message.includes("could not be read")));
});

test("one existing and one missing entry: one skillPaths entry, one warning", async () => {
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "present-skill");
	const { registryPath, home } = await setupRegistry([{ root: otherRepo, skills: ["present-skill", "missing-skill"] }]);

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	const result = await discover(harness);

	assert.deepEqual(result?.skillPaths, [join(otherRepo, "skills", "present-skill")]);
	assert.equal(harness.notifications.filter((n) => n.message.includes("skill not found")).length, 1);
});

test("prompts resolve the same way, missing prompt warns", async () => {
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writePrompt(otherRepo, "present-prompt");
	const { registryPath, home } = await setupRegistry([{ root: otherRepo, prompts: ["present-prompt", "missing-prompt"] }]);

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	const result = await discover(harness);

	assert.deepEqual(result?.promptPaths, [join(otherRepo, "prompts", "present-prompt.md")]);
	assert.equal(harness.notifications.filter((n) => n.message.includes("prompt not found")).length, 1);
});

test("a name collision with this repo's own skills is traced, naming the winner", async () => {
	// "tdd" is a real, always-linked PORTABLE_SKILLS entry (install.sh links
	// it into ~/.pi/agent/skills/ unconditionally) -- unlike
	// karpathy-guidelines below, a directory collision here really is a
	// same-named skill that actually loads.
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "tdd");
	const { registryPath } = await setupRegistry([{ root: otherRepo, skills: ["tdd"] }]);
	const globalSkillsRoot = await mkdtemp(join(tmpdir(), "pi-shared-resource-global-"));

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, globalSkillsRoot }); // ownSkillsRoot defaults to this repo's real skills/
	const result = await discover(harness);

	assert.deepEqual(result?.skillPaths, [join(otherRepo, "skills", "tdd")]);
	const trace = harness.entries.find((e) => e.type === "pi-harness-trace") as { data: any } | undefined;
	assert.equal(trace?.data.event, "routing");
	assert.equal(trace?.data.metadata.wins, "this repo's skills/");
});

test("karpathy-guidelines never traces a false collision against this repo's own skills/", async () => {
	// This repo really does have skills/karpathy-guidelines/ on disk, but
	// install.sh deliberately never links it anywhere -- karpathy-guardrail.ts
	// injects the same guidance as a system-prompt string instead. Directory
	// existence alone must not be read as "this repo's copy would shadow the
	// registry's," since this repo's copy is never loaded as a skill at all.
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "karpathy-guidelines");
	const { registryPath } = await setupRegistry([{ root: otherRepo, skills: ["karpathy-guidelines"] }]);
	const globalSkillsRoot = await mkdtemp(join(tmpdir(), "pi-shared-resource-global-"));

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, globalSkillsRoot }); // ownSkillsRoot defaults to this repo's real skills/
	const result = await discover(harness);

	assert.deepEqual(result?.skillPaths, [join(otherRepo, "skills", "karpathy-guidelines")]);
	assert.equal(harness.entries.some((e) => e.type === "pi-harness-trace"), false);
});

test("karpathy-guidelines still traces a real collision against the global skills dir", async () => {
	// The own-skills-root exception is narrow: a genuinely separate copy at
	// ~/.pi/agent/skills/karpathy-guidelines (not this repo's, e.g. hand-
	// symlinked from elsewhere) is a real collision and must still be traced.
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "karpathy-guidelines");
	const globalSkillsRoot = await mkdtemp(join(tmpdir(), "pi-shared-resource-global-"));
	await mkdir(join(globalSkillsRoot, "karpathy-guidelines"), { recursive: true });
	const { registryPath } = await setupRegistry([{ root: otherRepo, skills: ["karpathy-guidelines"] }]);

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, globalSkillsRoot });
	await discover(harness);

	const trace = harness.entries.find((e) => e.type === "pi-harness-trace") as { data: any } | undefined;
	assert.equal(trace?.data.metadata.wins, "~/.pi/agent/skills/");
});

test("a collision with the global skills dir is traced too", async () => {
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "shared-thing");
	const globalSkillsRoot = await mkdtemp(join(tmpdir(), "pi-shared-resource-global-"));
	await mkdir(join(globalSkillsRoot, "shared-thing"), { recursive: true });
	const { registryPath, home } = await setupRegistry([{ root: otherRepo, skills: ["shared-thing"] }]);

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot });
	await discover(harness);

	const trace = harness.entries.find((e) => e.type === "pi-harness-trace") as { data: any } | undefined;
	assert.equal(trace?.data.metadata.wins, "~/.pi/agent/skills/");
});

test("no collision: no routing trace at all", async () => {
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "unique-skill");
	const { registryPath, home } = await setupRegistry([{ root: otherRepo, skills: ["unique-skill"] }]);

	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	await discover(harness);

	assert.equal(harness.entries.some((e) => e.type === "pi-harness-trace"), false);
});

test("a root that does not exist is skipped with a warning, not a crash", async () => {
	const missingRoot = join(tmpdir(), "pi-shared-resource-does-not-exist");
	const { registryPath, home } = await setupRegistry([{ root: missingRoot, skills: ["anything"] }]);
	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	assert.equal(await discover(harness), undefined);
	assert.ok(harness.notifications.some((n) => n.message.includes("root does not exist")));
});

test("malformed JSON and a non-array registry are both ignored with a warning", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-shared-resource-"));
	const badJsonPath = join(home, "bad.json");
	await writeFile(badJsonPath, "{ not json");
	const harness1 = new ExtensionHarness();
	sharedResourceOverlay(harness1.api, { registryPath: badJsonPath, ownSkillsRoot: home, globalSkillsRoot: home });
	assert.equal(await discover(harness1), undefined);
	assert.ok(harness1.notifications.some((n) => n.message.includes("not valid JSON")));

	const notArrayPath = join(home, "not-array.json");
	await writeFile(notArrayPath, JSON.stringify({ root: "x" }));
	const harness2 = new ExtensionHarness();
	sharedResourceOverlay(harness2.api, { registryPath: notArrayPath, ownSkillsRoot: home, globalSkillsRoot: home });
	assert.equal(await discover(harness2), undefined);
	assert.ok(harness2.notifications.some((n) => n.message.includes("must be a JSON array")));
});

test("an entry without a root string is skipped, the rest of the registry still loads", async () => {
	const otherRepo = await tempDir("pi-shared-resource-root-");
	await writeSkill(otherRepo, "fine-skill");
	const { registryPath, home } = await setupRegistry([{ skills: ["oops"] }, { root: otherRepo, skills: ["fine-skill"] }]);
	const harness = new ExtensionHarness();
	sharedResourceOverlay(harness.api, { registryPath, ownSkillsRoot: home, globalSkillsRoot: home });
	const result = await discover(harness);
	assert.deepEqual(result?.skillPaths, [join(otherRepo, "skills", "fine-skill")]);
});
