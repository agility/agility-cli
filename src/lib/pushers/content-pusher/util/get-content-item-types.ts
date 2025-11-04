import { ContentItem } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import ansiColors from "ansi-colors";

type ContentPushLogger = {
    info: (...args: any[]) => void,
    warn?: (...args: any[]) => void,
    error: (...args: any[]) => void,
    debug?: (...args: any[]) => void
}

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
    const { containerMapper, modelMapper, logger } = opts;

    const allItemsById = new Map<number, ContentItem>();
    const itemsByReferenceName = new Map<string, ContentItem[]>();

    for (const item of contentItems) {
        allItemsById.set(item.contentID, item);
        const rn = item.properties?.referenceName;
        if (rn) {
            const arr = itemsByReferenceName.get(rn) || [];
            arr.push(item);
            itemsByReferenceName.set(rn, arr);
        }
    }

    const normalSet = new Set<number>();
    const linkedSet = new Set<number>();
    const skipped: ContentItem[] = [];

    function hasValidMappings(item: ContentItem): boolean {
        const mappedContainer = containerMapper.getContainerMappingByReferenceName(item.properties.referenceName.toLowerCase(), "source");
        const sourceContainer = containerMapper.getMappedEntity(mappedContainer, "source");
       
        // we actually need to get the model by the definitionName not the referenceName
       
        // const modelID = sourceContainer?.contentDefinitionID || 0;
        // const sourceModelMapping = modelMapper.getModelMappingByID(modelID, "source");
        const sourceModelMapping = modelMapper.getModelMappingByReferenceName(item.properties.definitionName.toLowerCase(), "source");
        const sourceModel = modelMapper.getMappedEntity(sourceModelMapping, "source");

        
        // if(item.properties.referenceName.toLowerCase().includes('jackpotcarouselbannercontent')){
        //     console.log(ansiColors.bgRed('HAS VALID MAPPINGS - CONTENT ITEM:'), item.properties.referenceName);
        //     console.log(ansiColors.bgRed('SOURCE CONTAINER:'), sourceContainer);
        //     console.log(ansiColors.bgRed('SOURCE MODEL:'), sourceModel);
        //     console.log('--------------------------------');
        // }

        if (!sourceContainer || !sourceModel) {
         if(item.properties.referenceName.toLowerCase().includes('jackpotcarouselbannercontent')){
        
            console.log(ansiColors.bgRed('SKIPPING CONTENT ITEM (no container or model):'), item.properties.referenceName);
         }
            // logger.error(`Skipping contentID=${item.contentID} referenceName=${item.properties.referenceName} due to missing container/model mapping.`);
            return false;
        }
        return true;
    }

    function collectListReferenceNames(fields: any): string[] {
        const found: string[] = [];
        function walk(node: any) {
            if (!node) return;
            if (Array.isArray(node)) {
                for (const v of node) walk(v);
                return;
            }
            if (typeof node === "object") {
                const rn = (node as any).referencename || (node as any).referenceName;
                const full = (node as any).fulllist === true || (node as any).fullList === true;
                if (typeof rn === "string" && full) {
                    found.push(rn);
                }
                for (const key of Object.keys(node)) {
                    walk((node as any)[key]);
                }
            }
        }
        walk(fields);
        return found;
    }

    const visitedRefNames = new Set<string>();

    function markReferencedRecursively(referenceNames: string[]) {
        const stack = [...referenceNames];
        while (stack.length) {
            const rn = stack.pop() as string;
            if (visitedRefNames.has(rn)) continue;
            visitedRefNames.add(rn);

            const items = itemsByReferenceName.get(rn) || [];
            for (const child of items) {
                if (!hasValidMappings(child)) {
                    skipped.push(child);
                    continue;
                }
                linkedSet.add(child.contentID);
                // If referenced, it should not be considered normal
                if (normalSet.has(child.contentID)) normalSet.delete(child.contentID);
                const moreRefs = collectListReferenceNames(child.fields || {});
                for (const mr of moreRefs) stack.push(mr);
            }
        }
    }

    for (const item of contentItems) {
        if (!hasValidMappings(item)) {
            skipped.push(item);
            continue;
        }

        // Parent defaults to normal; referenced children become linked
        normalSet.add(item.contentID);

        const refs = collectListReferenceNames(item.fields || {});
        if (refs.length > 0) {
            markReferencedRecursively(refs);
        }
    }

    // Ensure no overlap: any referenced item should not be in normal
    linkedSet.forEach((id) => {
        if (normalSet.has(id)) normalSet.delete(id);
    });

    // Build arrays from sets with natural order de-duped
    const normalContentItems: ContentItem[] = [];
    const linkedContentItems: ContentItem[] = [];

    normalSet.forEach((id) => {
        const item = allItemsById.get(id);
        if (item) normalContentItems.push(item);
    });

    linkedSet.forEach((id) => {
        if (normalSet.has(id)) return; // prefer parentness
        const item = allItemsById.get(id);
        if (item) linkedContentItems.push(item);
    });

    return { normalContentItems, linkedContentItems, skippedItems: skipped };
}


