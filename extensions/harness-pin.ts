import { realpath, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendHarnessTrace } from "./lib/harness-telemetry.ts";

const PIN_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Resolves the version of @earendil-works/pi-coding-agent that the actually
 * running `pi` process was loaded from -- NOT the version reachable via
 * `import.meta.resolve` from this extension file's own location, which
 * resolves relative to *this file's* directory ancestry. When this repo is
 * symlink-installed (install.sh), this file's realpath sits inside this
 * repo's own checkout, so `import.meta.resolve` finds *this repo's own*
 * devDependency copy in its own node_modules -- structurally always equal
 * to the pinned version read from this same repo's package.json, so a real
 * mismatch (e.g. `npm install -g @earendil-works/pi-coding-agent@newer`
 * while this repo's pin stays put -- precisely the drift UPGRADING.md's
 * "why pinned" section describes) could never be observed that way.
 * Confirmed live: faking the local node_modules copy's version made the
 * old `import.meta.resolve`-based check "detect" a mismatch that was never
 * the real running engine at all.
 *
 * `process.argv[1]` is the entry script Node was actually invoked with --
 * for pi's own bin script (a plain shebang'd Node script, not a bundled
 * single-executable), its realpath sits inside the real running package's
 * own directory tree regardless of install method (homebrew symlink, npm
 * global, nvm, `pi install`'s own bundled engine). Walk up from there.
 */
export async function resolveRunningVersion(): Promise<string | null> {
	const entry = process.argv[1];
	if (!entry) return null;
	try {
		let dir = dirname(await realpath(entry));
		for (let i = 0; i < 6; i++) {
			try {
				const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
				if (pkg.name === PIN_PACKAGE && typeof pkg.version === "string") return pkg.version;
			} catch {
				// not the package root yet -- keep walking up
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// realpath failed (unusual invocation context) -- treat as unresolved
	}
	return null;
}

/**
 * Reads the pinned devDependency version from this repo's own package.json.
 *
 * Cannot just join off `import.meta.dirname` (as an earlier version of this
 * function did): pi's real extension loader (`core/extensions/loader.js`)
 * loads extension files through jiti (`jiti.import(extensionPath)`), and
 * `resolvePath()` upstream of that is a plain string join with no
 * `fs.realpath` -- for install.sh's actual deployment (a symlink at
 * `~/.pi/agent/extensions/harness-pin.ts` pointing back into this repo),
 * jiti hands this module an `import.meta` computed from that *symlink*
 * path, not this file's real location. `dirname(import.meta.dirname)` then
 * resolves to `~/.pi/agent` (one level above the symlink's own directory,
 * which is real, unlike the file entry inside it) -- which has no
 * `package.json` at all, so this always returned null in the one install
 * method this repo actually ships (confirmed live, loading this file
 * through jiti via a real symlink, the exact way install.sh deploys it).
 * That permanently no-ops the whole version-mismatch check in production.
 *
 * Fix: resolve *this file's own* real path first (`realpath` follows the
 * symlink jiti/import.meta didn't), then walk up from there -- same
 * realpath-before-trusting-the-path pattern `resolveRunningVersion` above
 * uses for `process.argv[1]`.
 */
export async function resolvePinnedVersion(): Promise<string | null> {
	try {
		let dir = dirname(await realpath(fileURLToPath(import.meta.url)));
		for (let i = 0; i < 6; i++) {
			try {
				const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
				const pinned = pkg.devDependencies?.[PIN_PACKAGE];
				if (typeof pinned === "string") return pinned;
			} catch {
				// not the repo root yet -- keep walking up
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// realpath/fileURLToPath failed -- treat as unresolved
	}
	return null;
}

export default function harnessPin(
	pi: ExtensionAPI,
	deps: {
		resolveRunningVersion?: () => Promise<string | null>;
		resolvePinnedVersion?: () => Promise<string | null>;
	} = {},
): void {
	const getRunningVersion = deps.resolveRunningVersion ?? resolveRunningVersion;
	const getPinnedVersion = deps.resolvePinnedVersion ?? resolvePinnedVersion;

	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup") return;

		// A version mismatch is a warning only (plan decision 7): resolution
		// failures of any kind must degrade to silence, never a thrown error.
		try {
			const [running, pinned] = await Promise.all([getRunningVersion(), getPinnedVersion()]);
			if (!running || !pinned || running === pinned) return;

			ctx.ui.notify(
				`${PIN_PACKAGE} version mismatch: running ${running}, pinned ${pinned} in package.json`,
				"warning",
			);
			appendHarnessTrace(pi, {
				extension: "harness-pin",
				diffHash: null,
				event: "startup",
				outcome: "unconfigured",
				durationMs: 0,
				metadata: { running, pinned },
			});
		} catch {
			// never throw, never disable anything -- a failed check is silent
		}
	});
}
