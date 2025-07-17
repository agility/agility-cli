import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ReferenceMapper } from "../shared/reference-mapper";
import { logModelDifferences } from "../loggers";
import { findModelInTargetInstanceEnhanced, findModelInTargetInstance } from "../finders/model-finder";

/**
 * Model pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions instead of complex field comparison
 */
export async function pushModels(
  sourceData: SourceData,
  targetData: any,
  referenceMapper: ReferenceMapper,
  onProgress?: PusherProgressCallback
): Promise<PusherResult> {
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

    if (onProgress) {
      onProgress(successful + skipped + failed, totalModels, result === 'failed' ? 'error' : 'success');
    }
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