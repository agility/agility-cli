import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { getState, getApiClient, state } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";

/**
 * Simple change detection for models
 */

export async function pushModels(sourceData: mgmtApi.Model[], targetData: mgmtApi.Model[]): Promise<PusherResult> {
  const models: mgmtApi.Model[] = sourceData || [];

  if (!models || models.length === 0) {
    console.log("No models found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const { sourceGuid, targetGuid } = state;
  const referenceMapper = new ModelMapper(sourceGuid[0], targetGuid[0]);

  const apiClient = getApiClient();

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  let shouldCreateStub = [];
  let shouldUpdateFields = [];
  let shouldSkip = [];
  let stubCreated = [];

  for (const model of models) {
    // if(model.referenceName === "Post"){
    //   console.log(model);
    // }
    const mapping = referenceMapper.getModelMapping(model, "source");
    const targetModel = targetData.find((targetModel) => targetModel.referenceName === model.referenceName) || null;

    const modelLastModifiedDate = new Date(model.lastModifiedDate);
    const targetLastModifiedDate = targetModel ? new Date(targetModel.lastModifiedDate) : null;
    const mappingLastModifiedDate = mapping ? new Date(mapping.targetLastModifiedDate) : null;

    const hasSourceChanged = modelLastModifiedDate > targetLastModifiedDate;
    const hasTargetChanged = targetLastModifiedDate > mappingLastModifiedDate;

    const sourceFieldCount = model?.fields?.length || 0;
    const targetFieldCount = targetModel?.fields?.length || 0;
    const fieldCountChanged = sourceFieldCount !== targetFieldCount;

    // TODO: we only care about the field count if the target model has NO fields and the source model has fields

    if (!mapping && !targetModel) {
      shouldCreateStub.push(model);
    }
    // if the mapping exists, and the source has changed, we need to update the fields
    if ((mapping && hasSourceChanged) || (mapping && fieldCountChanged)) {
      shouldUpdateFields.push(model);
    }
    // if the mapping exists, and the target has changed, we need to skip the model, not safe to update
    if (mapping && hasTargetChanged) {
      shouldSkip.push(model);
    }
    // if the mapping exists, and the source and target have not changed, we need to skip the model
    if (mapping && !hasSourceChanged && !hasTargetChanged && !state.overwrite) {
      shouldSkip.push(model);
    }

    if(mapping && !hasSourceChanged && !hasTargetChanged && state.overwrite){
      shouldUpdateFields.push(model);
    }
  }

  for (const model of shouldCreateStub) {
    const result = await createNewModel(model, referenceMapper, apiClient, targetGuid[0]);
    if (result === "created") {
      stubCreated.push(model);
    } else {
      failed++;
    }
  }

  const modelsToUpdate = [...stubCreated, ...shouldUpdateFields];
  for (const model of modelsToUpdate) {
    const mapping = referenceMapper.getModelMapping(model, "source");
    // const targetModel = targetData.find((targetModel) => targetModel.referenceName === model.referenceName) || null;
    const result = await updateExistingModel(model, mapping.targetID, referenceMapper, apiClient, targetGuid[0]);
    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  for (const model of shouldSkip) {
    console.log(`✓ Model ${ansiColors.cyan.underline(model.referenceName)} ${ansiColors.bold.yellow("up to date, skipping")}`);
    skipped++;
  }

  return {
    status: "success",
    successful,
    failed,
    skipped,
  };
}

/**
 * If we're creating a model, we need to create a stub, then update the fields
 * */
const createNewModel = async (
  model: mgmtApi.Model,
  referenceMapper: ModelMapper,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string
): Promise<"created" | "updated" | "skipped" | "failed"> => {
  try {
    // process the model without fields
    const createPayload = {
      ...model,
      id: 0,
      fields: [], // no fields for a stub
    };

    const newModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid);
    console.log(`✓ Model ${ansiColors.cyan.underline(model.referenceName)} stub ${ansiColors.bold.green("created")}`);
    referenceMapper.addMapping(model, newModel);
    return "created";
  } catch (error: any) {
    console.error(`✗ Error creating model ${model.referenceName}:`, error.message);
    return "failed";
  }
};

/**
 * Update an existing model in the target instance
 */
async function updateExistingModel(
  sourceModel: mgmtApi.Model,
  targetID: number,
  referenceMapper: ModelMapper,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string
): Promise<"updated" | "failed"> {
 

  const fields = sourceModel?.fields || [];

  try {
    const updatePayload = {
      ...sourceModel,
      id: targetID,
      // lastModifiedDate: targetModel.lastModifiedDate,
      fields: (fields || sourceModel.fields || []).map((field) => {
        const cleanField = { ...field };
        delete cleanField.fieldID; // Remove to prevent API issues

        // Clean up Content field settings
        if (cleanField.type === "Content" && cleanField.settings?.ContentDefinition) {
          const { ContentDefinition, ...otherSettings } = cleanField.settings;
          cleanField.settings = otherSettings;
        }

        return cleanField;
      }),
    };

    const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid);
    console.log(`✓ Model ${ansiColors.cyan.underline(sourceModel.referenceName)} ${ansiColors.bold.green("updated")}`);
    referenceMapper.addMapping(sourceModel, updatedModel);
    return "updated";
  } catch (error: any) {
    console.error(`✗ Error updating model ${sourceModel.referenceName}:`, error.message);
    return "failed";
  }
}
