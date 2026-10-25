import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import verifyPack from "../extensions/verify-pack.ts";
import { ExtensionHarness, type ExecCall } from "./extension-api-harness.ts";

function result(code: number, stdout = "", stderr = "") {
	return { code, stdout, stderr, killed: false };
}

interface Fixture {
	cwd: string;
	recordsRoot: string;
	harness: ExtensionHarness;
	setDiff: (value: string) => void;
}

/** A fresh repo + records dir, wired with a git+bash exec stub. `bashResult`
 *  receives `setDiff` too, so the mid-run-edit test can mutate the diff
 *  from inside the same bash call that "runs" the verification command. */
async function setupFixture(
	bashResult: (call: ExecCall, setDiff: (value: string) => void) => ReturnType<typeof result> = () => result(0, "ok"),
): Promise<Fixture> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-verify-cwd-"));
	const recordsRoot = await mkdtemp(join(tmpdir(), "pi-verify-records-"));
	let currentDiff = "diff --git a/app.ts\n+x";
	const setDiff = (value: string) => { currentDiff = value; };
	const harness = new ExtensionHarness({
		cwd,
		exec: (call: ExecCall) => {
			const { command, args } = call;
			if (command === "git" && args[0] === "rev-parse") return result(0, "base\n");
			if (command === "git" && args[0] === "diff") return result(0, currentDiff);
			if (command === "git" && args[0] === "status") return result(0, " M app.ts\n");
			if (command === "bash") return bashResult(call, setDiff);
			return result(1);
		},
	});
	// Reviewer explicitly disabled rather than left to inherit the real
	// shell's env: this machine's own AI_REVIEW_BASE_URL/MODEL (set for
	// interactive use) would otherwise make these tests depend on ambient
	// env and hit a real network endpoint.
	verifyPack(harness.api, { recordsRoot, reviewerEnv: {} });
	return { cwd, recordsRoot, harness, setDiff };
}

test("registers the /verify command and a model-callable verify tool -- no event listeners, no turn gating", async () => {
	const { harness } = await setupFixture();
	assert.equal(harness.handlers.size, 0);
	assert.ok(harness.commands.has("verify"));
	assert.ok(harness.tools.has("verify"));
});

