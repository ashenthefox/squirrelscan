// crawl/server-errors - report crawled pages whose final response is 5xx (#2036).
//
// The crawler retries a failing fetch before it gives up, so a page that errors once and then
// answers is stored as the healthy page it became and never reaches this rule (it is not
// reported as intermittent). A page that is still 5xx after those retries is stored as an error
// page, and each one becomes an item here with its status code.

import type { CheckResult, Rule, RuleContext, RuleResult } from "../types";

export const serverErrorsRule: Rule = {
  meta: {
    id: "crawl/server-errors",
    name: "Server Errors",
    description: "Reports crawled pages whose final response is a 5xx server error",
    solution:
      "A page that answers 5xx is broken for visitors and for search engines, which drop it from the index if the error persists. Check the server or application logs for the failing URL, fix the underlying fault (an unhandled exception, an exhausted database or upstream, a bad deploy), then re-run the audit to confirm the page returns 200.",
    category: "crawl",
    scope: "site",
    severity: "error",
    weight: 8,
    checks: [
      { name: "server-errors", outcome: "problem" },
      { name: "server-errors", outcome: "clean", clears: ["server-errors"] },
      { name: "server-errors", outcome: "skipped" },
    ],
  },

  run(ctx: RuleContext): RuleResult {
    const pages = ctx.site?.pages;
    if (!pages || pages.length === 0) {
      return {
        checks: [
          {
            name: "server-errors",
            status: "skipped",
            message: "No pages crawled",
            skipReason: "No pages available",
          },
        ],
      };
    }

    const failing = new Map<string, number>();
    for (const page of pages) {
      if (page.redirectSource) continue;
      if (page.statusCode >= 500 && page.statusCode <= 599 && !failing.has(page.url)) {
        failing.set(page.url, page.statusCode);
      }
    }

    const checks: CheckResult[] = [];
    if (failing.size === 0) {
      checks.push({
        name: "server-errors",
        status: "pass",
        message: "No crawled page answered with a 5xx status",
      });
      return { checks };
    }

    checks.push({
      name: "server-errors",
      status: "fail",
      message: `${failing.size} crawled ${failing.size === 1 ? "page answers" : "pages answer"} with a 5xx server error`,
      items: [...failing].map(([url, statusCode]) => ({
        id: url,
        label: `${url} (${statusCode})`,
        meta: { statusCode },
      })),
      details: { total: failing.size },
    });
    return { checks };
  },
};
