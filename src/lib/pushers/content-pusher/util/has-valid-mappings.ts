import { ContentItem } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { getSavedTargetBySourceReferenceName, state } from "core/state";

/**
 * Checks if a content item has valid container and model mappings. In preflight, a container or
 * model the run would create has no mapping (nothing is written), so one recorded as planned by its
 * pusher counts too: its new items are reported as planned creates instead of silently left out.
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

  if (sourceContainer && sourceModel) return true;
  if (!state.preflight) return false;
  const container = sourceContainer || getSavedTargetBySourceReferenceName("container", item.properties.referenceName);
  const model = sourceModel || getSavedTargetBySourceReferenceName("model", item.properties.definitionName);
  return !!(container && model);
}
