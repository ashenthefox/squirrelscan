// #1864: the page's HTML pass reads the page with each scanned inline script's text blanked, and a long body shortened
// to BLANK_KEEP spaces. Its findings must be exactly those of a pass over the page with every scanned script's text
// replaced by the same number of spaces: same values, classifications and offsets.
// Values are built at runtime from parts; no secret-shaped literal is committed.

import { describe, expect, test } from "bun:test";
import { parsePage } from "@squirrelscan/parser";

import { scanContent, scanPageForSecrets, type LeakedSecret } from "../../src/security/leaked-secrets";
import { serializeChildren } from "../../src/shared/serialized-prefix";

const URL_ = "https://shop.example.test/products/a";
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const run = (next: () => number, n: number, alphabet = ALNUM): string =>
  Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
const j = (...parts: string[]): string => parts.join("");

/** Minified-looking code of about `n` characters, with JS escapes and a quoted URL or two in it. */
function bundle(next: () => number, n: number): string {
  let out = "";
  while (out.length < n) out += `function ${run(next, 3, "abcdefgh")}(a){return a?"\\u0041${run(next, 6)}":"//cdn.example.test/x.js"};`;
  return out;
}

function page(seed: number): string {
  const next = lcg(seed);
  const key = () => j("sk_", "live_") + run(next, 24);
  return [
    `<!doctype html><html><head><title>t&amp;s</title>`,
    `<script>${bundle(next, 40_000)}var k1="${key()}";</script>`,
    `</head><body><p data-x="&quot;${j("gh", "p_")}${run(next, 36)}&quot;">a &lt;b&gt; ${key()}</p>`,
    `<script type="application/json">{"a":"${bundle(next, 70_000).replaceAll('"', "'")}","password":"${run(next, 20)}9"}</script>`,
    `<div id="cfg" data-api-key="${run(next, 32, "0123456789abcdef")}"></div><p>${key()}</p>`,
    `<script>   </script><script src="/app.js"></script><script>${bundle(next, 20_000)}</script>`,
    `<footer>${key()} &#x41;&#66;</footer></body></html>`,
  ].join("\n");
}

const strip = (s: LeakedSecret) => JSON.stringify(s);

describe("the HTML pass with scanned script bodies blanked and shortened (#1864)", () => {
  for (const seed of [1, 2, 3]) {
    test(`seed ${seed}: the HTML findings are exactly those of the fully blanked page, offsets included`, () => {
      const html = page(seed);
      const doc = parsePage(html, URL_).document!;
      const found = scanPageForSecrets(doc, URL_);
      const fromHtml = found.filter((s) => s.location.startsWith("html"));
      expect(fromHtml.length).toBeGreaterThanOrEqual(3);

      const scanned = Array.from(doc.querySelectorAll("script")).filter(
        (s) => !s.hasAttribute("src") && (s.textContent ?? "").trim() !== ""
      );
      // Long enough that the HTML pass shortens at least one body.
      expect(scanned.some((s) => (s.textContent ?? "").length > 16_384)).toBe(true);
      const blanked = serializeChildren(doc, {
        replaceText: new Map(scanned.map((s) => [s, " ".repeat((s.textContent ?? "").length)] as const)),
      });
      const reference = scanContent(blanked, "html", URL_);
      expect(fromHtml.map(strip).sort()).toEqual(reference.map(strip).sort());
    });
  }

  test("a value after a shortened body reports its offset in the page as blanked, not as shortened", () => {
    const next = lcg(9);
    const key = j("sk_", "live_") + run(next, 24);
    const html = `<!doctype html><html><body><script>${bundle(next, 100_000)}</script><p>${key}</p></body></html>`;
    const doc = parsePage(html, URL_).document!;
    const [finding] = scanPageForSecrets(doc, URL_).filter((s) => s.value === key);
    expect(finding?.location).toBe("html");
    // No entities or escapes outside the script, so the offset is the value's index in the page as serialised.
    expect(finding?.offset).toBe(doc.toString().indexOf(key));
  });
  test("a script whose secret shows only after an HTML-entity decode keeps its text in the HTML pass", () => {
    const next = lcg(11);
    const key = j("sk_", "live_") + run(next, 24);
    // The inline pass decodes JS and percent escapes, not entities: only the HTML pass can read this value.
    const encoded = [...key].map((c) => `&#${c.charCodeAt(0)};`).join("");
    const html = `<!doctype html><html><body><script>var k="${encoded}";</script></body></html>`;
    const doc = parsePage(html, URL_).document!;
    const found = scanPageForSecrets(doc, URL_);
    expect(found.some((s) => s.value === key && s.location.startsWith("html"))).toBe(true);
  });
});
