import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseQtiItemXml } from "@/utils/qtiParsing";
import { highlightCodeBlocks } from "@/utils/highlight";
import { rewriteHtmlImageSources } from "@/utils/assetUrl";

const REAL_ITEM_PATH = "src/utils/__fixtures__/real-item.qti.xml";

describe("real QTI item layout around blanks", () => {
  it("does not add newlines before blanks inside qti-pre", () => {
    const xml = fs.readFileSync(
      path.resolve(process.cwd(), REAL_ITEM_PATH),
      "utf-8"
    );
    const item = parseQtiItemXml(xml);

    expect(item.promptHtml).toContain("<pre");

    expect(item.promptHtml).not.toMatch(
      /opacity:\s*<\/code>\s*[\r\n]+\s*<input/
    );
    expect(item.promptHtml).not.toMatch(
      /transition:\s*<\/code>\s*[\r\n]+\s*<input/
    );
  });

  it("does not add newlines before blanks after highlighting", () => {
    const xml = fs.readFileSync(
      path.resolve(process.cwd(), REAL_ITEM_PATH),
      "utf-8"
    );
    const item = parseQtiItemXml(xml);
    const root = document.createElement("div");
    root.innerHTML = rewriteHtmlImageSources(
      item.promptHtml,
      "ws_test",
      "items/item.qti.xml"
    );

    highlightCodeBlocks(root);

    const pre = Array.from(root.querySelectorAll("pre")).find((node) =>
      node.querySelector("input.qti-blank-input")
    );
    const html = pre?.innerHTML ?? "";
    expect(html).not.toMatch(/opacity:\s*<\/code>\s*[\r\n]+\s*<input/);
    expect(html).not.toMatch(/transition:\s*<\/code>\s*[\r\n]+\s*<input/);
  });

  it("keeps block-boundary blanks on their own line", () => {
    const xml = fs.readFileSync(
      path.resolve(process.cwd(), REAL_ITEM_PATH),
      "utf-8"
    );
    const item = parseQtiItemXml(xml);
    const root = document.createElement("div");
    root.innerHTML = rewriteHtmlImageSources(
      item.promptHtml,
      "ws_test",
      "items/item.qti.xml"
    );

    highlightCodeBlocks(root);

    const pre = Array.from(root.querySelectorAll("pre")).find((node) =>
      node.querySelector("input.qti-blank-input")
    );
    const html = pre?.innerHTML ?? "";
    const blank5Index = html.indexOf('data-blank="5"');
    expect(blank5Index).toBeGreaterThan(0);
    const beforeBlank5 = html.slice(Math.max(0, blank5Index - 40), blank5Index);
    expect(beforeBlank5.includes("\n")).toBe(true);
  });
});
