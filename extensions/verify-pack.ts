/**
 * `/verify` -- the evidence-loop piece of plan-2026-09-11.md (piece 2): a
 * durable, machine-run record of the same checks `before-done` already
 * describes by hand, bound to the diff it postdates. Registered as both a
 * real command (the same reason `/goal` in goal-gate.ts is one) and a
 * model-callable tool with identical behavior: a command because it needs
 * to run commands, hold the result across the call, and write a record
 * (none of which a `.md` prompt template can do); a tool too because a
 * prompt template's own turn (e.g. `/before-done`'s) is handled entirely by
 * the model, and a model cannot invoke another registered slash command
 * mid-turn -- `input` events sourced from `sendUserMessage` explicitly skip
 * slash-command dispatch (pi's own extensions.md, "Route by source"), and
 * there is no other path from inside a turn to a command handler. Without
 * the tool, `prompts/before-done.md` telling the model to "run /verify"
 * would be an instruction the model has no way to carry out.
 *
 * Two design constraints carried over from the plan (decisions 5-6):
 *  - This never gates a turn or queues a follow-up. It records; the model
 *    (or a human) reads the record and decides what to do next. No
 *    `turn_end`/`agent_end` listener, no `sendUserMessage`.
 *  - It runs the checks itself via `pi.exec`. `prompts/before-done.md`
 *    exists because a model told to run a gate will sometimes report
 *    success without running anything -- a record is only durable evidence
 *    if the record-writer ran the command, not the model narrating it.
 *
 * One deliberate narrowing versus the plan's step list: this runs the
 * repo's resolved canonical command plus, for a Node package, any
 * separately defined `typecheck`/`lint` scripts (see
 * `packageJsonScriptChecks`'s own doc comment for why those two and not a
 * broader formatter/lint sequence) -- not a full independent
 * formatter/lint/test sequence for every ecosystem. Synthesizing a
 * generic formatter/lint invocation for the manifest-default ladder
 * (a bare `pytest`, `cargo test`, ...) would mean guessing at commands
 * this repo has no evidence for.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { requestReview, resolveReviewerConfig } from "./cross-model-review.ts";
import { appendHarnessTrace, type HarnessOutcome } from "./lib/harness-telemetry.ts";
import { redactFailureOutput } from "./lib/redact.ts";
import {
	buildReviewDiff,
	execResultWasTruncated,
	explainVerificationMasking,
	packageJsonScriptChecks,
	resolveDiffTarget,
	resolveVerificationCommand,
	snapshotDiff,
	UNAVAILABLE_DIFF_HASH,
} from "./lib/verification.ts";

type StepStatus = "pass" | "fail" | "inconclusive" | "skipped";

interface VerifyStep {
	name: string;
	status: StepStatus;
	command?: string;
	reason?: string;
	exitCode?: number;
	durationMs?: number;
	output?: string;
}

interface VerifyRecord {
	schemaVersion: 1;
	timestamp: string;
	cwd: string;
	diffHashBefore: string;
	diffHashAfter: string;
	material: boolean;
	stale: boolean;
	diffUnavailable: boolean;
	steps: VerifyStep[];
	verdict: "DONE" | "NOT DONE";
}

function commandHash(command: string): string {
	return createHash("sha256").update(command).digest("hex").slice(0, 16);
}

// Records live outside the project tree (plan 2.3): a `/verify` record
// committed into a client repo is noise, and `appendHarnessTrace` already
// puts the summary into the session file. Keyed by cwd path, not repo name
// alone, so two differently-located repos that happen to share a directory
// name don't collide.
function repoSlug(cwd: string): string {
	const base = cwd.split("/").filter(Boolean).at(-1) ?? "repo";
	const sanitized = base.replace(/[^a-zA-Z0-9._-]+/g, "-");
	const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
	return `${sanitized}-${hash}`;
}

async function readLastRecord(
	recordsRoot: string,
	cwd: string,
): Promise<{ record: VerifyRecord; path: string } | undefined> {
	const dir = join(recordsRoot, repoSlug(cwd));
	const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
	const latest = files.at(-1);
	if (!latest) return undefined;
	const path = join(dir, latest);
	try {
		return { record: JSON.parse(await readFile(path, "utf8")) as VerifyRecord, path };
	} catch {
		return undefined;
	}
}

function formatRecord(record: VerifyRecord, recordPath: string): string {
	const lines = record.steps.map((step) => {
		if (step.status === "skipped") return `skipped:  ${step.name}  -> ${step.reason ?? "not run"}`;
		const label = step.command ?? step.name;
		const detail =
			step.status === "pass"
				? "pass"
				: step.status === "inconclusive"
					? `inconclusive${step.reason ? ` (${step.reason})` : ""}`
					: `fail (exit ${step.exitCode ?? "?"})`;
		return `ran:      ${label}  -> ${detail}`;
	});
	if (record.diffUnavailable) lines.push("note:     git diff snapshot unavailable -- evidence is not bound to a diff");
	if (record.stale) lines.push("note:     diff changed during the run -- record is stale");
	lines.push(`verdict:  ${record.verdict}`);
	lines.push(`record:   ${recordPath}`);
	return lines.join("\n");
}

interface RunDeps {
	reviewerEnv: NodeJS.ProcessEnv;
	fetchImpl: typeof fetch;
}

async function runShellCheck(pi: ExtensionAPI, ctx: ExtensionContext, name: string, command: string): Promise<VerifyStep> {
	const startedAt = Date.now();
	const result = await pi
		.exec("bash", ["-o", "pipefail", "-lc", command], { cwd: ctx.cwd, timeout: 20 * 60_000, signal: ctx.signal })
		.catch(() => undefined);
	const output = redactFailureOutput(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
	// The exec above always forces `-o pipefail` itself, which already
	// neutralizes the "unguarded-pipe" masking reason -- re-checking for it
	// here would flag a repo's own `... | tee build.log`-shaped command as
	// permanently unrunnable even though it exits correctly under the forced
	// wrapper. Other masking shapes (`|| true`, a trailing `; echo done`, a
	// leading `!`) are not fixed by pipefail, so those still make the result
	// inconclusive.
	const masking = explainVerificationMasking(command);
	const maskable = masking.masks && masking.reason !== "unguarded-pipe";
	// `pi.exec` resolves with `code: 0` for a process it had to kill on
	// timeout/cancellation (no exit code to report), which would otherwise
	// read as a pass for a run that never actually finished. A captured
	// output that hit its own truncation limit is the same shape as a
	// masked pipeline: the exit code no longer proves the whole run was
	// observed.
	const killed = Boolean(result?.killed);
	const truncated = Boolean(result && execResultWasTruncated(result));
	const reason = killed
		? "command was killed before finishing (timeout or cancellation)"
		: truncated
			? "captured output was truncated"
			: maskable
				? masking.reason
				: undefined;
	return {
		name,
		status: killed || truncated || maskable ? "inconclusive" : result?.code === 0 ? "pass" : "fail",
		command,
		exitCode: result?.code,
		durationMs: Date.now() - startedAt,
		...(reason ? { reason } : {}),
		...(output ? { output } : {}),
	};
}

function worstStatus(steps: VerifyStep[]): StepStatus {
	if (steps.length === 0 || steps.every((step) => step.status === "skipped")) return "skipped";
	if (steps.some((step) => step.status === "fail")) return "fail";
	if (steps.some((step) => step.status === "inconclusive")) return "inconclusive";
	return "pass";
}

// The canonical command plus, for a Node package, any separately defined
// `typecheck`/`lint` scripts it doesn't already cover on its own -- see
// packageJsonScriptChecks's doc comment. Every one of these is a
// deterministic pass/fail requirement for `verdict`; only the review step
// below is advisory.
async function runCanonicalChecks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<VerifyStep[]> {
	const canonical = await resolveVerificationCommand(ctx.cwd).catch(() => undefined);
	if (!canonical) return [{ name: "verification", status: "skipped", reason: "no canonical verification command found" }];

	const extraChecks = await packageJsonScriptChecks(ctx.cwd).catch(() => []);
	return Promise.all([
		runShellCheck(pi, ctx, "verification", canonical),
		...extraChecks.map((check) => runShellCheck(pi, ctx, check.name, check.command)),
	]);
}

// Second opinion, same as quality-gate.ts's own use of this module: a
// same-route reviewer stays disabled unless explicitly opted into, and a
// flagged verdict is evidence to investigate, not authority over the
// deterministic checks above -- it never affects `verdict` below (see
// skills/before-done/SKILL.md step 6's identical framing).
async function runReviewStep(pi: ExtensionAPI, ctx: ExtensionContext, deps: RunDeps): Promise<VerifyStep> {
	const reviewConfig = resolveReviewerConfig(deps.reviewerEnv);
	if (!reviewConfig.enabled) return { name: "independent-review", status: "skipped", reason: reviewConfig.reason ?? "disabled" };

	const target = await resolveDiffTarget(pi, ctx.cwd);
	const diff = await buildReviewDiff(pi, ctx.cwd, target).catch(() => "");
	if (!diff) return { name: reviewConfig.kind, status: "skipped", reason: "no diff to review" };

	const startedAt = Date.now();
	const review = await requestReview(
		reviewConfig,
		"Review this diff for correctness bugs the verification command's tests might miss.",
		diff,
		ctx.signal,
		deps.fetchImpl,
	);
	return {
		name: reviewConfig.kind,
		status: review.outcome === "clean" ? "pass" : review.outcome === "flagged" ? "fail" : "inconclusive",
		durationMs: Date.now() - startedAt,
		...(review.reason ? { reason: review.reason } : {}),
		...(review.text ? { output: review.text.slice(0, 3000) } : {}),
	};
}

async function runVerification(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	recordsRoot: string,
	deps: RunDeps,
): Promise<{ record: VerifyRecord; recordPath: string }> {
	const before = await snapshotDiff(pi, ctx.cwd);
	// The two branches are independent of each other -- run concurrently so
	// a configured review (up to REVIEW_TIMEOUT_MS) doesn't serialize behind
	// a slow canonical command (up to 20 minutes), or vice versa.
	const [canonicalSteps, reviewStep] = await Promise.all([
		runCanonicalChecks(pi, ctx),
		runReviewStep(pi, ctx, deps),
	]);
	const steps = [...canonicalSteps, reviewStep];

	const after = await snapshotDiff(pi, ctx.cwd);
	const stale = before.hash !== after.hash;
	// A git failure (non-git cwd, a transient git error) makes both
	// snapshots resolve to the same sentinel hash, which would otherwise
	// read as "stable, so not stale" -- evidence that was never actually
	// bound to a diff at all must not earn DONE either.
	const diffUnavailable = before.hash === UNAVAILABLE_DIFF_HASH || after.hash === UNAVAILABLE_DIFF_HASH;
	const overall = worstStatus(canonicalSteps);
	const verdict: VerifyRecord["verdict"] = overall === "pass" && !stale && !diffUnavailable ? "DONE" : "NOT DONE";

	const record: VerifyRecord = {
		schemaVersion: 1,
		timestamp: new Date().toISOString(),
		cwd: ctx.cwd,
		diffHashBefore: before.hash,
		diffHashAfter: after.hash,
		material: before.material,
		stale,
		diffUnavailable,
		steps,
		verdict,
	};

	const dir = join(recordsRoot, repoSlug(ctx.cwd));
	await mkdir(dir, { recursive: true });
	const recordPath = join(dir, `${record.timestamp.replace(/[:.]/g, "-")}-${before.hash.slice(0, 12)}.json`);
	await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

	const traceOutcome: HarnessOutcome = diffUnavailable
		? "inconclusive"
		: stale
			? "stale"
			: overall === "skipped"
				? "unconfigured"
				: (overall as HarnessOutcome);
	const primaryCommand = canonicalSteps.find((step) => step.name === "verification")?.command;
	appendHarnessTrace(pi, {
		extension: "verify-pack",
		diffHash: after.hash,
		event: "verification",
		outcome: traceOutcome,
		durationMs: steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0),
		metadata: {
			verdict: record.verdict,
			commandHash: primaryCommand ? commandHash(primaryCommand) : null,
			reviewKind: reviewStep.name,
		},
	});

	return { record, recordPath };
}

export default function verifyPack(
	pi: ExtensionAPI,
	deps: { recordsRoot?: string; reviewerEnv?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): void {
	const recordsRoot = deps.recordsRoot ?? join(homedir(), ".pi", "agent", "verify");
	const runDeps: RunDeps = { reviewerEnv: deps.reviewerEnv ?? process.env, fetchImpl: deps.fetchImpl ?? fetch };

	pi.registerCommand("verify", {
		description: "Run this repo's canonical verification command and record the result",
		handler: async (rawArgs, ctx) => {
			const args = rawArgs.trim();

			if (/^(status|last)$/i.test(args)) {
				const last = await readLastRecord(recordsRoot, ctx.cwd);
				if (!last) {
					ctx.ui.notify("No /verify record for this repo yet. Run /verify.", "info");
					return;
				}
				if (/^status$/i.test(args)) {
					const current = await snapshotDiff(pi, ctx.cwd);
					const staleNow = current.hash !== last.record.diffHashAfter;
					ctx.ui.notify(
						formatRecord(last.record, last.path) +
							(staleNow ? "\nnote:     diff has changed since this record" : ""),
						"info",
					);
					return;
				}
				ctx.ui.notify(formatRecord(last.record, last.path), "info");
				return;
			}

			if (args) {
				ctx.ui.notify(`Unknown /verify argument: "${args}". Usage: /verify | /verify status | /verify last`, "warning");
				return;
			}

			const { record, recordPath } = await runVerification(pi, ctx, recordsRoot, runDeps);
			ctx.ui.notify(formatRecord(record, recordPath), record.verdict === "DONE" ? "info" : "warning");
		},
	});

	// Model-callable equivalent of `/verify` (run form only -- `status`/`last`
	// are for a human's own direct control). See this file's top comment for
	// why a tool, not just a command: a model executing a prompt template's
	// turn (e.g. `/before-done`'s) has no way to invoke another registered
	// slash command.
	pi.registerTool({
		name: "verify",
		label: "Verify",
		description:
			"Run this repository's canonical verification command (and, for a Node package, its typecheck/lint " +
			"scripts) yourself, plus one independent-review round if configured, and record the result as durable " +
			"evidence bound to the current diff. Returns a ran:/skipped:/verdict: table. Use this for the " +
			"format/lint/test evidence step of a completion check (e.g. before-done) instead of running those " +
			"commands yourself and reporting the result from memory.",
		promptSnippet: "Run the canonical verification command and record durable pass/fail evidence",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const { record, recordPath } = await runVerification(pi, { ...ctx, signal }, recordsRoot, runDeps);
			return {
				content: [{ type: "text", text: formatRecord(record, recordPath) }],
				details: { verdict: record.verdict },
			};
		},
	});
}
