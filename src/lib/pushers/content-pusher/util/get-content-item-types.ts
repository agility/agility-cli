import { ContentItem } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { hasValidMappings } from "./has-valid-mappings";
import { collectListReferenceNames } from "./collect-list-reference-names";



/**
 * Classifies content items into normal, linked, and skipped categories.
 * 
 * Normal items: Top-level items that are not referenced by other items
 * Linked items: Items that are referenced via fullList=true in other items' fields
 * Skipped items: Items without valid container/model mappings
 */
export function getContentItemTypes(
    contentItems: ContentItem[],
    opts: {
        containerMapper: ContainerMapper,
        modelMapper: ModelMapper,
        referenceMapper: ContentItemMapper,
        logger: any
    }
): {
    normalContentItems: ContentItem[],
    linkedContentItems: ContentItem[],
    skippedItems: ContentItem[]
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
        normalSet.add(item.contentID);

        // Find all list references in this item's fields
        const referenceNames = collectListReferenceNames(item.fields || {});
        if (referenceNames.length > 0) {
            markReferencedItems(
                referenceNames,
                itemsByReferenceName,
                normalSet,
                linkedSet,
                skipped,
                containerMapper,
                modelMapper
            );
        }
    }

    // Build final result arrays
    const { normalContentItems, linkedContentItems } = buildResultArrays(
        normalSet,
        linkedSet,
        allItemsById
    );

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
 * Recursively marks all items referenced by the given reference names as linked.
 * Uses a stack-based approach to avoid recursion limits.
 */
function markReferencedItems(
    referenceNames: string[],
    itemsByReferenceName: Map<string, ContentItem[]>,
    normalSet: Set<number>,
    linkedSet: Set<number>,
    skipped: ContentItem[],
    containerMapper: ContainerMapper,
    modelMapper: ModelMapper
): void {
    const visitedRefNames = new Set<string>();
    const stack = [...referenceNames];

    while (stack.length > 0) {
        const refName = stack.pop()!;
        
        if (visitedRefNames.has(refName)) continue;
        visitedRefNames.add(refName);

        const items = itemsByReferenceName.get(refName) || [];
        
        for (const item of items) {
            if (!hasValidMappings(item, containerMapper, modelMapper)) {
                skipped.push(item);
                continue;
            }

            linkedSet.add(item.contentID);
            normalSet.delete(item.contentID); // Remove from normal if it was added there

            // Recursively process nested references
            const nestedRefs = collectListReferenceNames(item.fields || {});
            for (const nestedRef of nestedRefs) {
                stack.push(nestedRef);
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
