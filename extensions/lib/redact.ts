// Shared support module; the installed lib directory is not an extension entry point.
//
// Moved out of quality-gate.ts so verify-pack.ts can redact failing output
// the same way without importing an extension module for one function.
// quality-gate.ts re-exports this so its existing import path keeps working.
export function redactFailureOutput(output: string): string {
	return output
		.replace(/(authorization:\s*bearer\s+)\S+/gi, "$1<redacted>")
		.replace(/\b(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*[^\s]+/gi, "$1=<redacted>")
		.replace(/:\/\/([^\s:/]+):([^\s@]+)@/g, "://$1:<redacted>@")
		.trim()
		.slice(0, 3000);
}
