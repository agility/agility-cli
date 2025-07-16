import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from 'ansi-colors';
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
    referenceMapper: ReferenceMapper,
    isStubPass: boolean = false
): Promise<{ model: mgmtApi.Model | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision }> {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Model>("model", "referenceName", sourceModel.referenceName);
    let targetModelFromMapping: mgmtApi.Model | null = existingMapping?.target || null;

    // STEP 2: Find target instance data
    const targetInstanceData = targetData.models?.find((m: any) => {
        if (targetModelFromMapping) {
            return (
                m.id === targetModelFromMapping.id ||
                m.referenceName === targetModelFromMapping.referenceName
            );
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
            shouldSkip: !!(targetInstanceData || targetModelFromMapping)
        };
    }

    // STEP 4: Use FinderDecisionEngine for proper conflict resolution
    const decision = FinderDecisionEngine.makeDecision(
        'model',
        sourceModel.id,
        sourceModel.referenceName || `Model-${sourceModel.id}`,
        sourceModel,
        targetModelFromMapping,
        targetInstanceData
    );

    // STEP 5: Apply model-specific logic overrides
    let finalDecision = { ...decision };

    // Special case: Empty fields indicate incomplete model that needs updating
    // BUT only apply this override if there are sync delta changes or we're in a non-sync operation
    if (targetInstanceData && targetInstanceData.fields?.length === 0 && decision.syncDelta.hasChanges) {
        finalDecision.shouldUpdate = true;
        finalDecision.shouldSkip = false;
        finalDecision.shouldCreate = false;
    }

    return {
        model: finalDecision.entity,
        shouldUpdate: finalDecision.shouldUpdate,
        shouldCreate: finalDecision.shouldCreate,
        shouldSkip: finalDecision.shouldSkip,
        decision: finalDecision
    };
}

export async function findModelInTargetInstance(
  model: mgmtApi.Model,
  apiClient: mgmtApi.ApiClient,
  guid: string,
  referenceMapper: ReferenceMapper
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
