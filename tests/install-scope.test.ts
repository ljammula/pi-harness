import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repo = resolve(import.meta.dirname, "..");

test("installer removes managed project and stack-skill globals, installs portable skills", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-install-"));
	const skills = join(home, ".pi/agent/skills");
	const extensions = join(home, ".pi/agent/extensions");
	await mkdir(skills, { recursive: true });
	await mkdir(extensions, { recursive: true });
	await symlink(join(repo, "skills/backend-dev"), join(skills, "backend-dev"));
	// Simulates a machine still holding the old-style global stack-skill link
	// (pre stack-skill-overlay.ts); install.sh must clean this up too.
	await symlink(join(repo, "skills/go-service"), join(skills, "go-service"));
	await symlink(join(repo, "extensions/continuation-nudge.ts"), join(extensions, "continuation-nudge.ts"));
	await symlink(join(repo, "extensions/co-change-suggest.ts"), join(extensions, "co-change-suggest.ts"));
	await execFileAsync("bash", [join(repo, "install.sh"), "--force"], { env: { ...process.env, HOME: home } });
	await assert.rejects(readlink(join(skills, "backend-dev")));
	await assert.rejects(readlink(join(skills, "go-service")));
	await assert.rejects(readlink(join(extensions, "continuation-nudge.ts")));
	await assert.rejects(readlink(join(extensions, "co-change-suggest.ts")));
	assert.equal(await readlink(join(skills, "tdd")), join(repo, "skills/tdd"));
	assert.equal(await readlink(join(skills, "before-done")), join(repo, "skills/before-done"));
	assert.equal(await readlink(join(extensions, "quality-gate.ts")), join(repo, "extensions/quality-gate.ts"));
	assert.equal(await readlink(join(extensions, "stack-skill-overlay.ts")), join(repo, "extensions/stack-skill-overlay.ts"));
	// Both detectors ship on-by-default (progress-stall-guard.ts includes its
	// default-on wall-clock backstop; wall-clock-budget-nudge.ts is inert unless
	// a caller sets PI_HARNESS_TIMEOUT_MINUTES) -- neither is disabled.
	assert.equal(await readlink(join(extensions, "progress-stall-guard.ts")), join(repo, "extensions/progress-stall-guard.ts"));
	assert.equal(await readlink(join(extensions, "wall-clock-budget-nudge.ts")), join(repo, "extensions/wall-clock-budget-nudge.ts"));
	assert.equal(await readlink(join(extensions, "shared-resource-overlay.ts")), join(repo, "extensions/shared-resource-overlay.ts"));
	// The registry it reads (harness-resources.json) names machine-local
	// paths -- install.sh must never create it; an absent file is the
	// documented no-op contract.
	await assert.rejects(access(join(home, ".pi/agent/harness-resources.json")));
});

test("install.sh is idempotent: rerunning without --force leaves existing correct links alone", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-install-idempotent-"));
	await execFileAsync("bash", [join(repo, "install.sh")], { env: { ...process.env, HOME: home } });
	const before = await readlink(join(home, ".pi/agent/AGENTS.md"));
	await execFileAsync("bash", [join(repo, "install.sh")], { env: { ...process.env, HOME: home } });
	assert.equal(await readlink(join(home, ".pi/agent/AGENTS.md")), before);
});
