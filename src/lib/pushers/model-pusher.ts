import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { logModelDifferences } from "../loggers";
import { ChangeDeltaFileWorker } from "lib/shared/change-delta-file-worker";

/**
 * Simple change detection for models
 */
interface ChangeDetection {
  entity: any;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  reason: string;
}

function changeDetection(
  sourceEntity: any,
  targetFromMapping: any,
  targetFromData: any
): ChangeDetection {
  if (!targetFromMapping && !targetFromData) {
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      reason: 'Model does not exist in target'
    };
  }
  
  const targetEntity = targetFromData || targetFromMapping;
  
  // For models, check modification dates
  const sourceModified = new Date(sourceEntity.lastModifiedDate || 0);
  const targetModified = new Date(targetEntity.lastModifiedDate || 0);
  
  if (sourceModified > targetModified) {
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      reason: 'Source model is newer'
    };
  }
  
  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: 'Model exists and is up to date'
  };
}

/**
 * Model pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions instead of complex field comparison
 */
/**
 * Enhanced model finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
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
  decision?: ChangeDetection;
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

export async function pushModels(
    sourceData: SourceData,
    targetData: any,
    referenceMapper: ReferenceMapperV2,
    // onProgress?: PusherProgressCallback,
    changeDeltaWorker: ChangeDeltaFileWorker
): Promise<PusherResult> {

  // 
  //
  // First logic block - Retrieval of the target instance's data, using the model ID
  //
  // 1. Look for the target instance mapping - then get the corresponding id for the source data and use that 
  // 2. If not found, we look for the target instance data on file 
  // 
  // 
  //
  // 3. 





  const models: mgmtApi.Model[] = sourceData.models || [];

  if (!models || models.length === 0) {
    console.log("No models found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const state = getState();
  const { targetGuid, overwrite, test } = state;
  const apiClient = getApiClient();
  const totalModels = models.length;

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  /**
   * Process a single model - handles both creation and updates
   */
  const processModel = async (
    model: mgmtApi.Model,
    fields: any[] | undefined,
    passName: string
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> => {
    const modelName = model.referenceName;

    const isStubPass = passName === "stub";
    try {
      // Use enhanced finder to determine what action to take
      const findResult = await findModelInTargetInstanceEnhanced(
        model,
        apiClient,
        targetGuid[0],
        targetData,
        referenceMapper,
        isStubPass
      );

      const { model: targetModel, shouldUpdate, shouldCreate, shouldSkip, sourceEntity } = findResult;
      if (shouldCreate) {
        // Model doesn't exist - create new one
        try {
          const newModel = await createNewModel(model, fields, apiClient, targetGuid[0]);
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${passName} ${ansiColors.bold.green("created")}`);
          
          // Store mapping for both stub and full passes so Pass 2 can find stubs created in Pass 1
          referenceMapper.addMapping("model", model, newModel);
          return 'created';
        } catch (error: any) {
          console.log(model)
          console.log(ansiColors.magenta(`error: ${JSON.stringify(error)}`));
          console.error(`✗ Error creating model ${modelName}:`, error.message);
          return 'failed';
        }
        
      } else if (shouldUpdate) {
        // Model exists but needs updating
        try {
          const updatedModel = await updateExistingModel(model, targetModel, fields, apiClient, targetGuid[0]);
          const updateType = isStubPass ? "stub" : "fields";
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${updateType} ${ansiColors.bold.green("updated")}`);
          
          // Always store mapping for updates (both stub and full passes)
          referenceMapper.addMapping("model", model, updatedModel);
          return 'updated';
        } catch (error: any) {
          console.error(`✗ Error updating model ${modelName}:`, error.message);
          return 'failed';
        }

      } else if (shouldSkip) {
        // Model exists and is up to date - skip
        if (isStubPass) {
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)}, ${ansiColors.bold.gray("exists, skipping")}`);
        } else {
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${ansiColors.bold.gray("is up to date, skipping")}`);
        }
        
        // Ensure mapping exists for existing models
        if (targetModel) {
          referenceMapper.addMapping("model", model, targetModel);
        }
        return 'skipped';
      }

      // Fallback - shouldn't reach here
      return 'failed';

    } catch (error: any) {
      console.error(`✗ Error processing model ${modelName}:`, error.message);
      return 'failed';
    }
  };

  console.log('\n')

  // 2-pass approach for models
  console.log(ansiColors.cyan("🔄 Pass 1: Model stubs (dependencies)"));
  for (const model of models) {
    const result = await processModel(model, [], "stub");
    
    // Don't count in Pass 1 - only track failures for immediate feedback
    if (result === 'failed') {
      failed++;
    }
  }

  console.log(ansiColors.cyan("\n🔄 Pass 2: Full model definitions"));
  for (const model of models) {
    const result = await processModel(model, model.fields, "full");
    
    // Count only in Pass 2 - each model counted exactly once
    if (result === 'created' || result === 'updated') {
      successful++;
    } else if (result === 'skipped') {
      skipped++;
    } else if (result === 'failed') {
      // Only count as failure if not already counted in Pass 1
      // (failures in Pass 1 remain failures in Pass 2)
    }

    // if (onProgress) {
    //   onProgress(successful + skipped + failed, totalModels, result === 'failed' ? 'error' : 'success');
    // }
  }

  const overallStatus = failed > 0 ? 'error' : 'success';
  return {
    status: overallStatus,
    successful,
    failed,
    skipped
  };
}

/**
 * Create a new model in the target instance
 */
async function createNewModel(
  sourceModel: mgmtApi.Model,
  fields: any[] | undefined,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string
): Promise<mgmtApi.Model> {
  const createPayload = {
    ...sourceModel,
    id: 0,
    fields: (fields || sourceModel.fields || []).map(field => {
      const cleanField = { ...field };
      delete cleanField.fieldID;
      return cleanField;
    })
  };

  delete createPayload.lastModifiedDate;
  delete createPayload.lastModifiedBy;
  delete createPayload.lastModifiedAuthorID;

  try {
    const newModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid);
    return newModel;
  } catch (error: any) {
    console.log(ansiColors.magenta(`error: ${JSON.stringify(error)}`));
    throw error;
  }
}

/**
 * Update an existing model in the target instance
 */
async function updateExistingModel(
  sourceModel: mgmtApi.Model,
  targetModel: mgmtApi.Model | null,
  fields: any[] | undefined,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string
): Promise<mgmtApi.Model> {
  if (!targetModel) {
    throw new Error("Target model is required for update operation");
  }

  const updatePayload = {
    ...sourceModel,
    id: targetModel.id,
    lastModifiedDate: targetModel.lastModifiedDate,
    fields: (fields || sourceModel.fields || []).map(field => {
      const cleanField = { ...field };
      delete cleanField.fieldID; // Remove to prevent API issues
      
      // Clean up Content field settings
      if (cleanField.type === "Content" && cleanField.settings?.ContentDefinition) {
        const { ContentDefinition, ...otherSettings } = cleanField.settings;
        cleanField.settings = otherSettings;
      }
      
      return cleanField;
    })
  };

  delete updatePayload.lastModifiedBy;
  delete updatePayload.lastModifiedAuthorID;

  const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid);
  return updatedModel;
} 
