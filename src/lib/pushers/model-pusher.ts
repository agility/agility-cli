import * as mgmtApi from "@agility/management-sdk";
import { getApiClient, state, getLoggerForGuid } from "../../core/state";
import { PusherResult } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";
import { Logs } from "core/logs";

/**
 * Simple change detection for models
 */

export async function pushModels(sourceData: mgmtApi.Model[], targetData: mgmtApi.Model[]): Promise<PusherResult> {
  const models: mgmtApi.Model[] = sourceData || [];
  const { sourceGuid, targetGuid } = state;
  const logger = getLoggerForGuid(sourceGuid[0]);

  if (!models || models.length === 0) {
    logger.log("INFO", "No models found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

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


    // Handle models that exist in target but have no mapping
    // This ensures downstream containers can find their model mappings
    const existsInTargetWithoutMapping = !mapping && targetModel;
    if (existsInTargetWithoutMapping) {
      // Create the mapping for existing target models (ensures containers can reference them)
      referenceMapper.addMapping(model, targetModel);
      // Add to skip list since model already exists and is up to date
      shouldSkip.push(model);
      continue; // Skip remaining conditions - mapping is now created, no further action needed
    }

    if ((!mapping && !targetModel)) {
      shouldCreateStub.push(model);
    }
    // if the mapping exists, and the source has changed, we need to update the fields
    // Added a special case for RichTextArea to handle the conflict scenario where the source has changed and the target has changed (first sync).
    // This will attempt to update the model, and write the mappings
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
    const result = await createNewModel(model, referenceMapper, apiClient, targetGuid[0], logger);
    if (result === "created") {
      stubCreated.push(model);
    } else {
      failed++;
    }
  }

  const modelsToUpdate = [...stubCreated, ...shouldUpdateFields];
  for (const model of modelsToUpdate) {
    const mapping = referenceMapper.getModelMapping(model, "source");
    const result = await updateExistingModel(model, mapping.targetID, referenceMapper, apiClient, targetGuid[0], logger);
    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  for (const model of shouldSkip) {
    logger.model.skipped(model, "up to date, skipping", targetGuid[0])
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
  targetGuid: string,
  logger: Logs
): Promise<"created" | "updated" | "skipped" | "failed"> => {
  try {
    // process the model without fields
    const createPayload = {
      ...model,
      id: 0,
      fields: [], // no fields for a stub
    };

    const newModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid);
    logger.model.created(model, "created", targetGuid)
    referenceMapper.addMapping(model, newModel);
    return "created";
  } catch (error: any) {
    logger.model.error(model, error, targetGuid)
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
  targetGuid: string,
  logger: Logs
): Promise<"updated" | "failed"> {
 
  try {
    const updatePayload = {
      ...sourceModel,
      id: targetID
    };

    const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid);
    logger.model.updated(sourceModel, "updated", targetGuid)
    referenceMapper.addMapping(sourceModel, updatedModel);
    return "updated";
  } catch (error: any) {
    const axiosErr = error?.innerError;
    console.error(`[model-pusher] SAVE FAILED for ${sourceModel?.referenceName}:`);
    console.error(`  message: ${error?.message}`);
    console.error(`  status:  ${axiosErr?.response?.status ?? axiosErr?.status ?? "n/a"}`);
    console.error(`  responseData: ${JSON.stringify(axiosErr?.response?.data ?? axiosErr?.data ?? null, null, 2)}`);
    logger.model.error(sourceModel, error, targetGuid)
    return "failed";
  }
}
