import * as mgmtApi from "@agility/management-sdk";
import { getApiClient, state, getLoggerForGuid } from "../../core/state";
import { PusherResult, FailureDetail } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";
import { Logs } from "core/logs";
import { preflightReport } from "../preflight/preflight-report";

/**
 * Two Agility models can share a `referenceName` while differing in `contentDefinitionTypeID`
 * (e.g. a Content List vs. a Module/Component named "PromoBanner"). A name-only lookup conflates
 * them (the PROD-1505 / PROD-2211 type-blind-lookup family). This compares the model TYPE in
 * addition to the name. `contentDefinitionTypeID` is present in the pulled model JSON but not on the
 * SDK `Model` type, so we read it defensively; when either side lacks it (older pulls / fixtures) we
 * fall back to name-only matching.
 */
function modelTypeMatches(a: mgmtApi.Model, b: mgmtApi.Model): boolean {
  const aType = (a as any)?.contentDefinitionTypeID;
  const bType = (b as any)?.contentDefinitionTypeID;
  if (aType === undefined || aType === null || bType === undefined || bType === null) return true;
  return aType === bType;
}

/**
 * Re-query the target for a model matching (referenceName, contentDefinitionTypeID).
 *
 * Used after a `saveModel` rejection to detect a false-negative — the SDK rethrows any failure as
 * "Unable to save the model." even when the API actually persisted the model (timeout-with-server-
 * completion, response-parse race, etc.). Returns the matching target model, or null if the re-query
 * fails or finds nothing. Matching by type avoids mistaking a same-name different-type collision for
 * a recovered save.
 */
