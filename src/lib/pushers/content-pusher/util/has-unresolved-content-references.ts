import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { getLinkedContentCompanionFields, findFieldKey } from "lib/content/linked-content-companion-fields";

export interface UnresolvedContentReference {
  /** Dotted/indexed path to the offending value within the item's fields (e.g. "menuItems[0].contentid"). */
  path: string;
  /** The source contentID that has no source→target mapping. */
  contentID: number;
}

/**
 * Recursively collect every unresolved content reference (a contentID / sortids value with
 * no source→target mapping) along with the field path where it occurs.
 *
 * Walks the whole structure (rather than early-exiting on the first hit) so callers can report
 * exactly which field/reference is unmapped. Only positive IDs are considered — 0 / -1 mean "no
 * reference selected" and are ignored so we don't over-skip items with intentionally empty
 * linked-content fields.
 *
 * PROD-2446: a Content-typed dropdown/checkbox/grid field's reference can live ONLY in a
 * companion field (named by the model's LinkeContentDropdownValueField/SortIDFieldName setting —
 * see PROD-2431/2435/2442), invisible to the structural contentid/sortids walk above since it's a
 * bare string under an arbitrary key. Pass `model` so this guard can recognize those too — without
 * it, an unresolved companion-field reference ships to the target undetected, reproducing the same
 * server-side NullReferenceException this guard exists to prevent (PROD-2309).
 */
export function collectUnresolvedContentReferences(
  obj: any,
  referenceMapper: ContentItemMapper,
  path = "",
  model?: any
): UnresolvedContentReference[] {
  const results: UnresolvedContentReference[] = [];
  if (typeof obj !== "object" || obj === null) {
    return results;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      results.push(...collectUnresolvedContentReferences(item, referenceMapper, `${path}[${index}]`, model));
    });
    return results;
  }

  for (const [key, value] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;

    // Direct content reference (contentid / contentID)
    if ((key === "contentid" || key === "contentID") && typeof value === "number") {
      if (value > 0 && !referenceMapper.getContentItemMappingByContentID(value, "source")) {
        results.push({ path: childPath, contentID: value });
      }
      continue;
    }

    // Comma-separated content IDs in sortids fields
    if (key === "sortids" && typeof value === "string") {
      for (const contentIdStr of value.split(",")) {
        const contentId = parseInt(contentIdStr.trim());
        if (!isNaN(contentId) && contentId > 0 && !referenceMapper.getContentItemMappingByContentID(contentId, "source")) {
          results.push({ path: childPath, contentID: contentId });
        }
      }
      continue;
    }

    // Recurse into nested objects/arrays
    results.push(...collectUnresolvedContentReferences(value, referenceMapper, childPath, model));
  }

  // PROD-2446: companion fields are top-level siblings of the main field, not nested inside it —
  // only check them at the top of the walk (path === ""), not on every recursive call, so a
  // companion field's own value never gets misread as if it belonged to some nested object.
  if (path === "") {
    for (const [, companionFieldName] of getLinkedContentCompanionFields(model)) {
      const companionKey = findFieldKey(obj, companionFieldName);
      if (!companionKey) continue;

      const companionValue = obj[companionKey];
      if (typeof companionValue !== "string" || !companionValue.trim()) continue;

      for (const idStr of companionValue.split(",")) {
        const contentId = parseInt(idStr.trim());
        if (!isNaN(contentId) && contentId > 0 && !referenceMapper.getContentItemMappingByContentID(contentId, "source")) {
          results.push({ path: companionKey, contentID: contentId });
        }
      }
    }
  }

  return results;
}
