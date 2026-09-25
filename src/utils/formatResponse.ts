import { resolveItemResponse, type QtiItem, type QtiResult } from "@/utils/qtiParsing";

/**
 * Render a Results Reporting response for display inside a single candidate
 * card. Behavior mirrors the inline helper that previously lived in
 * `src/app/workspace/[id]/page.tsx`:
 *
 * - no result or no response → "（回答なし）"
 * - array response → joined with " / "
 * - choice items → "<choice.text> (<response>)" when the identifier matches
 *   one of the item's choices, otherwise the raw response string
 * - everything else → String(response)
 */
export const formatResponse = (
  item: QtiItem,
  itemResult?: QtiResult["itemResults"][string]
): string => {
  const response = resolveItemResponse(item, itemResult);
  if (response === null || response === undefined) {
    return "（回答なし）";
  }
  if (Array.isArray(response)) {
    return response.join(" / ");
  }
  if (item.type === "choice") {
    const choice = item.choices.find((c) => c.identifier === response);
    return choice ? `${choice.text} (${response})` : String(response);
  }
  return String(response);
};
