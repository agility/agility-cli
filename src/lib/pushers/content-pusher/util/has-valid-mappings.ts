import { ContentItem } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";

/**
 * Checks if a content item has valid container and model mappings
 */
export function hasValidMappings(
    item: ContentItem,
    containerMapper: ContainerMapper,
    modelMapper: ModelMapper
): boolean {
    const mappedContainer = containerMapper.getContainerMappingByReferenceName(
        item.properties.referenceName.toLowerCase(),
        "source"
    );
    const sourceContainer = containerMapper.getMappedEntity(mappedContainer, "source");

    const sourceModelMapping = modelMapper.getModelMappingByReferenceName(
        item.properties.definitionName.toLowerCase(),
        "source"
    );
    const sourceModel = modelMapper.getMappedEntity(sourceModelMapping, "source");

    return !!(sourceContainer && sourceModel);
}

