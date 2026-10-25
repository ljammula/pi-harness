import assert from "node:assert/strict";
import test from "node:test";
import planModeExtension from "../extensions/plan-mode/index.ts";
import { ExtensionHarness } from "./extension-api-harness.ts";

async function enterPlanModeAndGetContext(harness: ExtensionHarness): Promise<string> {
	await harness.invokeCommand("plan", "");
	const [result] = await harness.emit({ type: "before_agent_start" } as any);
	return (result as any).message.content as string;
}

test("tells the model to use web_search when it's actually registered", async () => {
	const harness = new ExtensionHarness();
	planModeExtension(harness.api);
	harness.tools.set("web_search", { name: "web_search" });

	const content = await enterPlanModeAndGetContext(harness);

	assert.match(content, /Use the web_search tool/);
});

test("omits the web_search instruction when it isn't registered (e.g. probe hasn't succeeded yet)", async () => {
	// Regression test: this extension used to tell the model to use web_search
	// unconditionally, even on a session where searxng-search.ts's own
	// reachability-gated registration never succeeded (no ai-stack configured,
	// or the probe just hasn't resolved yet) -- producing a call to a tool
	// that doesn't exist instead of that tool's own graceful "unreachable"
	// message, which only fires once it's actually registered.
	const harness = new ExtensionHarness();
	planModeExtension(harness.api);

	const content = await enterPlanModeAndGetContext(harness);

	assert.doesNotMatch(content, /web_search/);
});
