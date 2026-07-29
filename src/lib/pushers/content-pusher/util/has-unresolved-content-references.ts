import { ContentItemMapper } from "lib/mappers/content-item-mapper";

/**
 * Recursively check for unresolved content references
 */
export function hasUnresolvedContentReferences(obj: any, referenceMapper: ContentItemMapper): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  if (Array.isArray(obj)) {
    return obj.some((item) => hasUnresolvedContentReferences(item, referenceMapper));
  }

  for (const [key, value] of Object.entries(obj)) {
    // Check for content reference patterns
    if ((key === "contentid" || key === "contentID") && typeof value === "number") {
      const mappedId = referenceMapper.getContentItemMappingByContentID(value, "source");
      if (!mappedId) {
        return true; // Unresolved content reference
      }
    }

    // Check for comma-separated content IDs in sortids fields
    if (key === "sortids" && typeof value === "string") {
      const contentIds = value.split(",").filter((id) => id.trim());
      for (const contentIdStr of contentIds) {
        const contentId = parseInt(contentIdStr.trim());
        if (!isNaN(contentId)) {
          const mappedId = referenceMapper.getContentItemMappingByContentID(contentId, "source");
          if (!mappedId) {
            return true; // Unresolved content reference
          }
        }
      }
    }

    // Recursive check for nested objects
    if (hasUnresolvedContentReferences(value, referenceMapper)) {
      return true;
    }
  }

  return false;
}

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
 * Unlike hasUnresolvedContentReferences (which early-exits with a boolean), this walks the
 * whole structure so callers can report exactly which field/reference is unmapped. Only
 * positive IDs are considered — 0 / -1 mean "no reference selected" and are ignored so we
 * don't over-skip items with intentionally empty linked-content fields.
 */
export function collectUnresolvedContentReferences(
  obj: any,
  referenceMapper: ContentItemMapper,
  path = ""
): UnresolvedContentReference[] {
  const results: UnresolvedContentReference[] = [];
  if (typeof obj !== "object" || obj === null) {
    return results;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      results.push(...collectUnresolvedContentReferences(item, referenceMapper, `${path}[${index}]`));
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
    results.push(...collectUnresolvedContentReferences(value, referenceMapper, childPath));
  }

  return results;
}
