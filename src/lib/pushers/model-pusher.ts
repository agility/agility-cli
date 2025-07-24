import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient, state } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";

/**
 * Simple change detection for models
 */


export async function pushModels(
  sourceData: mgmtApi.Model[],
  targetData: mgmtApi.Model[],
): Promise<PusherResult> {



  const models: mgmtApi.Model[] = sourceData || [];

  if (!models || models.length === 0) {
    console.log("No models found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const { sourceGuid, targetGuid } = state;
  const referenceMapper = new ModelMapper(sourceGuid[0], targetGuid[0]);

  const apiClient = getApiClient();
  const totalModels = models.length;

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  /**
   * Process a single model for STUB creation ONLY
   */
  const processModelStub = async (
    model: mgmtApi.Model
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> => {
    const modelName = model.referenceName;


    try {
      // Use enhanced finder to determine what action to take
      const existingMapping = referenceMapper.getModelMapping(model, "source");

      if (existingMapping) return 'skipped'; // If mapping exists, skip stub creation

      // Model doesn't exist - create new one
      try {
        const newModel = await createNewModel(model, [], apiClient, targetGuid[0]);
        console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} stub ${ansiColors.bold.green("created")}`);

        // Store mapping for both stub and full passes so Pass 2 can find stubs created in Pass 1
        referenceMapper.addMapping(model, newModel);

        //push the newly created model to the target data so the full pass can find it
        targetData.push(newModel);
        return 'created';
      } catch (error: any) {
        console.log(model)
        console.log(ansiColors.magenta(`error: ${JSON.stringify(error)}`));
        console.error(`✗ Error creating model ${modelName}:`, error.message);
        return 'failed';
      }

    } catch (error: any) {
      console.error(`✗ Error processing model stub ${modelName}:`, error.message);
      return 'failed';
    }
  };

  /**
     * Process a single model - handles both creation and updates
     */
  const processModelFull = async (
    model: mgmtApi.Model,
    fields: any[] | undefined,
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> => {
    const modelName = model.referenceName;

    try {
      // Use enhanced finder to determine what action to take
      const existingMapping = referenceMapper.getModelMapping(model, "source");

      if (!existingMapping) {
        //if no mapping exists, we have a problem.
        console.error(`✗ No mapping found for model ${modelName}`);
        return 'failed';
      }

      const targetModel = targetData.find(targetModel => targetModel.id === existingMapping?.targetID) || null;

      const targetFieldCount = targetModel?.fields.length || 0
      const sourceFieldCount = fields?.length || 0;

      //we only care about the field count if the target model has NO fields and the source model has fields
      const fieldCountChanged = targetFieldCount === 0 && sourceFieldCount > 0;

      //consider the target as safe if it exists, has no changes, and the field count hasn't changed
      const hasTargetChanges = referenceMapper.hasTargetChanged(targetModel);

      //consider the source as changed if it has a mapping and the target has changes
      // or if the field count has changed (e.g. new fields added, or we have NO fields yet because of the first stub pass)
      const hasSourceChanges = referenceMapper.hasSourceChanged(model) || fieldCountChanged;

      const isConflict = hasTargetChanges && hasSourceChanges;
      let shouldUpdate = !hasTargetChanges && hasSourceChanges;
      const shouldSkip = hasTargetChanges || !hasSourceChanges;

      if (isConflict) {

        const srcType = (model as any).contentDefinitionTypeID
        const targetType = (targetModel as any).contentDefinitionTypeID;

        // If both source and target have changes, we cannot proceed automatically
        const srcUrl = `https://app.agilitycms.com/instance/${sourceGuid[0]}/${state.locale[0]}/${srcType == 2 ? 'componentmodels' : 'contentmodels'}/${model.id}`;
        const targetUrl = `https://app.agilitycms.com/instance/${targetGuid[0]}/${state.locale[0]}/${targetType == 2 ? 'componentmodels' : 'contentmodels'}/${targetModel.id}`;
        console.warn(`⚠️  Model ${ansiColors.cyan.underline(modelName)} has conflicts - target has changes and source has changes. Manual resolution required.`);
        console.warn(`   - Source Url: ${ansiColors.blue(srcUrl)}`);
        console.warn(`   - Target Url: ${ansiColors.blue(targetUrl)}`);
        return 'skipped';
      } else if (shouldUpdate) {
        // Model exists but needs updating
        try {
          const updatedModel = await updateExistingModel(model, targetModel, fields, apiClient, targetGuid[0]);
          const updateType = "fields";
          console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${updateType} ${ansiColors.bold.green("updated")}`);

          // Always store mapping for updates (both stub and full passes)
          referenceMapper.addMapping(model, updatedModel);
          return 'updated';
        } catch (error: any) {
          console.error(`✗ Error updating model ${modelName}:`, error.message);
          return 'failed';
        }

      } else if (shouldSkip) {
        console.log(`✓ Model ${ansiColors.cyan.underline(modelName)} ${ansiColors.bold.gray("is up to date, skipping")}`);
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
    const result = await processModelStub(model);

    // Don't count in Pass 1 - only track failures for immediate feedback
    if (result === 'failed') {
      failed++;
    }
  }

  console.log(ansiColors.cyan("\n🔄 Pass 2: Full model definitions"));
  for (const model of models) {
    const result = await processModelFull(model, model.fields);

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