test("no canonical command found: skipped verification, NOT DONE", async () => {
	const { harness } = await setupFixture();
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /skipped:\s+verification\s+->\s+no canonical verification command found/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("passing canonical command records DONE", async () => {
	const { cwd, harness } = await setupFixture();
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+make verify\s+->\s+pass/);
	assert.match(message, /verdict:\s+DONE/);
	assert.equal(harness.execCalls.filter((call) => call.command === "bash").length, 1);
});

test("failing canonical command records NOT DONE with the failure", async () => {
	const { cwd, harness } = await setupFixture(() => result(1, "", "test failed: token=abc123"));
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@false\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+make verify\s+->\s+fail \(exit 1\)/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("a run killed by timeout or cancellation is inconclusive, never a pass", async () => {
	// `pi.exec` resolves a killed process with `code: 0` (no real exit code
	// to report) -- must not read as a pass for a run that never finished.
	const { cwd, harness } = await setupFixture(() => ({ code: 0, stdout: "", stderr: "", killed: true }));
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+make verify\s+->\s+inconclusive/);
	assert.ok(message.includes("killed before finishing"));
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("an unguarded pipe in the documented command is not flagged -- the run itself is always pipefail-wrapped", async () => {
	// Forcing `-o pipefail` on the actual exec (verify-pack.ts's own doing,
	// unconditionally) already neutralizes this specific masking reason, so
	// a genuinely passing `... | tee build.log`-shaped command must still
	// read as `pass`, not `inconclusive`.
	const { cwd, harness } = await setupFixture(() => result(0, "ok"));
	await writeFile(join(cwd, "AGENTS.md"), "Run the verify command: `npm test | tee build.log`\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+npm test \| tee build\.log\s+->\s+pass/);
	assert.match(message, /verdict:\s+DONE/);
});

test("an `|| true` fallback in the documented command is inconclusive, not pass", async () => {
	// Unlike the unguarded-pipe case above, pipefail does nothing for this --
	// `|| true` still neutralizes the real exit code regardless.
	const { cwd, harness } = await setupFixture(() => result(0, "ok"));
	await writeFile(join(cwd, "AGENTS.md"), "Run the verify command: `npm test || true`\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+npm test \|\| true\s+->\s+inconclusive \(or-fallback\)/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("a diff that changes mid-run is recorded stale, even if the check passed", async () => {
	const { cwd, harness } = await setupFixture((_call, setDiff) => {
		setDiff("diff --git a/app.ts\n+x\n+y"); // edited while the check ran
		return result(0, "ok");
	});
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /note:\s+diff changed during the run -- record is stale/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("/verify status reports the last record and whether the diff moved since", async () => {
	const fixture = await setupFixture();
	await writeFile(join(fixture.cwd, "Makefile"), "verify:\n\t@true\n");
	await fixture.harness.invokeCommand("verify", "");

	fixture.setDiff("diff --git a/app.ts\n+x\n+more");
	await fixture.harness.invokeCommand("verify", "status");
	const message = fixture.harness.notifications.at(-1)!.message;
	assert.match(message, /verdict:\s+DONE/);
	assert.match(message, /diff has changed since this record/);
});

test("/verify last prints the last record without rerunning anything", async () => {
	const { cwd, harness } = await setupFixture();
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const callsAfterRun = harness.execCalls.length;
	await harness.invokeCommand("verify", "last");
	assert.equal(harness.execCalls.length, callsAfterRun);
	assert.match(harness.notifications.at(-1)!.message, /verdict:\s+DONE/);
});

test("with no prior record, status and last say so instead of erroring", async () => {
	const { harness } = await setupFixture();
	await harness.invokeCommand("verify", "status");
	assert.match(harness.notifications.at(-1)!.message, /No \/verify record for this repo yet/);
	await harness.invokeCommand("verify", "last");
	assert.match(harness.notifications.at(-1)!.message, /No \/verify record for this repo yet/);
});

test("truncated captured output is inconclusive, never a pass", async () => {
	// `execResultWasTruncated` reads an extra `truncated` field pi.exec can
	// set beyond its typed ExecResult shape -- exit code alone no longer
	// proves the whole run was observed.
	const { cwd, harness } = await setupFixture(() => ({ code: 0, stdout: "", stderr: "", killed: false, truncated: true }) as ReturnType<typeof result>);
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+make verify\s+->\s+inconclusive/);
	assert.ok(message.includes("truncated"));
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("Node typecheck/lint scripts run as additional checks and can fail verdict even if tests pass", async () => {
	const { cwd, harness } = await setupFixture((call) => {
		const command = call.args[3];
		if (command === "npm test") return result(0, "tests ok");
		if (command === "npm run typecheck") return result(1, "", "TS2322: type error");
		if (command === "npm run lint") return result(0, "clean");
		return result(1);
	});
	await writeFile(
		join(cwd, "package.json"),
		JSON.stringify({ scripts: { test: "node test.js", typecheck: "tsc --noEmit", lint: "eslint ." } }),
	);
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /ran:\s+npm test\s+->\s+pass/);
	assert.match(message, /ran:\s+npm run typecheck\s+->\s+fail \(exit 1\)/);
	assert.match(message, /ran:\s+npm run lint\s+->\s+pass/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("an unavailable git diff snapshot blocks DONE even if the check passes", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-verify-cwd-"));
	const recordsRoot = await mkdtemp(join(tmpdir(), "pi-verify-records-"));
	const harness = new ExtensionHarness({
		cwd,
		exec: ({ command }: ExecCall) => {
			if (command === "git") return result(128, "", "fatal: not a git repository");
			if (command === "bash") return result(0, "ok");
			return result(1);
		},
	});
	verifyPack(harness.api, { recordsRoot, reviewerEnv: {} });
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");
	await harness.invokeCommand("verify", "");
	const message = harness.notifications.at(-1)!.message;
	assert.match(message, /note:\s+git diff snapshot unavailable -- evidence is not bound to a diff/);
	assert.match(message, /verdict:\s+NOT DONE/);
});

test("the verify tool runs the same check, model-callable mid-turn", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-verify-cwd-"));
	const recordsRoot = await mkdtemp(join(tmpdir(), "pi-verify-records-"));
	const harness = new ExtensionHarness({
		cwd,
		exec: ({ command, args }: ExecCall) => {
			if (command === "git" && args[0] === "rev-parse") return result(0, "base\n");
			if (command === "git" && args[0] === "diff") return result(0, "diff --git a/app.ts\n+x");
			if (command === "git" && args[0] === "status") return result(0, " M app.ts\n");
			if (command === "bash") return result(0, "ok");
			return result(1);
		},
	});
	verifyPack(harness.api, { recordsRoot, reviewerEnv: {} });
	await writeFile(join(cwd, "Makefile"), "verify:\n\t@true\n");

	const tool = harness.tools.get("verify");
	assert.ok(tool, "verify tool is registered");
	const toolResult = await tool.execute("call-1", {}, undefined, undefined, harness.context);
	const text = toolResult.content[0].text as string;
	assert.match(text, /ran:\s+make verify\s+->\s+pass/);
	assert.match(text, /verdict:\s+DONE/);
	assert.equal(toolResult.details.verdict, "DONE");
});
