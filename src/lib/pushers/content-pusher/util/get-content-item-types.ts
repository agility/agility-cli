import { ContentItem } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { hasValidMappings } from "./has-valid-mappings";
import { collectListReferenceNames } from "./collect-list-reference-names";
import { collectContentIDReferences } from "./collect-content-id-references";

/**
 * Classifies content items into normal, linked, and skipped categories.
 *
 * Normal items: Top-level items that are not referenced by other items
 * Linked items: Items that are referenced by other items — either via a whole-list
 *   reference (fullList=true) or a single-item reference (contentid/sortids). Linked
 *   items are pushed FIRST so their source→target contentID mapping exists before the
 *   referencing item's fields are remapped (PROD-2341).
 * Skipped items: Items without valid container/model mappings
 */
export function getContentItemTypes(
  contentItems: ContentItem[],
  opts: {
    containerMapper: ContainerMapper;
    modelMapper: ModelMapper;
    referenceMapper: ContentItemMapper;
    logger: any;
  }
): {
  normalContentItems: ContentItem[];
  linkedContentItems: ContentItem[];
  skippedItems: ContentItem[];
} {
  const { containerMapper, modelMapper } = opts;

  // Build lookup maps for efficient access
  const { allItemsById, itemsByReferenceName } = buildItemMaps(contentItems);

  // Track classification state
  const normalSet = new Set<number>();
  const linkedSet = new Set<number>();
  const skipped: ContentItem[] = [];

  // Process each content item
  for (const item of contentItems) {
    if (!hasValidMappings(item, containerMapper, modelMapper)) {
      skipped.push(item);
      continue;
    }

    // Items start as normal; referenced items get moved to linked
    if (!linkedSet.has(item.contentID)) {
      normalSet.add(item.contentID);
    }

    // Find every item this one depends on — whole-list references (by referenceName)
    // AND single-item references (by contentID) — and mark them linked (pushed first).
    const referencedIds = collectReferencedContentIDs(item, itemsByReferenceName, allItemsById);
    if (referencedIds.length > 0) {
      markReferencedItems(
        referencedIds,
        itemsByReferenceName,
        allItemsById,
        normalSet,
        linkedSet,
        skipped,
        containerMapper,
        modelMapper
      );
    }
  }

  // Build final result arrays
  const { normalContentItems, linkedContentItems } = buildResultArrays(normalSet, linkedSet, allItemsById);

  return { normalContentItems, linkedContentItems, skippedItems: skipped };
}

/**
 * Builds lookup maps for content items:
 * - allItemsById: O(1) lookup by contentID (used when building final arrays from ID sets)
 * - itemsByReferenceName: Groups items by referenceName (used for recursive reference traversal)
 */
function buildItemMaps(contentItems: ContentItem[]): {
  allItemsById: Map<number, ContentItem>;
  itemsByReferenceName: Map<string, ContentItem[]>;
} {
  const allItemsById = new Map<number, ContentItem>();
  const itemsByReferenceName = new Map<string, ContentItem[]>();

  for (const item of contentItems) {
    allItemsById.set(item.contentID, item);

    const referenceName = item.properties?.referenceName;
    if (referenceName) {
      const existing = itemsByReferenceName.get(referenceName) || [];
      existing.push(item);
      itemsByReferenceName.set(referenceName, existing);
    }
  }

  return { allItemsById, itemsByReferenceName };
}

/**
 * Resolves an item's direct dependency targets to concrete source contentIDs, combining
 * both reference kinds:
 *  - whole-list references (referencename + fulllist:true) → every item sharing that
 *    referenceName (the full list), looked up via itemsByReferenceName;
 *  - single-item references (contentid / sortids) → the specific referenced item, only
 *    when it is present in the current content set (allItemsById).
 *
 * Returns the referenced items' contentIDs; the referencing item itself is never included.
 */
function collectReferencedContentIDs(
  item: ContentItem,
  itemsByReferenceName: Map<string, ContentItem[]>,
  allItemsById: Map<number, ContentItem>
): number[] {
  const ids: number[] = [];

  // Whole-list references → all items belonging to the referenced list
  for (const refName of collectListReferenceNames(item.fields || {})) {
    for (const target of itemsByReferenceName.get(refName) || []) {
      ids.push(target.contentID);
    }
  }

  // Single-item references → the specific referenced item, if it is in this push set
  for (const contentID of collectContentIDReferences(item.fields || {})) {
    if (allItemsById.has(contentID)) {
      ids.push(contentID);
    }
  }

  return ids;
}

/**
 * Recursively marks all items referenced (transitively) by the given contentIDs as linked,
 * so they are pushed before the items that reference them. Uses a stack-based approach with
 * a visited set to avoid infinite loops on circular references.
 */
function markReferencedItems(
  referencedIds: number[],
  itemsByReferenceName: Map<string, ContentItem[]>,
  allItemsById: Map<number, ContentItem>,
  normalSet: Set<number>,
  linkedSet: Set<number>,
  skipped: ContentItem[],
  containerMapper: ContainerMapper,
  modelMapper: ModelMapper
): void {
  const visited = new Set<number>();
  const stack = [...referencedIds];

  while (stack.length > 0) {
    const contentID = stack.pop()!;

    if (visited.has(contentID)) continue;
    visited.add(contentID);

    const item = allItemsById.get(contentID);
    if (!item) continue; // referenced item not in this push set — nothing to promote

    if (!hasValidMappings(item, containerMapper, modelMapper)) {
      skipped.push(item);
      continue;
    }

    linkedSet.add(contentID);
    normalSet.delete(contentID); // Remove from normal if it was added there

    // Recursively process this item's own dependency targets
    for (const nestedId of collectReferencedContentIDs(item, itemsByReferenceName, allItemsById)) {
      if (!visited.has(nestedId)) {
        stack.push(nestedId);
      }
    }
  }
}

/**
 * Builds final arrays from ID sets, using the allItemsById map for lookup
 */
function buildResultArrays(
  normalSet: Set<number>,
  linkedSet: Set<number>,
  allItemsById: Map<number, ContentItem>
): {
  normalContentItems: ContentItem[];
  linkedContentItems: ContentItem[];
} {
  const normalContentItems: ContentItem[] = [];
  const linkedContentItems: ContentItem[] = [];

  normalSet.forEach((id) => {
    const item = allItemsById.get(id);
    if (item) normalContentItems.push(item);
  });

  linkedSet.forEach((id) => {
    const item = allItemsById.get(id);
    if (item) linkedContentItems.push(item);
  });

  return { normalContentItems, linkedContentItems };
}
