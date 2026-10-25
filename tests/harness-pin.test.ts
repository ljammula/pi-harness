import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import harnessPin, { resolveRunningVersion } from "../extensions/harness-pin.ts";
import { ExtensionHarness } from "./extension-api-harness.ts";

const repo = resolve(import.meta.dirname, "..");

test("matching versions produce no notify call", async () => {
	const harness = new ExtensionHarness();
	harnessPin(harness.api, {
		resolveRunningVersion: async () => "0.84.2",
		resolvePinnedVersion: async () => "0.84.2",
	});

	await harness.emit({ type: "session_start", reason: "startup" } as any);

	assert.equal(harness.notifications.length, 0);
	assert.equal(harness.entries.length, 0);
});

test("mismatched versions notify once naming both versions and record one trace entry", async () => {
	const harness = new ExtensionHarness();
	harnessPin(harness.api, {
		resolveRunningVersion: async () => "0.85.0",
		resolvePinnedVersion: async () => "0.84.2",
	});

	await harness.emit({ type: "session_start", reason: "startup" } as any);

	assert.equal(harness.notifications.length, 1);
	assert.match(harness.notifications[0].message, /0\.85\.0/);
	assert.match(harness.notifications[0].message, /0\.84\.2/);
	assert.equal(harness.notifications[0].type, "warning");

	assert.equal(harness.entries.length, 1);
	assert.equal(harness.entries[0].type, "pi-harness-trace");
	assert.deepEqual(harness.entries[0].data, {
		schemaVersion: 1,
		extensionVersion: "working-tree",
		sessionId: null,
		taskFixture: null,
		extension: "harness-pin",
		diffHash: null,
		event: "startup",
		outcome: "unconfigured",
		durationMs: 0,
		metadata: { running: "0.85.0", pinned: "0.84.2" },
	});
});

test("a non-startup session_start reason is ignored", async () => {
	const harness = new ExtensionHarness();
	harnessPin(harness.api, {
		resolveRunningVersion: async () => "0.85.0",
		resolvePinnedVersion: async () => "0.84.2",
	});

	await harness.emit({ type: "session_start", reason: "resume" } as any);

	assert.equal(harness.notifications.length, 0);
	assert.equal(harness.entries.length, 0);
});

test("resolveRunningVersion reads the actually-running pi install, not this repo's own node_modules copy", async () => {
	// Regression test for a real bug found live: an earlier implementation
	// used `import.meta.resolve` from this extension file's own location,
	// which -- when this repo is symlink-installed -- resolves to *this
	// repo's own* @earendil-works/pi-coding-agent devDependency copy, not
	// the real running pi engine. That made the check structurally unable
	// to ever observe the drift it exists to catch (this repo's pin vs. the
	// real global `pi` install), since both sides would always read from
	// the same repo checkout. Prove the fix by pointing process.argv[1] at
	// a fake "running pi engine" install, distinct from this repo's own
	// node_modules, and confirming that fake version wins.
	const fakeEngineDir = await mkdtemp(join(tmpdir(), "fake-pi-engine-"));
	await mkdir(join(fakeEngineDir, "dist"), { recursive: true });
	await writeFile(
		join(fakeEngineDir, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "7.7.7-fake-running-engine" }),
	);
	const fakeEntry = join(fakeEngineDir, "dist", "cli.js");
	await writeFile(fakeEntry, "// fake entry script for the test\n");

	const originalArgv1 = process.argv[1];
	process.argv[1] = fakeEntry;
	try {
		const running = await resolveRunningVersion();
		assert.equal(running, "7.7.7-fake-running-engine");
	} finally {
		process.argv[1] = originalArgv1;
	}
});

test("resolvePinnedVersion works through the real symlinked-install path (jiti + a symlink), not just a direct import", async () => {
	// Regression test for a real bug found by adversarial review: pi's real
	// extension loader (core/extensions/loader.js) loads extensions via
	// jiti (`jiti.import(extensionPath)`), and the path it hands jiti is
	// never realpath-resolved (`resolvePath()` upstream is a plain string
	// join). install.sh's actual deployment is a symlink at
	// `~/.pi/agent/extensions/harness-pin.ts` pointing back into this repo.
	// An earlier `resolvePinnedVersion()` built its path off
	// `import.meta.dirname` directly, which under jiti reflects the
	// *symlink's own* directory (real, but wrong -- one level above it has
	// no package.json at all), not this file's real location -- so it
	// always returned null in the one install method this repo ships,
	// permanently no-op'ing the whole version-mismatch check. Reproduce the
	// exact production load path here rather than trusting a plain
	// `import()` (which silently follows symlinks by default and would not
	// have caught this).
	const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
	const expectedPinned = pkg.devDependencies["@earendil-works/pi-coding-agent"];

	// No "./package.json" subpath is exported (same reason resolveRunningVersion
	// can't use it either) -- resolve the main entry, then walk up to the
	// package root the same way the extension itself does.
	let piCodingAgentDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	for (let i = 0; i < 6 && !(await readFile(join(piCodingAgentDir, "package.json"), "utf8").catch(() => null)); i++) {
		piCodingAgentDir = dirname(piCodingAgentDir);
	}
	const jitiEntry = join(piCodingAgentDir, "node_modules/jiti/lib/jiti.mjs");
	// jiti is pi-coding-agent's own dependency, colocated in its
	// node_modules -- exactly where its real loader.js imports it from
	// ("jiti/static" resolved relative to that same package). If this
	// path stops existing, pi-coding-agent restructured a dependency this
	// test (and the real loader) both rely on -- worth knowing loudly.
	const { createJiti } = await import(jitiEntry);

	const fakeHome = await mkdtemp(join(tmpdir(), "pi-harness-pin-symlink-"));
	const fakeExtDir = join(fakeHome, ".pi/agent/extensions");
	await mkdir(fakeExtDir, { recursive: true });
	await symlink(join(repo, "extensions/harness-pin.ts"), join(fakeExtDir, "harness-pin.ts"));
	await symlink(join(repo, "extensions/lib"), join(fakeExtDir, "lib"));

	const jiti = createJiti(import.meta.url, { moduleCache: false });
	const mod = await jiti.import(join(fakeExtDir, "harness-pin.ts"));
	const pinned = await mod.resolvePinnedVersion();

	assert.equal(pinned, expectedPinned);
});

test("never throws even when version resolution itself fails", async () => {
	const harness = new ExtensionHarness();
	harnessPin(harness.api, {
		resolveRunningVersion: async () => {
			throw new Error("module resolution boom");
		},
		resolvePinnedVersion: async () => "0.84.2",
	});

	await assert.doesNotReject(harness.emit({ type: "session_start", reason: "startup" } as any));

	assert.equal(harness.notifications.length, 0);
	assert.equal(harness.entries.length, 0);
});
