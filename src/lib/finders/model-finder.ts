import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from 'ansi-colors';
import { getState } from "../../core/state";

/**
 * Enhanced model finder following the asset-finder pattern
 * Returns shouldUpdate/shouldCreate/shouldSkip decisions based on lastModifiedDate comparison
 */
export async function findModelInTargetInstanceEnhanced(
    sourceModel: mgmtApi.Model,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ model: mgmtApi.Model | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean }> {
    const state = getState();
    const overwrite = state.overwrite;
    let existsInTarget = false;

    // STEP 1: Check for existing mapping of source model to target model
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Model>("model", "referenceName", sourceModel.referenceName);
    let targetModelFromMapping: mgmtApi.Model | null = existingMapping?.target || null;

    // STEP 2: Find target instance data (local file data) for this model
    const targetInstanceData = targetData.models?.find((m: any) => {
        // Try multiple matching strategies for target data
        if (targetModelFromMapping) {
            // If we have a mapping, match by target model properties
            return (
                m.id === targetModelFromMapping.id ||
                m.referenceName === targetModelFromMapping.referenceName
            );
        } else {
            // If no mapping, match by source model properties
            return m.referenceName === sourceModel.referenceName;
        }
    });

    if (targetInstanceData) {
        existsInTarget = true;
    }

    // STEP 3: Decision logic based on mapping and target data
    let shouldUpdate = false;
    let shouldCreate = false;
    let shouldSkip = false;
    let finalTargetModel: mgmtApi.Model | null = null;

    if (targetInstanceData) {
        // Target model exists in target instance
        finalTargetModel = targetInstanceData;
        shouldCreate = false;

        if (targetModelFromMapping) {
            // Both mapping and target data exist - compare dates for update decision
            const mappingDate = new Date(targetModelFromMapping.lastModifiedDate || 0);
            const targetDataDate = new Date(targetInstanceData.lastModifiedDate || 0);

            if (targetDataDate > mappingDate) {
                shouldUpdate = true;
                shouldSkip = false;
            } else {
                shouldUpdate = false;
                shouldSkip = true;
            }
        } else {
            // Target data exists but no mapping - this is an existing model, add mapping
            shouldUpdate = false;
            shouldSkip = true;
        }

        // Override with user flags
        if (overwrite) {
            shouldUpdate = true;
            shouldSkip = false;
        }
    } else {
        // Target model doesn't exist in target instance
        if (targetModelFromMapping) {
            // We have a mapping but no target data - model was deleted, should create
            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
        } else {
            // No mapping and no target data - brand new model
            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
        }
    }

    return {
        model: finalTargetModel,
        shouldUpdate,
        shouldCreate,
        shouldSkip
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
