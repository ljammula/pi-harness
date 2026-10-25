import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Pi ships no web search tool at all. The published option (`pi-web-access`)
// wants a cloud API key for Brave/Tavily/Exa/etc., which this machine has no
// reason to buy: ai-stack already serves SearXNG on :8888.
//
// Registered as a tool rather than left to the `local-search` skill because a
// 27B model reliably calls a tool that is in front of it, and unreliably
// remembers to shell out to a script a skill described. Same backend, higher
// hit rate.
//
// Registration itself is gated on a reachability probe, same convention as
// local-summarize/self-review's own reachability checks (see their
// SKILL.md). This extension ships unconditionally to every pi install of
// this harness, including machines with no ai-stack at all (e.g. a
// sandboxed worker, or an engineer on Copilot-backed pi) -- advertising a
// tool that will always fail there wastes a turn and misrepresents what the
// session can actually do. Once registered for a session, execute() still
// fails soft on top of that -- ai-stack can still go down mid-session.
//
// session_start awaits the probe (pi's own bindExtensions() awaits
// session_start synchronously before a session can proceed, so this is
// unavoidable if the tool is to be available on the session's first turn --
// live-verified an unawaited probe loses the race against the first turn's
// tool list getting built, silently omitting web_search from turn 1 even
// when ai-stack answers in single-digit ms). session_start also fires again
// on every /fork and /resume, not just cold startup
// (agent-session-runtime.js re-emits it per fork), so PROBE_TIMEOUT_MS is
// kept short (not the 2s a background health check could afford) to bound
// that tax -- including the case where AI_STACK_HOST points at an
// unreachable Tailscale host (a black-holed SYN pays the full timeout,
// unlike an instant ECONNREFUSED). before_agent_start additionally retries
// (idempotently, NOT awaited -- turns after the first can tolerate the tool
// appearing one turn late) on every subsequent turn until it succeeds, so a
// session started before ai-stack finished booting self-heals once it comes
// up instead of staying gated off for good.
const MAX_RESULTS = 8;
const PROBE_TIMEOUT_MS = 500;

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

async function isReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const host = process.env.AI_STACK_HOST || "127.0.0.1";
  const baseUrl = `http://${host}:8888`;
  let registered = false;

  function registerWebSearch(): void {
    pi.registerTool({
      name: "web_search",
      label: "web search",
      description:
        "Search the web via a local SearXNG instance. Returns up to 8 results as title, URL, and snippet. " +
        "Use for factual lookups: API signatures, error messages, CLI flags, package versions. " +
        "Snippets are summaries, not primary sources -- read the URL before acting on anything that matters.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
      }),

      async execute(_toolCallId, params, signal) {
        const url = `${baseUrl}/search?q=${encodeURIComponent(params.query)}&format=json`;

        let payload: { results?: SearxResult[] };
        try {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            return {
              content: [{ type: "text", text: `SearXNG returned HTTP ${response.status}. Continue without web results.` }],
              details: { error: true, count: 0 },
            };
          }
          payload = await response.json();
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text:
                  `SearXNG at ${baseUrl} is not reachable (${error.message}). ` +
                  `Continue without web results, and say so rather than guessing an answer.`,
              },
            ],
            details: { error: true, count: 0 },
          };
        }

        const results = (payload.results ?? []).slice(0, MAX_RESULTS);
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results for "${params.query}".` }],
            details: { error: false, count: 0 },
          };
        }

        const text = results
          .map((r) => `- ${r.title ?? "(untitled)"} (${r.url ?? "no url"}): ${(r.content ?? "").trim()}`)
          .join("\n");

        return {
          content: [{ type: "text", text }],
          details: { error: false, count: results.length },
        };
      },
    });
  }

  // Awaited by session_start (pi's own bindExtensions() awaits it, bounding
  // the tax to PROBE_TIMEOUT_MS -- live-measured: an unawaited probe loses
  // the race against the very first turn's tool list getting built, so
  // web_search is silently absent on turn 1 even when ai-stack answers in
  // single-digit ms. Not awaited by before_agent_start: that path exists
  // only to self-heal a session that started before ai-stack was ready, and
  // turns after the first can tolerate the tool appearing one turn late far
  // better than turn 1 can tolerate it never appearing when it was actually
  // available the whole time.
  async function tryRegisterBlocking(): Promise<void> {
    if (registered) return;
    if (!(await isReachable(baseUrl))) return;
    registered = true;
    registerWebSearch();
  }

  function tryRegisterNonBlocking(): void {
    if (registered) return;
    void isReachable(baseUrl).then((reachable) => {
      if (!reachable || registered) return;
      registered = true;
      registerWebSearch();
    });
  }

  pi.on("session_start", tryRegisterBlocking);
  pi.on("before_agent_start", tryRegisterNonBlocking);
}
