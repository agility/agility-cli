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
 * Linked levels: the linked items split into dependency levels, leaves first (PROD-3025).
 *   Level 0 references no other linked item; level n references something at level n-1.
 *   Each level is pushed as its own batch, so every mapping a level needs already exists.
 *   Items in a reference cycle share one level (their references to each other can't resolve).
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
  linkedContentLevels: ContentItem[][];
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
    const referencedIds = collectReferencedContentIDs(item, itemsByReferenceName, allItemsById, modelMapper);
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

  const linkedContentLevels = buildLinkedLevels(linkedSet, itemsByReferenceName, allItemsById, modelMapper);

  return { normalContentItems, linkedContentItems, linkedContentLevels, skippedItems: skipped };
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
 *  - single-item references (contentid / sortids, INCLUDING one living only in a
 *    LinkeContentDropdownValueField/SortIDFieldName companion field — PROD-2446) → the
 *    specific referenced item, only when it is present in the current content set
 *    (allItemsById).
 *
 * Returns the referenced items' contentIDs; the referencing item itself is never included.
 */
function collectReferencedContentIDs(
  item: ContentItem,
  itemsByReferenceName: Map<string, ContentItem[]>,
  allItemsById: Map<number, ContentItem>,
  modelMapper: ModelMapper
): number[] {
  const ids: number[] = [];

  // Whole-list references → all items belonging to the referenced list
  for (const refName of collectListReferenceNames(item.fields || {})) {
    for (const target of itemsByReferenceName.get(refName) || []) {
      ids.push(target.contentID);
    }
  }

  // Single-item references → the specific referenced item, if it is in this push set
  const sourceModel = getSourceModel(item, modelMapper);
  for (const contentID of collectContentIDReferences(item.fields || {}, sourceModel)) {
    if (allItemsById.has(contentID)) {
      ids.push(contentID);
    }
  }

  return ids;
}

/**
 * Resolves an item's own source model (by its definitionName), so a Content-typed field's
 * companion-field name (LinkeContentDropdownValueField/SortIDFieldName) can be read off it.
 * Returns null if unmapped — collectContentIDReferences degrades gracefully to the structural-only
 * walk in that case, same as before PROD-2446.
 */
function getSourceModel(item: ContentItem, modelMapper: ModelMapper): any {
  if (!item.properties?.definitionName) return null;
  const modelMapping = modelMapper.getModelMappingByReferenceName(item.properties.definitionName.toLowerCase(), "source");
  return modelMapping ? modelMapper.getMappedEntity(modelMapping, "source") : null;
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
    for (const nestedId of collectReferencedContentIDs(item, itemsByReferenceName, allItemsById, modelMapper)) {
      if (!visited.has(nestedId)) {
        stack.push(nestedId);
      }
    }
  }
}

/**
 * Splits the linked items into dependency levels, leaves first (PROD-3025).
 *
 * Only references between linked items count: a reference to anything else is either already
 * mapped or can't be resolved by ordering. Self-references are ignored. Cycles are collapsed
 * with Tarjan's strongly-connected-components algorithm, so the levels come from a DAG and work
 * at any depth. Tarjan emits a component only after every component it reaches, so each one's
 * level is known from its dependencies' levels as it is emitted. Iterative, so a long chain
 * can't overflow the call stack.
 */
function buildLinkedLevels(
  linkedSet: Set<number>,
  itemsByReferenceName: Map<string, ContentItem[]>,
  allItemsById: Map<number, ContentItem>,
  modelMapper: ModelMapper
): ContentItem[][] {
  const linkedIds = Array.from(linkedSet);
  const depsById = new Map<number, number[]>();
  for (const id of linkedIds) {
    const deps = collectReferencedContentIDs(allItemsById.get(id)!, itemsByReferenceName, allItemsById, modelMapper);
    depsById.set(id, Array.from(new Set(deps)).filter((dep) => dep !== id && linkedSet.has(dep)));
  }

  const indexOf = new Map<number, number>();
  const lowLink = new Map<number, number>();
  const onStack = new Set<number>();
  const componentStack: number[] = [];
  const levelOf = new Map<number, number>();
  let nextIndex = 0;

  const visit = (id: number) => {
    indexOf.set(id, nextIndex);
    lowLink.set(id, nextIndex);
    nextIndex++;
    componentStack.push(id);
    onStack.add(id);
  };

  for (const root of linkedIds) {
    if (indexOf.has(root)) continue;
    visit(root);
    const work: Array<{ id: number; next: number }> = [{ id: root, next: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const deps = depsById.get(frame.id)!;

      if (frame.next < deps.length) {
        const dep = deps[frame.next++];
        if (!indexOf.has(dep)) {
          visit(dep);
          work.push({ id: dep, next: 0 });
        } else if (onStack.has(dep)) {
          lowLink.set(frame.id, Math.min(lowLink.get(frame.id)!, indexOf.get(dep)!));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        lowLink.set(parent.id, Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!));
      }
      if (lowLink.get(frame.id) !== indexOf.get(frame.id)) continue;

      // frame.id roots a component: pop its members, then place it one level above its deepest dependency
      const members: number[] = [];
      let member: number;
      do {
        member = componentStack.pop()!;
        onStack.delete(member);
        members.push(member);
      } while (member !== frame.id);

      const memberSet = new Set(members);
      let level = 0;
      for (const id of members) {
        for (const dep of depsById.get(id)!) {
          if (!memberSet.has(dep)) level = Math.max(level, levelOf.get(dep)! + 1);
        }
      }
      for (const id of members) levelOf.set(id, level);
    }
  }

  // Group in linkedSet order so the output is deterministic
  const levels: ContentItem[][] = [];
  for (const id of linkedIds) {
    const level = levelOf.get(id)!;
    (levels[level] ||= []).push(allItemsById.get(id)!);
  }
  return levels.filter(Boolean);
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
