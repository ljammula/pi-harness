import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");

// Skills install.sh links directly outside the PORTABLE_SKILLS array (each
// via its own explicit `link "$REPO_ROOT/skills/<name>" ...` call). Read from
// the actual file below rather than trusting this list alone -- it exists
// only as a fallback name for the assertion messages.
function bashArray(source: string, varName: string): string[] {
	const match = source.match(new RegExp(`${varName}=\\(([^)]*)\\)`));
	assert.ok(match, `install.sh: could not find ${varName}=(...) array`);
	return match[1].trim().split(/\s+/).filter(Boolean);
}

function explicitlyLinkedSkills(source: string): string[] {
	const names: string[] = [];
	const re = /link\s+"\$REPO_ROOT\/skills\/([^"/]+)"\s+"\$HOME\/\.pi\/agent\/skills\/[^"]+"/g;
	for (const m of source.matchAll(re)) {
		names.push(m[1]);
	}
	return names;
}

async function readInstallSh() {
	return readFile(resolve(repo, "install.sh"), "utf8");
}

async function readPackageJson() {
	const raw = await readFile(resolve(repo, "package.json"), "utf8");
	return JSON.parse(raw) as {
		pi: { skills: string[]; extensions: string[] };
	};
}

function assertSetsEqual(actual: Set<string>, expected: Set<string>, label: string) {
	const missingFromActual = [...expected].filter((name) => !actual.has(name));
	const missingFromExpected = [...actual].filter((name) => !expected.has(name));
	assert.deepEqual(
		{ missingFromActual, missingFromExpected },
		{ missingFromActual: [], missingFromExpected: [] },
		`${label}: package.json and install.sh disagree.\n` +
			`  In install.sh but missing from package.json: ${JSON.stringify(missingFromExpected)}\n` +
			`  In package.json but missing from install.sh: ${JSON.stringify(missingFromActual)}`,
	);
}

test("package.json manifest skills match install.sh's linked skills", async () => {
	const [pkg, installSh] = await Promise.all([readPackageJson(), readInstallSh()]);

	const manifestSkills = new Set(pkg.pi.skills.map((entry) => entry.replace(/^\.\/skills\//, "")));

	const portable = bashArray(installSh, "PORTABLE_SKILLS");
	const explicit = explicitlyLinkedSkills(installSh);
	const installedSkills = new Set([...portable, ...explicit]);

	assertSetsEqual(installedSkills, manifestSkills, "skills");
});

test("package.json manifest disabled extensions match install.sh's DISABLED_EXTENSIONS", async () => {
	const [pkg, installSh] = await Promise.all([readPackageJson(), readInstallSh()]);

	const manifestDisabled = new Set(
		pkg.pi.extensions
			.filter((entry) => entry.startsWith("!./extensions/"))
			.map((entry) => entry.replace(/^!\.\/extensions\//, "")),
	);

	const scriptDisabled = new Set(bashArray(installSh, "DISABLED_EXTENSIONS"));

	assertSetsEqual(scriptDisabled, manifestDisabled, "disabled extensions");
});
