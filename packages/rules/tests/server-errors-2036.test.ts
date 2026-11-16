// crawl/server-errors reports each crawled page whose final response is 5xx (#2036).

import { describe, expect, test } from "bun:test";

import { serverErrorsRule } from "../src/crawl/server-errors";
import type { RuleContext } from "../src/types";

function run(pages: Array<{ url: string; statusCode: number; redirectSource?: boolean }>) {
  const ctx = {
    page: { url: "https://example.com/", html: "", statusCode: 200, loadTime: 0, headers: {} },
    parsed: {},
    options: {},
    site: {
      baseUrl: "https://example.com/",
      pages: pages.map((p) => ({ ...p, parsed: {} })),
    },
  } as unknown as RuleContext;
  return serverErrorsRule.run(ctx) as { checks: Array<Record<string, any>> };
}

describe("crawl/server-errors", () => {
  test("a 500 page fails with its status", () => {
    const [check] = run([
      { url: "https://example.com/", statusCode: 200 },
      { url: "https://example.com/boom", statusCode: 500 },
    ]).checks;
    expect(check.status).toBe("fail");
    expect(check.items).toEqual([
      { id: "https://example.com/boom", label: "https://example.com/boom (500)", meta: { statusCode: 500 } },
    ]);
  });

  test("a 503 page fails, one item per page", () => {
    const [check] = run([
      { url: "https://example.com/a", statusCode: 503 },
      { url: "https://example.com/b", statusCode: 502 },
    ]).checks;
    expect(check.status).toBe("fail");
    expect(check.items).toHaveLength(2);
    expect(check.items.map((i: any) => i.meta.statusCode)).toEqual([503, 502]);
  });

  test("a healthy site, and a page that recovered on retry (stored as 200), pass", () => {
    const [check] = run([
      { url: "https://example.com/", statusCode: 200 },
      { url: "https://example.com/flaky", statusCode: 200 },
      { url: "https://example.com/gone", statusCode: 404 },
    ]).checks;
    expect(check.status).toBe("pass");
    expect(check.items).toBeUndefined();
  });

  test("a redirect entry is not a page", () => {
    const [check] = run([{ url: "https://example.com/r", statusCode: 500, redirectSource: true }])
      .checks;
    expect(check.status).toBe("pass");
  });

  test("no pages skips", () => {
    expect(run([]).checks[0]?.status).toBe("skipped");
  });
});
