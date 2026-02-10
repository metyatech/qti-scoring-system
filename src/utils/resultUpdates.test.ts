import { describe, expect, it } from "vitest";
import { buildCriteriaUpdate, updateItemComment } from "@/utils/resultUpdates";
import type { QtiResult } from "@/utils/qtiParsing";

describe("updateItemComment", () => {
  const baseResults: QtiResult[] = [
    {
      fileName: "r1.xml",
      sourcedId: "s1",
      candidateName: "User 1",
      itemResults: {
        item1: {
          resultIdentifier: "item1",
          response: "A",
          comment: "old",
          rubricOutcomes: {},
        },
      },
    },
    {
      fileName: "r2.xml",
      sourcedId: "s2",
      candidateName: "User 2",
      itemResults: {
        item1: {
          resultIdentifier: "item1",
          response: "B",
          rubricOutcomes: {},
        },
      },
    },
  ];

  it("updates comment for matching result file", () => {
    const updated = updateItemComment(baseResults, "r1.xml", "item1", "new");
    expect(updated[0].itemResults.item1.comment).toBe("new");
    expect(updated[1].itemResults.item1.comment).toBeUndefined();
  });

  it("creates item result when missing", () => {
    const updated = updateItemComment(baseResults, "r1.xml", "item2", "note");
    expect(updated[0].itemResults.item2.comment).toBe("note");
    expect(updated[0].itemResults.item2.resultIdentifier).toBe("item2");
  });

  it("returns new array and preserves other entries", () => {
    const updated = updateItemComment(
      baseResults,
      "r2.xml",
      "item1",
      "changed"
    );
    expect(updated).not.toBe(baseResults);
    expect(updated[0]).toBe(baseResults[0]);
    expect(updated[1]).not.toBe(baseResults[1]);
  });
});

describe("buildCriteriaUpdate", () => {
  it("sets met only for the target criterion index", () => {
    const rubric = [{ index: 1 }, { index: 2 }, { index: 3 }];
    const criteria = buildCriteriaUpdate(rubric, 2, true);

    expect(criteria).toHaveLength(3);
    expect(Object.prototype.hasOwnProperty.call(criteria[0], "met")).toBe(
      false
    );
    expect(criteria[1].met).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(criteria[2], "met")).toBe(
      false
    );
  });
});
