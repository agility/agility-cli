import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient } from "../services/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ReferenceMapper } from "../utilities/reference-mapper";
import { logModelDifferences } from "../utilities/loggers";
import { areModelsDifferent } from "../utilities/models";

/**
 * Streamlined Model Pusher - 2-pass synchronization approach
 * Pass 1: Create model stubs (empty fields) to establish references
 * Pass 2: Update models with full field definitions
 */
export async function pushModels(
  sourceData: SourceData,
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
  const processedModels = new Set<number>();

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
  ): Promise<boolean> => {
    const modelName = model.referenceName;
    const isStubPass = Array.isArray(fields) && fields.length === 0;

    try {
      // Check if model exists (cache first, then API)
      let existingModel = referenceMapper.getMapping<mgmtApi.Model>("model", model.id);
      
      if (!existingModel || existingModel.id <= 0) {
        try {
          existingModel = await apiClient.modelMethods.getModelByReferenceName(modelName, targetGuid);
          if (existingModel) {
            referenceMapper.addMapping("model", model, existingModel);
          }
        } catch (error: any) {
          // Model doesn't exist, will create it
          existingModel = null;
        }
      }

      if (existingModel) {
        // Model exists - check if we need to update it
        if (isStubPass) {
          console.log(`✓ ${passName} ${ansiColors.underline(modelName)} ${ansiColors.bold.gray("already exists")} - Skipping stub creation.`);
          processedModels.add(model.id);
          return true;
        }

        // Compare models for differences
        const sourceModel = { ...model, fields: fields || model.fields || [] };
        const targetModel = { ...existingModel, fields: existingModel.fields || [] };

        if (!overwrite && !areModelsDifferent(sourceModel, targetModel, test, referenceMapper)) {
          console.log(`✓ ${passName} ${ansiColors.underline(modelName)} ${ansiColors.bold.gray("is identical")} - No update needed.`);
          processedModels.add(model.id);
          return true;
        }

        // Update existing model
        const updatePayload = {
          ...sourceModel,
          id: existingModel.id,
          lastModifiedDate: existingModel.lastModifiedDate,
          fields: (fields || model.fields || []).map(field => {
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

        // Log differences if test mode is enabled
        if (test) {
          logModelDifferences(sourceModel, targetModel, modelName);
        }

        const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid);
        referenceMapper.addMapping("model", model, updatedModel);

        console.log(`✓ ${passName} ${ansiColors.bold.cyan("updated")} ${ansiColors.underline(modelName)} (ID: ${existingModel.id})`);
        processedModels.add(model.id);
        return true;

      } else {
        // Model doesn't exist - create it
        const createPayload = {
          ...model,
          id: 0,
          fields: (fields || model.fields || []).map(field => {
            const cleanField = { ...field };
            delete cleanField.fieldID;
            return cleanField;
          })
        };

        delete createPayload.lastModifiedDate;
        delete createPayload.lastModifiedBy;
        delete createPayload.lastModifiedAuthorID;

        const createdModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid);
        
        if (!createdModel || !createdModel.id) {
          throw new Error(`Failed to create model ${modelName} - no ID returned`);
        }

        referenceMapper.addMapping("model", model, createdModel);
        console.log(`✓ ${passName} ${ansiColors.bold.cyan("created")} ${ansiColors.underline(modelName)} (ID: ${createdModel.id})`);
        processedModels.add(model.id);
        return true;
      }

    } catch (error: any) {
      // Handle "already exists" errors gracefully
      const errorMessage = error.message?.toLowerCase() || "";
      const isAlreadyExistsError = errorMessage.includes("already exists") || 
                                   errorMessage.includes("unable to save the model");

      if (isAlreadyExistsError) {
        try {
          const retrievedModel = await apiClient.modelMethods.getModelByReferenceName(modelName, targetGuid);
          if (retrievedModel) {
            referenceMapper.addMapping("model", model, retrievedModel);
            console.log(`✓ ${passName} ${ansiColors.underline(modelName)} ${ansiColors.bold.gray("found after error")} - Continuing.`);
            processedModels.add(model.id);
            return true;
          }
        } catch (retrieveError) {
          // Fall through to error handling
        }
      }

      console.error(ansiColors.red(`✗ ${passName} failed for ${modelName}:`), error.message);
      return false;
    }
  };

  console.log(ansiColors.yellow(`Starting 2-pass model synchronization for ${totalModels} models...`));

  // Pass 1: Create model stubs (empty fields)
  console.log(ansiColors.blue("\n=== Pass 1: Creating model stubs ==="));
  for (const model of models) {
    const success = await processModel(model, [], "Pass 1");
    if (success) successful++;
    else failed++;
    
    if (onProgress) onProgress(successful + failed, totalModels, failed > 0 ? "error" : "success");
  }

  // Pass 2: Update with full fields
  console.log(ansiColors.blue("\n=== Pass 2: Updating with full fields ==="));
  for (const model of models) {
    const success = await processModel(model, undefined, "Pass 2");
    if (!success) failed++;
    
    if (onProgress) onProgress(successful + failed, totalModels, failed > 0 ? "error" : "success");
  }

  // Final results
  successful = processedModels.size;
  const status: "success" | "error" = failed > 0 ? "error" : "success";

  console.log(ansiColors.yellow(`\n✓ Model synchronization complete: ${successful}/${totalModels} models processed successfully`));
  if (failed > 0) {
    console.log(ansiColors.red(`✗ ${failed} operations failed`));
  }

  if (onProgress) onProgress(totalModels, totalModels, status);
  return { successful, failed, skipped, status };
} 