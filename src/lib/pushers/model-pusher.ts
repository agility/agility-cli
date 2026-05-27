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

  for (const model of models) {
    if (!model.id || !model.referenceName) {
      logger.model.error(model, "Model is missing required properties (id or referenceName), skipping", targetGuid[0]);
      skipped++;
      continue;
    }

    const mapping = referenceMapper.getModelMappingByID(model.id, "source");
    const targetModel = targetData.find((targetModel) => targetModel.referenceName === model.referenceName) || null;

    // A target model exists by referenceName but has no source mapping, while this model's ID is
    // already used as a target ID in another mapping — a sign the source model was renamed/reassigned.
    if (!mapping && targetModel) {
      const targetMapping = referenceMapper.getModelMappingByID(model.id, "target");
      if (targetMapping && targetMapping.targetID === model.id) {
        logger.model.error(
          model,
          new Error(
            `A target model named "${model.referenceName}" exists but is not mapped to source ID ${model.id} (likely a rename or reassignment of the source model).`,
          ),
          targetGuid[0],
        );
        throw new Error(
          `Model validation failed: mapping inconsistency for model "${model.referenceName}" (ID: ${model.id}). ` +
            `A mapping exists for the target model, but the source model ID does not match — this likely indicates ` +
            `a rename or reassignment on the source. Stopping sync to avoid a partial push; review the model mappings and re-run.`,
        );
      }
    }

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

    if (!mapping && !targetModel) {
      shouldCreateStub.push(model);
      continue;
    }
    // if the mapping exists, and the source has changed, we need to update the fields
    // Added a special case for RichTextArea to handle the conflict scenario where the source has changed and the target has changed (first sync).
    // This will attempt to update the model, and write the mappings
    if ((mapping && hasSourceChanged) || (mapping && fieldCountChanged)) {
      shouldUpdateFields.push(model);
      continue;
    }

    if (mapping && (hasTargetChanged || hasSourceChanged) && state.overwrite) {
      shouldUpdateFields.push(model);
      continue;
    }

    // if the mapping exists, and the target has changed, we need to skip the model, not safe to update
    if (mapping && hasTargetChanged) {
      shouldSkip.push(model);
      continue;
    }

    // if the mapping exists, and the source and target have not changed, we need to skip the model
    if (mapping && !hasSourceChanged && !hasTargetChanged && !state.overwrite) {
      shouldSkip.push(model);
      continue;
    }

    if (mapping && !hasSourceChanged && !hasTargetChanged && state.overwrite) {
      shouldSkip.push(model);
      continue;
    }
  }

  // Check for when a model renamed on the source whose old reference name was reused by a new model.
  // ie. Modal123 was renamed to Model123Legacy
  // We stop the sync before pushing anything and warn the user to fix
  const orphanedUpdates = shouldUpdateFields.filter((model) => !referenceMapper.getModelMapping(model, "source"));
  if (orphanedUpdates.length > 0) {
    const details = orphanedUpdates.map((model) => `"${model.referenceName}" (ID: ${model.id})`).join(", ");
    for (const model of orphanedUpdates) {
      logger.model.error(
        model,
        new Error(`Source mapping was reassigned to another model (likely a source-side rename).`),
        targetGuid[0],
      );
    }
    throw new Error(
      `Model validation failed: ${orphanedUpdates.length} model(s) lost their source mapping during ` +
        `change detection and cannot be updated: ${details}. This usually means a model was renamed on ` +
        `the source and its old reference name was reused, so its mapping was reassigned to another ` +
        `model. Stopping sync to avoid a partial push — resolve the rename/mapping and re-run.`,
    );
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
    const mapping = referenceMapper.getModelMapping(model, "source");

    const result = await updateExistingModel(
      model,
      mapping.targetID,
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
        error: `Failed to update model "${model.referenceName}" (target ID: ${mapping.targetID})`,
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
