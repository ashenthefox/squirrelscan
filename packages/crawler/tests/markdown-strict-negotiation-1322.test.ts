// The Markdown probe also sends a strict `Accept: text/markdown`, the header a
// Markdown-only agent sends. A site can answer the lenient probe (which ends in
// `*/*`) with 200 HTML while it returns 5xx to the strict one; the probe records
// that status so ax/markdown-response can flag it (repo#1322).

import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { probeMarkdownResponse } from "../src/markdown";

const servers: Array<{ stop: (closeActive?: boolean) => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

type Handler = (req: Request) => Response;

function serve(handler: Handler): { origin: string; accepts: string[] } {
  const accepts: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/") accepts.push(req.headers.get("accept") ?? "");
      return handler(req);
    },
  });
  servers.push(server);
  return { origin: `http://localhost:${server.port}`, accepts };
}

const isStrict = (req: Request): boolean => req.headers.get("accept") === "text/markdown";
const notFound = (): Response => new Response("nope", { status: 404 });
const html = (): Response => new Response("<html></html>", { headers: { "content-type": "text/html" } });

function home(onHome: Handler): Handler {
  return (req) => (new URL(req.url).pathname === "/" ? onHome(req) : notFound());
}

describe("strict Markdown negotiation probe (repo#1322)", () => {
  test("sends the strict Accept: text/markdown alongside the lenient probe", async () => {
    const { origin, accepts } = serve(home(html));
    await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"));
    expect(accepts).toContain("text/markdown");
    expect(accepts).toContain("text/markdown, text/x-markdown, */*");
  });

  test("500 on strict, 200 HTML on lenient → strict status recorded", async () => {
    const { origin } = serve(
      home((req) =>
        isStrict(req)
          ? Response.json({ error: "boom" }, { status: 500 })
          : html(),
      ),
    );
    const r = await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"));
    expect(r).not.toBeNull();
    expect(r?.negotiatedStatus).toBe(200);
    expect(r?.negotiatedContentType).toBe("text/html");
    expect(r?.strictNegotiatedStatus).toBe(500);
    expect(r?.strictNegotiatedContentType).toContain("application/json");
    expect(r?.servesMarkdown).toBe(false);
  });

  test("strict 5xx is still a finding when the .md probe got no answer", async () => {
    const { origin } = serve((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/") return isStrict(req) ? new Response("x", { status: 502 }) : html();
      return new Response("x", { status: 503 }); // /index.md: no answer
    });
    const r = await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"));
    expect(r?.strictNegotiatedStatus).toBe(502);
  });

  test("absent markdown: strict answered with HTML → no error status, not served", async () => {
    const { origin } = serve(home(html));
    const r = await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"));
    expect(r?.servesMarkdown).toBe(false);
    expect(r?.strictNegotiatedStatus).toBe(200);
    expect(r?.negotiatedStatus).toBe(200);
  });

  test("Markdown served only on strict negotiation still counts as served", async () => {
    const { origin } = serve(
      home((req) =>
        isStrict(req) ? new Response("# hi", { headers: { "content-type": "text/markdown" } }) : html(),
      ),
    );
    const r = await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"));
    expect(r?.servesMarkdown).toBe(true);
    expect(r?.strictNegotiatedContentType).toBe("text/markdown");
  });

  test("homepage 5xx on every Accept stays unknown, not a negotiation defect (#1760)", async () => {
    const { origin } = serve(() => new Response("x", { status: 500 }));
    expect(await Effect.runPromise(probeMarkdownResponse(origin, "squirrel-test"))).toBeNull();
  });
});
