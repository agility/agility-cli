import { getEffectiveTargetModel } from "core/state";
import { ModelMapper } from "lib/mappers/model-mapper";

/**
 * PROD-2542: resolve the model a content item will be validated against on the target, by its
 * source definitionName. Lookup order:
 *   1. the run-scoped registry (a model saved — or, in preflight, planned — earlier in this run;
 *      the target models/<id>.json cache is NOT rewritten after saveModel, so it would be stale),
 *   2. the target model cache via the model mapping,
 *   3. the source model via the model mapping,
 *   4. none — the caller skips validation.
 *
 * Results are memoized per resolver instance; build one per filter pass, not per item.
 */
export function createEffectiveTargetModelResolver(
  sourceGuid: string,
  targetGuid: string
): (definitionName: string) => any | null {
  const cache = new Map<string, any | null>();
  let modelMapper: ModelMapper | null | undefined;

  const getModelMapper = (): ModelMapper | null => {
    if (modelMapper === undefined) {
      try {
        modelMapper = sourceGuid && targetGuid ? new ModelMapper(sourceGuid, targetGuid) : null;
      } catch {
        modelMapper = null;
      }
    }
    return modelMapper;
  };

  return (definitionName: string) => {
    if (!definitionName) return null;
    const key = definitionName.toLowerCase();
    if (cache.has(key)) return cache.get(key);

    let model: any | null = getEffectiveTargetModel(definitionName) || null;
    if (!model) {
      try {
        const mapper = getModelMapper();
        const mapping = mapper?.getModelMappingByReferenceName(definitionName, "source") || null;
        if (mapper && mapping) {
          model = mapper.getMappedEntity(mapping, "target") || mapper.getMappedEntity(mapping, "source") || null;
        }
      } catch {
        // Best-effort: an unreadable cache just means no validation for this model.
        model = null;
      }
    }

    cache.set(key, model);
    return model;
  };
}