async function findTargetModelAfterSave(
  sourceModel: mgmtApi.Model,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string
): Promise<mgmtApi.Model | null> {
  try {
    // includeDefaults + includeModules so both content models and module/component models are returned.
    const targetModels = await apiClient.modelMethods.getContentModules(true, targetGuid, true);
    return (
      (targetModels || []).find(
        (t) => t.referenceName === sourceModel.referenceName && modelTypeMatches(sourceModel, t)
      ) || null
    );
  } catch {
    return null;
  }
}

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
  let shouldSkip: { model: mgmtApi.Model; reason: string }[] = [];
  let stubCreated = [];

  for (const sourceModel of models) {
    if (!sourceModel.id || !sourceModel.referenceName) {
      logger.model.error(
        sourceModel,
        "Model is missing required properties (id or referenceName), skipping",
        targetGuid[0]
      );
      skipped++;
      continue;
    }

    const sourceMapping = referenceMapper.getModelMappingByID(sourceModel.id, "source");

    let targetModel: mgmtApi.Model = null;

    if (sourceMapping) {
      targetModel = targetData.find((targetModel) => targetModel.id === sourceMapping.targetID) || null;
    }

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
    const targetModelByReference = targetData.find(
      (targetModel) =>
        targetModel.referenceName === sourceModel.referenceName && modelTypeMatches(sourceModel, targetModel)
    );
    const existsInTargetWithoutMapping = !sourceMapping && targetModelByReference;
    if (existsInTargetWithoutMapping) {
      const includesDefault = modelDefaults.includes(sourceModel.referenceName.toLowerCase());

      if (includesDefault) {
        // Create the mapping for existing target models (ensures containers can reference them)
        referenceMapper.addMapping(sourceModel, targetModelByReference);
        // Add to skip list since model already exists and is up to date
        shouldSkip.push({ model: sourceModel, reason: "Skipping and adding default Agility mappings." });
        continue; // Skip remaining conditions - mapping is now created, no further action needed
      } else {
        targetModel = targetModelByReference;
        const targetMapping = targetModel.id ? referenceMapper.getModelMappingByID(targetModel.id, "target") : null;
        if (targetMapping && targetMapping.sourceID !== sourceModel.id) {
          logger.model.error(
            sourceModel,
            new Error(
              `A target model named "${sourceModel.referenceName}" exists but is not mapped to source ID ${sourceModel.id} (likely a rename or reassignment of the source model).`
            ),
            targetGuid[0]
          );
          throw new Error(
            `Model validation failed: mapping inconsistency for model "${sourceModel.referenceName}" (ID: ${sourceModel.id}). ` +
              `A mapping exists for the target model, but the source model ID does not match — this likely indicates ` +
              `a rename or reassignment on the source. Stopping sync to avoid a partial push; review the model mappings and re-run. Please contact AgilityCMS Support to resolve this issue`
          );
        }

        // PROD-2211: the model exists on the target by (referenceName, type) but has no mapping row
        // (e.g. a prior create succeeded server-side yet was logged as a false-negative failure, or a
        // model adopted by referenceName without a mapping ever being written). Previously this branch
        // set `targetModel` but fell through every downstream condition (all gated on `sourceMapping`),
        // so the model was silently dropped — not created, skipped, or failed — and the wedge never
        // self-healed. Write the mapping now so downstream containers/content can translate and so
        // re-syncs converge.
        referenceMapper.addMapping(sourceModel, targetModel);
        shouldSkip.push({
          model: sourceModel,
          reason: "Model already exists on target without a mapping; mapping row created.",
        });
        continue;
      }
    }

    if (!sourceMapping && !targetModel) {
      shouldCreateStub.push(sourceModel);
      continue;
    }
    // if the mapping exists, and the source has changed, we need to update the fields
    // Added a special case for RichTextArea to handle the conflict scenario where the source has changed and the target has changed (first sync).
    // This will attempt to update the model, and write the mappings
    if (
      (sourceMapping && hasSourceChanged && !hasTargetChanged) ||
      (sourceMapping && fieldCountChanged && !hasTargetChanged)
    ) {
      shouldUpdateFields.push(sourceModel);
      continue;
    }

    if (sourceMapping && (hasTargetChanged || hasSourceChanged) && state.overwrite) {
      shouldUpdateFields.push(sourceModel);
      continue;
    }

    // if the mapping exists, and the target has changed, we need to skip the model, not safe to update
    if (sourceMapping && hasTargetChanged) {
      shouldSkip.push({
        model: sourceModel,
        reason: "Warning: target model has changed! Add `--overwrite` flag to force update.",
      });
      continue;
    }

    // if the mapping exists, and the source and target have not changed, we need to skip the model
    if (sourceMapping && !hasSourceChanged && !hasTargetChanged && !state.overwrite) {
      shouldSkip.push({ model: sourceModel, reason: "Model has not changed, skipping." });
      continue;
    }

    if (sourceMapping && !hasSourceChanged && !hasTargetChanged) {
      shouldSkip.push({ model: sourceModel, reason: "Models have not changed, skipping." });
      continue;
    }
  }
  // Preflight (PROD-2203): report the planned model actions and skip all writes.
  // A "target has changed" skip is surfaced as a conflict since a real sync would
  // need --overwrite to proceed.
  if (state.preflight) {
    for (const model of shouldCreateStub) {
      preflightReport.record({ phase: "Models", action: "create", name: model.referenceName });
    }
    for (const model of shouldUpdateFields) {
      preflightReport.record({ phase: "Models", action: "update", name: model.referenceName });
    }
    for (const { model, reason } of shouldSkip) {
      const isConflict = /target model has changed/i.test(reason);
      preflightReport.record({
        phase: "Models",
        action: isConflict ? "conflict" : "skip",
        name: model.referenceName,
        detail: reason,
      });
    }
    return {
      status: "success",
      successful: shouldCreateStub.length + shouldUpdateFields.length,
      failed: 0,
      skipped: shouldSkip.length,
      failureDetails: [],
    };
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
      logger
    );
    // PROD-2211: `updateExistingModel` returns the string "updated" | "failed". A bare `if (result)`
    // treats "failed" as truthy, so failed field-updates were counted as successes — the run reported
    // "N successful, 0 failed" with a green banner while models had genuinely failed. Compare
    // explicitly so the summary, ERROR SUMMARY, and exit status reflect reality.
    if (result === "updated") {
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
    logger.model.skipped(model.model, model.reason, targetGuid[0]);
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
    logger.model.created(model, "created", targetGuid);
    referenceMapper.addMapping(model, newModel);
    return "created";
  } catch (error: any) {
    // PROD-2211: saveModel can reject even though the API created the model server-side. Before
    // declaring failure — which leaves the mapping file without a row and wedges future syncs —
    // re-query the target. If a model with the matching (referenceName, type) now exists, the stub
    // create really succeeded: write the mapping and report created.
    const recovered = await findTargetModelAfterSave(model, apiClient, targetGuid);
    if (recovered) {
      logger.model.created(model, "created", targetGuid);
      referenceMapper.addMapping(model, recovered);
      return "created";
    }
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
  logger: Logs
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
    // PROD-2211: saveModel can reject even though the field update was persisted server-side. Re-query
    // the target; treat it as a recovered update ONLY when the saved field set matches the source
    // (field count). A genuine reject — e.g. a 404 "Definition for setting X not found" — leaves the
    // fields unapplied, so the count won't match and it correctly stays a failure.
    const recovered = await findTargetModelAfterSave(sourceModel, apiClient, targetGuid);
    if (recovered && (recovered.fields?.length ?? 0) === (sourceModel.fields?.length ?? 0)) {
      logger.model.updated(sourceModel, "updated", targetGuid);
      referenceMapper.addMapping(sourceModel, recovered);
      return "updated";
    }
    logger.model.error(sourceModel, error, targetGuid);
    return "failed";
  }
}
