import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ReferenceMapper } from "../shared/reference-mapper";
import { logModelDifferences } from "../loggers";
import { areModelsDifferent } from "../models";
import { findModelInTargetInstance } from "../finders/model-finder";

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
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> => {
    const modelName = model.referenceName;
    const id = model.id;
    const isStubPass = Array.isArray(fields) && fields.length === 0;

    try {
      // Check if model exists using dedicated finder (handles mapping automatically)
      const existingModel = await findModelInTargetInstance(model, apiClient, targetGuid[0], referenceMapper);

      if (existingModel) {
        // Model exists - check if we need to update it
        if (isStubPass) {
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)}, ${ansiColors.bold.gray("exists")}`);
          processedModels.add(model.id);
          return 'skipped';
        }

        // Compare models for differences
        const sourceModel = { ...model, fields: fields || model.fields || [] };
        const targetModel = { ...existingModel, fields: existingModel.fields || [] };

        if (!overwrite && !areModelsDifferent(sourceModel, targetModel, test, referenceMapper)) {
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${ansiColors.bold.gray("is identical, skipping")}`);
          processedModels.add(model.id);
          return 'skipped';
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

        const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid[0]);
        referenceMapper.addMapping("model", model, updatedModel);

        console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${passName} ${ansiColors.bold.green("updated")}`);
        processedModels.add(model.id);
        return 'updated';

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

        const createdModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid[0]);
        
        if (!createdModel || !createdModel.id) {
          throw new Error(`Failed to create model ${modelName} - no ID returned`);
        }

        referenceMapper.addMapping("model", model, createdModel);
        console.log(`✓ ${passName} ${ansiColors.bold.cyan("created")} ${ansiColors.underline(modelName)} (ID: ${createdModel.id})`);
        processedModels.add(model.id);
        return 'created';
      }

    } catch (error: any) {

      console.log(await error);
      // Handle "already exists" errors gracefully
      const errorMessage = error.message?.toLowerCase() || "";
      const isAlreadyExistsError = errorMessage.includes("already exists") || 
                                   errorMessage.includes("unable to save the model");

      if (isAlreadyExistsError) {
        try {
          const retrievedModel = await findModelInTargetInstance(model, apiClient, targetGuid[0], referenceMapper);
          if (retrievedModel) {
            console.log(`✓ ${passName} ${ansiColors.underline(modelName)} ${ansiColors.bold.gray("found after error")} - Continuing.`);
            processedModels.add(model.id);
            return 'skipped';
          }
        } catch (retrieveError) {
          // Fall through to error handling
        }
      }

      // Enhanced error reporting with full API response details
      console.error(ansiColors.red(`✗ ${passName} failed for ${modelName}: ${error}`));
      
      // PRIMARY: Show the API error response that explains WHY it failed
      if (error.response) {
        console.error(ansiColors.red(`   📊 HTTP Status: ${error.response.status} ${error.response.statusText}`));
        if (error.response.data) {
          console.error(error);
          console.error(ansiColors.red(JSON.stringify(error.response.data, null, 2)));
        }
      } else {
        console.error(ansiColors.red(`   ⚠️ No API response available - may be a network or connection error`));
      }
      
      // SECONDARY: Show the request payload only if verbose debugging is needed
      if (state.verbose) {
        const modelFields = fields || model.fields || [];
        const attemptedPayload = {
          ...model,
          fields: modelFields.map(field => {
            const cleanField = { ...field };
            delete cleanField.fieldID;
            return cleanField;
          })
        };
        console.error(ansiColors.yellow(error));
        console.error(ansiColors.yellow(JSON.stringify(attemptedPayload, null, 2)));
      }
      
      // Additional context for debugging
      // console.error(ansiColors.gray(`   💡 Focus on the API Error Response above to understand why the model save failed`));
      
      return 'failed';
    }
  };

  // console.log(ansiColors.yellow(`Starting 2-pass model synchronization for ${totalModels} models...`));

  console.log('\n')
  // Track which models were successful (created OR updated) vs skipped
  const successfulModels = new Set<number>();
  const skippedModels = new Set<number>();

  // Pass 1: Create model stubs (empty fields)
  for (const model of models) {
    const result = await processModel(model, [], "Models first pass");
    if (result === 'created' || result === 'updated') {
      successfulModels.add(model.id);
    } else if (result === 'skipped') {
      skippedModels.add(model.id);
    } else {
      failed++;
    }
    
    if (onProgress) onProgress(successfulModels.size + skippedModels.size + failed, totalModels, failed > 0 ? "error" : "success");
  }

  // Pass 2: Update with full fields
  for (const model of models) {
    const result = await processModel(model, undefined, "Models second pass,");
    if (result === 'created' || result === 'updated') {
      successfulModels.add(model.id);
      // Remove from skipped if it was processed successfully in pass 2
      skippedModels.delete(model.id);
    } else if (result === 'skipped' && !successfulModels.has(model.id)) {
      // Only count as skipped if it was also skipped in pass 1
      skippedModels.add(model.id);
    } else if (result === 'failed') {
      failed++;
    }
    
    if (onProgress) onProgress(successfulModels.size + skippedModels.size + failed, totalModels, failed > 0 ? "error" : "success");
  }

  // Final results - count both created and updated as successful
  successful = successfulModels.size;
  skipped = skippedModels.size;
  const status: "success" | "error" = failed > 0 ? "error" : "success";

  if (failed > 0) {
    console.log(ansiColors.red(`✗ ${failed} operations failed`));
  }

  if (onProgress) onProgress(totalModels, totalModels, status);
  return { successful, failed, skipped, status };
} 