import assert from "node:assert/strict";
import test from "node:test";
import searxngSearch from "../extensions/searxng-search.ts";
import { ExtensionHarness } from "./extension-api-harness.ts";

// before_agent_start's retry is fire-and-forget (must not block a turn on
// the reachability probe -- see the extension's own header comment), so
// `await harness.emit(...)` alone does not guarantee its `.then()` callback
// has run yet. Flush past it explicitly rather than relying on incidental
// microtask-ordering luck. session_start's own probe IS awaited by the
// handler itself, so callers of session_start don't need this.
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registers web_search when SearXNG is reachable", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await harness.emit({ type: "session_start", reason: "startup" } as any);

		assert.ok(harness.tools.has("web_search"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("does not register web_search when SearXNG is unreachable", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("connect ECONNREFUSED");
	}) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await harness.emit({ type: "session_start", reason: "startup" } as any);

		assert.ok(!harness.tools.has("web_search"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("does not register web_search when the probe responds with a non-2xx status", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await harness.emit({ type: "session_start", reason: "startup" } as any);

		assert.ok(!harness.tools.has("web_search"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("session_start's probe is bounded, not left to hang indefinitely", async () => {
	// Regression coverage for the opposite failure direction: an unbounded
	// wait here would hang every session_start (and therefore every /fork
	// and /resume -- pi's own bindExtensions() awaits session_start
	// synchronously) on a black-holed host (Tailscale down: a dropped SYN,
	// not an instant ECONNREFUSED). AbortSignal.timeout inside isReachable()
	// is what actually bounds this; prove the handler as a whole respects it
	// with a fetch mock that only settles when its signal aborts -- never on
	// its own -- the same way a real black-holed connection behaves (real
	// fetch does honor AbortSignal; a mock has to be told to for this test to
	// actually exercise that path).
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((_url: any, options?: { signal?: AbortSignal }) =>
		new Promise<Response>((_resolve, reject) => {
			options?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
		})) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await Promise.race([
			harness.emit({ type: "session_start", reason: "startup" } as any).then(() => "emitted"),
			new Promise((resolve) => setTimeout(() => resolve("timed-out"), 2000)).then(() => "timed-out"),
		]).then((winner) => assert.equal(winner, "emitted", "should resolve well within the outer 2s guard"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("self-heals: a session_start probe failure is retried on the next before_agent_start", async () => {
	const originalFetch = globalThis.fetch;
	let call = 0;
	globalThis.fetch = (async () => {
		call += 1;
		// First probe (session_start): SearXNG not up yet. Second probe
		// (before_agent_start): it's come up since.
		return new Response(null, { status: call === 1 ? 503 : 200 });
	}) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await harness.emit({ type: "session_start", reason: "startup" } as any);
		assert.ok(!harness.tools.has("web_search"), "not yet reachable at session_start");

		await harness.emit({ type: "before_agent_start", reason: "startup" } as any);
		await flush();
		assert.ok(harness.tools.has("web_search"), "should self-heal once reachable");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("before_agent_start's retry does not block the turn on the probe", async () => {
	// The counterpart to session_start's bounded-but-blocking probe: turns
	// after the first must not pay any of that cost, since they only exist
	// to self-heal a session that already started successfully without
	// web_search -- unlike session_start, there is no correctness reason for
	// a later turn to wait on this at all.
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await Promise.race([
			harness.emit({ type: "before_agent_start", reason: "startup" } as any).then(() => "emitted"),
			new Promise((resolve) => setTimeout(() => resolve("timed-out"), 300)).then(() => "timed-out"),
		]).then((winner) => assert.equal(winner, "emitted"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("does not re-probe once already registered", async () => {
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => {
		calls += 1;
		return new Response(null, { status: 200 });
	}) as typeof fetch;
	try {
		const harness = new ExtensionHarness();
		searxngSearch(harness.api);

		await harness.emit({ type: "session_start", reason: "startup" } as any);
		await harness.emit({ type: "before_agent_start", reason: "startup" } as any);
		await flush();
		await harness.emit({ type: "before_agent_start", reason: "startup" } as any);
		await flush();

		assert.equal(calls, 1, "should stop probing once registered");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
