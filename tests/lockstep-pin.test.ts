import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");

const PINNED_PACKAGES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
];

test("the four @earendil-works devDependencies are pinned to the same exact version", () => {
	const pkg = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8"));
	const versions = new Map(PINNED_PACKAGES.map((name) => [name, pkg.devDependencies[name]]));

	// Must come before the range-prefix/lockstep checks below: an absent
	// devDependency is `undefined`, and `/^\D/.test("")` is false and
	// `new Set([undefined, undefined, ...]).size` is 1 -- a manifest with
	// all four pins deleted would otherwise pass both checks below
	// trivially, silently defeating the whole point of this test.
	const missing = PINNED_PACKAGES.filter((name) => typeof versions.get(name) !== "string" || versions.get(name) === "");
	assert.deepEqual(missing, [], `expected a pinned version for: ${missing.join(", ")}`);

	// Must be a single exact `X.Y.Z` version -- not just "doesn't start with
	// a range-operator character". A prefix-only check (e.g. /^\D/) accepts
	// plenty of valid npm ranges that begin with a digit and still aren't
	// exact pins: "0.84.2 || 0.85.0" (OR range), "0.84.2 - 0.85.0" (hyphen
	// range), "0.84.x" (wildcard). Any of those would let a future install
	// resolve to a different version per package while still passing here.
	const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
	const notExact = PINNED_PACKAGES.filter((name) => !EXACT_VERSION.test(versions.get(name) ?? ""));
	assert.deepEqual(
		notExact,
		[],
		`expected a single exact X.Y.Z version (no ranges, no ^/~/||/-/x) for: ${notExact.map((name) => `${name}@${versions.get(name)}`).join(", ")}`,
	);

	const distinct = new Set(versions.values());
	assert.equal(
		distinct.size,
		1,
		`expected all four packages pinned to the same version, found: ${[...versions].map(([name, v]) => `${name}@${v}`).join(", ")}`,
	);
});

test("package-lock.json resolves the four @earendil-works packages to the pinned version", () => {
	const pkg = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8"));
	const lock = JSON.parse(readFileSync(resolve(repo, "package-lock.json"), "utf8"));
	const pinned = pkg.devDependencies["@earendil-works/pi-agent-core"];
	// Same reasoning as the sibling test above: an absent pin (`pinned` is
	// undefined) must fail loudly here too, not be treated as "nothing to
	// check against."
	assert.equal(typeof pinned, "string", "expected @earendil-works/pi-agent-core to have a pinned devDependency version");

	const mismatched = [];
	for (const name of PINNED_PACKAGES) {
		const resolved = lock.packages[`node_modules/${name}`]?.version;
		if (resolved !== pinned) {
			mismatched.push(`${name}@${resolved ?? "<not found>"}`);
		}
	}
	assert.deepEqual(
		mismatched,
		[],
		`expected package-lock.json to resolve all four packages to ${pinned}, found: ${mismatched.join(", ")}`,
	);
});
