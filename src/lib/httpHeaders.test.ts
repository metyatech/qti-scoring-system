import { describe, expect, it } from "vitest";
import {
  buildContentDisposition,
  toAsciiHeaderFallback,
} from "@/lib/httpHeaders";

describe("toAsciiHeaderFallback", () => {
  it("replaces non-ascii characters", () => {
    expect(toAsciiHeaderFallback("JavaScriptⅡ_期末")).toBe("JavaScript____");
  });

  it("keeps ascii characters", () => {
    expect(toAsciiHeaderFallback("file-name_123.qti.xml")).toBe(
      "file-name_123.qti.xml"
    );
  });
});

describe("buildContentDisposition", () => {
  it("builds RFC5987 filename* with ascii fallback", () => {
    const header = buildContentDisposition(
      "JavaScriptⅡ_期末.qti.xml",
      "JavaScriptⅡ_期末.qti.xml"
    );
    expect(header).toContain('filename="JavaScript____.qti.xml"');
    expect(header).toContain(
      "filename*=UTF-8''JavaScript%E2%85%A1_%E6%9C%9F%E6%9C%AB.qti.xml"
    );
  });
});
