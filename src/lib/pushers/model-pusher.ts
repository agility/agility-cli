import * as mgmtApi from "@agility/management-sdk";
import { getApiClient, state, getLoggerForGuid } from "../../core/state";
import { PusherResult, FailureDetail } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";
import { Logs } from "core/logs";

/**
 * Simple change detection for models
 */
export async function pushModels(sourceData: mgmtApi.Model[], targetData: mgmtApi.Model[]): Promise<PusherResult> {
  const models: mgmtApi.Model[] = sourceData || [];
  const { sourceGuid, targetGuid } = state;
  const logger = getLoggerForGuid(sourceGuid[0])!;

  const modelDefaults: string[] = [
    "richtextarea",
    "formbuilder",
    "agilitycss",
    "agilitycodetemplate",
    "agilityjavascript",
    "agilityformbuilder",
  ];

  if (!models || models.length === 0) {
    logger.log("INFO", "No models found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const referenceMapper = new ModelMapper(sourceGuid[0], targetGuid[0]);

  const apiClient = getApiClient();

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const failureDetails: FailureDetail[] = [];

  let shouldCreateStub = [];
  let shouldUpdateFields = [];
  let shouldSkip = [];
  let stubCreated = [];

  for (const sourceModel of models) {
    if (!sourceModel.id || !sourceModel.referenceName) {
      logger.model.error(
        sourceModel,
        "Model is missing required properties (id or referenceName), skipping",
        targetGuid[0],
      );
      skipped++;
      continue;
    }

    const sourceMapping = referenceMapper.getModelMappingByID(sourceModel.id, "source");
    const targetModel =
      targetData.find((targetModel) => targetModel.referenceName === sourceModel.referenceName) || null;

    const modelLastModifiedDate = new Date(sourceModel.lastModifiedDate);
    const targetLastModifiedDate = targetModel ? new Date(targetModel.lastModifiedDate) : null;
    const mappingLastModifiedDate = sourceMapping ? new Date(sourceMapping.targetLastModifiedDate) : null;
    const hasSourceChanged = modelLastModifiedDate > targetLastModifiedDate;
    const hasTargetChanged = targetLastModifiedDate > mappingLastModifiedDate;
    const sourceFieldCount = sourceModel?.fields?.length || 0;
    const targetFieldCount = targetModel?.fields?.length || 0;
    const fieldCountChanged = sourceFieldCount !== targetFieldCount;

    // TODO: we only care about the field count if the target model has NO fields and the source model has fields

    // Handle models that exist in target but have no mapping
    // This ensures downstream containers can find their model mappings
    const existsInTargetWithoutMapping = !sourceMapping && targetModel;
    if (existsInTargetWithoutMapping) {
      const includesDefault = modelDefaults.includes(sourceModel.referenceName.toLowerCase());

      if (includesDefault) {
        // Create the mapping for existing target models (ensures containers can reference them)
        referenceMapper.addMapping(sourceModel, targetModel);
        // Add to skip list since model already exists and is up to date
        shouldSkip.push(sourceModel);
        continue; // Skip remaining conditions - mapping is now created, no further action needed
      } else {
        const targetMapping = targetModel.id ? referenceMapper.getModelMappingByID(targetModel.id, "target") : null;
        if (targetMapping && targetMapping.sourceID !== sourceModel.id) {
          logger.model.error(
            sourceModel,
            new Error(
              `A target model named "${sourceModel.referenceName}" exists but is not mapped to source ID ${sourceModel.id} (likely a rename or reassignment of the source model).`,
            ),
            targetGuid[0],
          );
          throw new Error(
            `Model validation failed: mapping inconsistency for model "${sourceModel.referenceName}" (ID: ${sourceModel.id}). ` +
              `A mapping exists for the target model, but the source model ID does not match — this likely indicates ` +
              `a rename or reassignment on the source. Stopping sync to avoid a partial push; review the model mappings and re-run.`,
          );
        }
      }
    }

    if (!sourceMapping && !targetModel) {
      shouldCreateStub.push(sourceModel);
      continue;
    }
    // if the mapping exists, and the source has changed, we need to update the fields
    // Added a special case for RichTextArea to handle the conflict scenario where the source has changed and the target has changed (first sync).
    // This will attempt to update the model, and write the mappings
    if ((sourceMapping && hasSourceChanged) || (sourceMapping && fieldCountChanged)) {
      shouldUpdateFields.push(sourceModel);
      continue;
    }

    if (sourceMapping && (hasTargetChanged || hasSourceChanged) && state.overwrite) {
      shouldUpdateFields.push(sourceModel);
      continue;
    }

    // if the mapping exists, and the target has changed, we need to skip the model, not safe to update
    if (sourceMapping && hasTargetChanged) {
      shouldSkip.push(sourceModel);
      continue;
    }

    // if the mapping exists, and the source and target have not changed, we need to skip the model
    if (sourceMapping && !hasSourceChanged && !hasTargetChanged && !state.overwrite) {
      shouldSkip.push(sourceModel);
      continue;
    }

    if (sourceMapping && !hasSourceChanged && !hasTargetChanged && state.overwrite) {
      shouldSkip.push(sourceModel);
      continue;
    }
  }
  for (const model of shouldCreateStub) {
    const result = await createNewModel(model, referenceMapper, apiClient, targetGuid[0], logger);
    if (result === "created") {
      stubCreated.push(model);
    } else {
      failed++;
      failureDetails.push({
        name: model.referenceName,
        error: `Failed to create model "${model.referenceName}" (ID: ${model.id})`,
        guid: sourceGuid[0],
      });
    }
  }

  const modelsToUpdate = [...stubCreated, ...shouldUpdateFields];
  for (const model of modelsToUpdate) {
    const sourceMapping = referenceMapper.getModelMapping(model, "source");
    const result = await updateExistingModel(
      model,
      sourceMapping.targetID,
      referenceMapper,
      apiClient,
      targetGuid[0],
      logger,
    );
    if (result) {
      successful++;
    } else {
      failed++;
      failureDetails.push({
        name: model.referenceName,
        error: `Failed to update model "${model.referenceName}" (target ID: ${sourceMapping.targetID})`,
        guid: sourceGuid[0],
      });
    }
  }

  for (const model of shouldSkip) {
    logger.model.skipped(model, "up to date, skipping", targetGuid[0]);
    skipped++;
  }

  return {
    status: "success",
    successful,
    failed,
    skipped,
    failureDetails,
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
  logger: Logs,
): Promise<"created" | "updated" | "skipped" | "failed"> => {
  try {
    // process the model without fields
    const createPayload = {
      ...model,
      id: 0,
      fields: [], // no fields for a stub
    };

    const newModel = await apiClient.modelMethods.saveModel(createPayload, targetGuid);
    logger.model.created(model, "created", targetGuid);
    referenceMapper.addMapping(model, newModel);
    return "created";
  } catch (error: any) {
    logger.model.error(model, error, targetGuid);
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
  logger: Logs,
): Promise<"updated" | "failed"> {
  try {
    const updatePayload = {
      ...sourceModel,
      id: targetID,
    };

    const updatedModel = await apiClient.modelMethods.saveModel(updatePayload, targetGuid);
    logger.model.updated(sourceModel, "updated", targetGuid);
    referenceMapper.addMapping(sourceModel, updatedModel);
    return "updated";
  } catch (error: any) {
    const axiosErr = error?.innerError;
    console.error(`[model-pusher] SAVE FAILED for ${sourceModel?.referenceName}:`);
    console.error(`  message: ${error?.message}`);
    console.error(`  status:  ${axiosErr?.response?.status ?? axiosErr?.status ?? "n/a"}`);
    console.error(`  responseData: ${JSON.stringify(axiosErr?.response?.data ?? axiosErr?.data ?? null, null, 2)}`);
    logger.model.error(sourceModel, error, targetGuid);
    return "failed";
  }
}
