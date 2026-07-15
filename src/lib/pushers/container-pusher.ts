import * as mgmtApi from "@agility/management-sdk";
import { ApiClient } from "@agility/management-sdk";
import { getLoggerForGuid, state, getBlockedModelByID } from "core/state";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { Logs } from "core/logs";
import { FailureDetail, PusherResult } from "types/sourceData";
import { preflightReport } from "../preflight/preflight-report";

/**
 * Container pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions
 */
export async function pushContainers(
  sourceData: mgmtApi.Container[],
  targetData: mgmtApi.Container[],
): Promise<PusherResult> {


  // Extract data from sourceData - unified parameter pattern
  const sourceContainers: mgmtApi.Container[] = sourceData || [];
  const { sourceGuid, targetGuid, cachedApiClient: apiClient, overwrite } = state;
  const logger = getLoggerForGuid(sourceGuid[0]);

  if (!sourceContainers || sourceContainers.length === 0) {
    logger.log("INFO", "No containers found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let processedCount = 0;
  let overallStatus: "success" | "error" = "success";
  const failureDetails: FailureDetail[] = [];

  const containerMapper = new ContainerMapper(sourceGuid[0], targetGuid[0]);
  const modelMapper = new ModelMapper(sourceGuid[0], targetGuid[0]);

  // PROD-2315 (Tier 2): a container whose model mapping is missing is normally logged as a generic
  // "Target model mapping not found". If the model is missing because of a cross-kind reference-name
  // collision, attribute the skip to that collision (and surface it in the grouped ERROR SUMMARY).
  const recordModelMappingSkip = (container: mgmtApi.Container) => {
    const blocked = getBlockedModelByID(container.contentDefinitionID);
    if (blocked) {
      const detail = `blocked by model conflict "${blocked.referenceName}": ${blocked.reason}`;
      logger.container.skipped(container, detail, targetGuid[0]);
      preflightReport.record({ phase: "Containers", action: "skip", name: container.referenceName, detail });
      failureDetails.push({
        name: container.referenceName,
        error: detail,
        guid: sourceGuid[0],
        blockedBy: blocked.referenceName,
      });
    } else {
      logger.container.skipped(container, "Target model mapping not found", targetGuid[0]);
      preflightReport.record({
        phase: "Containers",
        action: "skip",
        name: container.referenceName,
        detail: "target model mapping not found",
      });
    }
  };

  for (const sourceContainer of sourceContainers) {
    //SPECIAL CASE for fixed Agility containers
    if (
      sourceContainer.referenceName === "AgilityCSSFiles" ||
      sourceContainer.referenceName === "AgilityJavascriptFiles" ||
      sourceContainer.referenceName === "AgilityGlobalCodeTemplates" ||
      sourceContainer.referenceName === "AgilityModuleCodeTemplates" ||
      sourceContainer.referenceName === "AgilityPageCodeTemplates"
    ) {
      //ignore these containers
      continue;
    }

    let currentStatus: "success" | "error" = "success";
    let shouldCreate = false;
    let shouldSkip = false;
    let shouldUpdate = false;

    const modelMapping = modelMapper.getModelMappingByID(sourceContainer.contentDefinitionID, "source");
    let targetModelID = -1;

    // Check if target container model mapping exists before attempting to create
    if (sourceContainer.contentDefinitionID === 1) {
      //special case for RichTextArea component models - id is ALWAYS 1
      targetModelID = 1; // use the default RichTextArea model
    } else {
      if (modelMapping) {
        targetModelID = modelMapping.targetID;
      }
    }

    try {
      // STEP 1: Find existing mapping
      const existingMapping = containerMapper.getContainerMappingByContentViewID(
        sourceContainer.contentViewID,
        "source"
      );

      // if no mapping found, we should be creating the container
      shouldCreate = existingMapping === null;

      if (!shouldCreate) {
        // get the target container, check if the source and targets need updates
        const targetContainer: mgmtApi.Container =
          targetData.find(
            (targetContainer: mgmtApi.Container) =>
              targetContainer.contentViewID === existingMapping.targetContentViewID
          ) || null;

        if (!targetContainer) {
          // Container exists and is up to date - skip
          logger.container.skipped(
            sourceContainer,
            `target container: ${existingMapping.targetReferenceName} was deleted, skipping!`,
            targetGuid[0]
          );
          preflightReport.record({
            phase: "Containers",
            action: "skip",
            name: sourceContainer.referenceName,
            detail: "target container was deleted",
          });
          skipped++;
          continue;
        }

        const hasTargetChanges = containerMapper.hasTargetChanged(targetContainer);
        const hasSourceChanges = containerMapper.hasSourceChanged(sourceContainer);
        shouldUpdate = !hasTargetChanges && hasSourceChanges;
        shouldSkip = !hasSourceChanges && !hasTargetChanges;

        if (overwrite && hasTargetChanges) {
          shouldUpdate = true;
          shouldSkip = false;
        }

        if (targetModelID < 1) {
          recordModelMappingSkip(sourceContainer);
          skipped++;
        } else if (shouldSkip) {
          // Container exists and is up to date - skip
          logger.container.skipped(sourceContainer, "up to date, skipping", targetGuid[0]);
          preflightReport.record({
            phase: "Containers",
            action: "skip",
            name: sourceContainer.referenceName,
            detail: "up to date",
          });
          skipped++;
        } else if (hasTargetChanges && !overwrite) {
          // Container exists and is up to date - skip
          logger.container.error(sourceContainer, "Conflict detected, use --overwrite to force changes", targetGuid[0]);
          preflightReport.record({
            phase: "Containers",
            action: "conflict",
            name: sourceContainer.referenceName,
            detail: "target changed; use --overwrite to force",
          });
          skipped++;
        } else if (shouldUpdate && state.preflight) {
          // Preflight: would update, but skip the write.
          preflightReport.record({ phase: "Containers", action: "update", name: sourceContainer.referenceName });
          successful++;
        } else if (shouldUpdate) {
          // Container exists but needs updating
          const updateResult = await updateExistingContainer(
            sourceContainer,
            targetContainer,
            apiClient,
            targetGuid[0],
            targetModelID,
            logger
          );

          if (updateResult) {
            logger.container.updated(sourceContainer, "updated", targetGuid[0]);
            const sourceMapping = containerMapper.getContainerMapping(sourceContainer, "source");
            const targetMapping = containerMapper.getContainerMapping(targetContainer, "target");

            if (sourceMapping !== targetMapping) {
              throw new Error(
                `Invalid Mappings detected! Source containerID: ${sourceContainer.contentViewID}, Target containerID: ${targetContainer.contentViewID}`
              );
            }

            containerMapper.updateMapping(sourceContainer, updateResult, sourceMapping);
            successful++;
          } else {
            logger.container.error(sourceContainer, "Failed to update container", targetGuid[0]);
            failed++;
            currentStatus = "error";
            overallStatus = "error";
            failureDetails.push({
              name: sourceContainer.referenceName,
              error: `Failed to update container "${sourceContainer.referenceName}" (ID: ${sourceContainer.contentViewID})`,
              guid: sourceGuid[0],
            });
          }
        }
      }

      if (shouldCreate) {
        // Container doesn't exist - create new one
        if (targetModelID < 1) {
          recordModelMappingSkip(sourceContainer);
          skipped++;
        } else if (state.preflight) {
          // Preflight: would create, but skip the write.
          preflightReport.record({ phase: "Containers", action: "create", name: sourceContainer.referenceName });
          successful++;
        } else {
          // Container doesn't exist - create new one
          const createResult = await createNewContainer(
            sourceContainer,
            apiClient,
            targetGuid[0],
            targetModelID,
            logger
          );

          if (createResult) {
            logger.container.created(sourceContainer, "created", targetGuid[0]);
            containerMapper.addMapping(sourceContainer, createResult);
            successful++;
          } else {
            logger.container.error(sourceContainer, "Failed to create container", targetGuid[0]);
            failed++;
            currentStatus = "error";
            overallStatus = "error";
            failureDetails.push({
              name: sourceContainer.referenceName,
              error: `Failed to create container "${sourceContainer.referenceName}"`,
              guid: sourceGuid[0],
            });
          }
        }
      }
    } catch (error: any) {
      logger.container.error(sourceContainer, error, targetGuid[0]);
      failed++;
      currentStatus = "error";
      overallStatus = "error";
      failureDetails.push({
        name: sourceContainer.referenceName,
        error: error?.message || String(error),
        guid: sourceGuid[0],
      });
    } finally {
      processedCount++;
    }
  }

  return { status: overallStatus, successful, failed, skipped, failureDetails };
}

/**
 * Update an existing container in the target instance
 */
async function updateExistingContainer(
  sourceContainer: any,
  targetContainer: any,
  apiClient: ApiClient,
  targetGuid: string,
  targetModelId: number,
  logger: Logs
): Promise<mgmtApi.Container> {
  // Prepare update payload
  const updatePayload = {
    ...sourceContainer,
    contentViewID: targetContainer.contentViewID, // Use target ID for update
    contentDefinitionID: targetModelId, // Use target model ID
  };

  // Update the container
  const updatedContainer = await apiClient.containerMethods.saveContainer(updatePayload, targetGuid, true);
  return updatedContainer;
}

/**
 * Create a new container in the target instance
 */
async function createNewContainer(
  sourceContainer: any,
  apiClient: ApiClient,
  targetGuid: string,
  targetModelId: number,
  logger: Logs
): Promise<mgmtApi.Container> {
  // Prepare creation payload
  const createPayload = {
    ...sourceContainer,
    contentViewID: -1, // Use 0 for new containers
    contentDefinitionID: targetModelId, // Use target model ID
  };

  // Create the container
  try {
    const newContainer = await apiClient.containerMethods.saveContainer(createPayload, targetGuid, true);
    return newContainer;
  } catch (error: any) {
    logger.container.error(createPayload, error, targetGuid);
    throw error;
  }
}
