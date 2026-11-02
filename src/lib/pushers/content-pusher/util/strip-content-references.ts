import { getLinkedContentCompanionFields, findFieldKey } from "lib/content/linked-content-companion-fields";

/**
 * PROD-3076: copy of an item's fields with its references to the given source contentIDs blanked,
 * so the item can be created before the items it references exist (pass 1 of a reference cycle).
 *
 * Covers the same reference shapes as collectContentIDReferences:
 * - `contentid` / `contentID` set to -1 ("no reference selected", which the field mapper and the
 *   PROD-2309 guard both treat as empty; the server stores the field empty, even a required one);
 * - each ID removed from a comma-separated `sortids`;
 * - each ID removed from a companion field (the model's LinkeContentDropdownValueField /
 *   SortIDFieldName, PROD-2446), a top-level sibling of the main field.
 *
 * Returns the new fields and how many references were blanked. The input is never modified.
 */
export function stripContentReferences(
  fields: any,
  ids: Set<number>,
  model?: any
): { fields: any; stripped: number } {
  let stripped = 0;

  const withoutIds = (list: string): string => {
    const parts = list.split(",").map((p) => p.trim());
    const kept = parts.filter((p) => !ids.has(parseInt(p)));
    stripped += parts.length - kept.length;
    return kept.join(",");
  };

  function walk(node: any): any {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;

    const out: any = {};
    for (const [key, value] of Object.entries(node)) {
      if ((key === "contentid" || key === "contentID") && typeof value === "number" && ids.has(value)) {
        out[key] = -1;
        stripped++;
      } else if (key === "sortids" && typeof value === "string") {
        out[key] = withoutIds(value);
      } else {
        out[key] = walk(value);
      }
    }
    return out;
  }

  const result = walk(fields || {});

  for (const [, companionFieldName] of getLinkedContentCompanionFields(model)) {
    const companionKey = findFieldKey(result, companionFieldName);
    if (companionKey && typeof result[companionKey] === "string" && result[companionKey].trim()) {
      result[companionKey] = withoutIds(result[companionKey]);
    }
  }

  return { fields: result, stripped };
}
