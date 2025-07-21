import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced model finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findModelInTargetInstanceEnhanced(
  sourceModel: mgmtApi.Model,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapperV2,
  isStubPass: boolean = false
): Promise<{
  model: mgmtApi.Model | null;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  decision?: FinderDecision;
  sourceEntity: any;
}> {
  try {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Model>(
      "model",
      "referenceName",
      sourceModel.referenceName
    );
    let targetModelFromMapping: mgmtApi.Model | null = existingMapping?.target || null;

    // STEP 2: Find target instance data
    const targetInstanceData = targetData.models?.find((m: any) => {
      if (targetModelFromMapping) {
        return m.id === targetModelFromMapping.id || m.referenceName === targetModelFromMapping.referenceName;
      } else {
        return m.referenceName === sourceModel.referenceName;
      }
    });

    // STEP 3: Handle stub pass (simplified logic for dependencies)
    if (isStubPass) {
      return {
        model: targetInstanceData || targetModelFromMapping,
        shouldUpdate: false,
        shouldCreate: !targetInstanceData && !targetModelFromMapping,
        shouldSkip: !!(targetInstanceData || targetModelFromMapping),
        sourceEntity: sourceModel,
      };
    }

    let targetChanged = false;
    if (targetInstanceData && targetModelFromMapping) {
      if (targetInstanceData.lastModifiedDate !== targetModelFromMapping.lastModifiedDate) {
        targetChanged = true;
      } else {
        targetChanged = false;
      }
    }

    const sourceHasFields = Array.isArray(sourceModel.fields) && sourceModel.fields.length > 0;
    const targetHasMapping = !!targetModelFromMapping;
 
    let shouldUpdate = false;
    let shouldCreate = false;
    let shouldSkip = false;

    if (!targetHasMapping && !targetChanged) {
      // Source has fields, no target mapping: update (create full model from nothing)
      shouldUpdate = true;
    } else if (!targetHasMapping && targetChanged) {
      // Source has fields, no target mapping: update (create full model from nothing)
      shouldSkip = true;
    } else if (targetHasMapping && targetChanged) {
      // All other cases: skip
      shouldSkip = true;
    } else {
      // All other cases: skip
      shouldSkip = true;
    }

    return {
      model: targetInstanceData || targetModelFromMapping,
      shouldUpdate,
      shouldCreate,
      shouldSkip,
      sourceEntity: sourceModel,
    };
  } catch (error: any) {
    console.error(`[ModelFinder] Error in enhanced finder for model ${sourceModel.referenceName}:`, error);
    // Fallback to safe defaults
    return {
      model: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      sourceEntity: sourceModel,
    };
  }
}

export async function findModelInTargetInstance(
  model: mgmtApi.Model,
  apiClient: mgmtApi.ApiClient,
  guid: string,
  referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.Model | null> {
  try {
    // First check the local reference mapper for a model with the same reference name
    const mappingResult = referenceMapper.getMappingByKey("model", "referenceName", model.referenceName);
    const targetMapping = mappingResult?.target;

    if (targetMapping) {
      return targetMapping as mgmtApi.Model;
    }

    // If not in mapper, try to find it in the target instance
    const targetModel = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);

    if (targetModel) {
      // CRITICAL: Add the mapping so we don't lose track of it
      referenceMapper.addMapping("model", model, targetModel);
      return targetModel;
    }

    return null;
  } catch (error: any) {
    return null;
  }
}
