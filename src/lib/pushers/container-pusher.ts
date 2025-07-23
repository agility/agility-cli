import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ApiClient } from "@agility/management-sdk";
import { state } from "../../core/state";
import { ContainerMapper } from "../mappers/container-mapper";
import { ModelMapper } from "../mappers/model-mapper";

/**
 * Container pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions
 */
export async function pushContainers(
  sourceData: mgmtApi.Container[],
  targetData: mgmtApi.Container[],
  // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: "success" | "error"; successful: number; failed: number; skipped: number }> {
  // Extract data from sourceData - unified parameter pattern
  const sourceContainers: mgmtApi.Container[] = sourceData || [];

  if (!sourceContainers || sourceContainers.length === 0) {
    console.log("No containers found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  // Get state values instead of prop drilling
  const { targetGuid, cachedApiClient, sourceGuid } = state;
  const apiClient = cachedApiClient;

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let processedCount = 0;
  let overallStatus: "success" | "error" = "success";
  let totalFailures = { value: 0 }; // Track total failures across entire operation

  const containerMapper = new ContainerMapper(sourceGuid[0], targetGuid[0]);
  const modelMapper = new ModelMapper(sourceGuid[0], targetGuid[0]);

  for (const sourceContainer of sourceContainers) {
    const sourceRefName = sourceContainer.referenceName;
    let currentStatus: "success" | "error" = "success";

    try {
      // STEP 1: Find existing mapping
      const existingMapping = containerMapper.getContainerMappingByReferenceName(
        sourceContainer.referenceName,
        "source",
      );
      const shouldCreate = existingMapping === null;

      if (shouldCreate) {
        // Check if target container mapping exists before attempting to create
        const { targetID: targetModelId } = modelMapper.getModelMappingByID(
          sourceContainer.contentDefinitionID,
          "source",
        );

        if (!targetModelId) {
          console.log(
            `${ansiColors.yellow("⚠️ Container")} ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.yellow("skipped - target model mapping not found")} (Model ID: ${sourceContainer.contentDefinitionID})`,
          );
          skipped++;
        } else {
          // Container doesn't exist - create new one
          const createResult = await createNewContainer(
            sourceContainer,
            apiClient,
            targetGuid[0],
            targetModelId,
          );

          if (createResult) {
            console.log(
              `✓ Container ${ansiColors.cyan.underline(sourceRefName)} created - ${ansiColors.green(state.sourceGuid[0])}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${createResult.contentViewID} (Model:${createResult.contentDefinitionID})`,
            );

            containerMapper.addMapping(sourceContainer, createResult);
            successful++;
          } else {
            // console.log(createResult)
            console.error(`✗ Failed to create container ${sourceRefName}`);
            failed++;
            currentStatus = "error";
            overallStatus = "error";
          }

        }
      } else {

        // get the target asset, check if the source and targets need updates
        const targetContainer: mgmtApi.Container =
          targetData.find(
            (targetContainer: mgmtApi.Container) =>
              targetContainer.contentViewID === sourceContainer.contentViewID ||
              sourceContainer.referenceName === targetContainer.referenceName,
          ) || null;
        const isTargetSafe = existingMapping !== null && containerMapper.hasTargetChanged(targetContainer);
        const hasSourceChanges = existingMapping !== null && containerMapper.hasSourceChanged(sourceContainer);
        const shouldUpdate = existingMapping !== null && isTargetSafe && hasSourceChanges;
        const shouldSkip = existingMapping !== null && !isTargetSafe && !hasSourceChanges;

        if (shouldUpdate) {
          // Container exists but needs updating

          // Check if target model mapping exists before attempting to update
          const { targetID: targetModelId } = modelMapper.getModelMappingByID(
            sourceContainer.contentDefinitionID,
            "source",
          );

          if (!targetModelId) {
            console.log(
              `${ansiColors.yellow("⚠️ Container")} ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.yellow("skipped - target model mapping not found")} (Model ID: ${sourceContainer.contentDefinitionID})`,
            );
            skipped++;
          } else {
            const updateResult = await updateExistingContainer(
              sourceContainer,
              targetContainer,
              apiClient,
              targetGuid[0],
              targetModelId,
            );

            if (updateResult) {
              console.log(
                `✓ Container updated: ${ansiColors.cyan.underline(sourceRefName)} - ${ansiColors.green("Source")}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${updateResult.contentViewID}`,
              );
              containerMapper.updateMapping(sourceContainer, updateResult);
              successful++;
            } else {
              console.error(`✗ Failed to update container ${sourceRefName}`);
              failed++;
              currentStatus = "error";
              overallStatus = "error";
            }

          }
        } else if (shouldSkip) {
          // Container exists and is up to date - skip
          console.log(
            `✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.bold.gray("up to date, skipping")}`,
          );

          skipped++;
        }
      }
    } catch (error: any) {
      console.error(`✗ Error processing container ${sourceRefName}:`, JSON.stringify(error));
      totalFailures.value++;
      failed++;
      currentStatus = "error";
      overallStatus = "error";
    } finally {
      processedCount++;
      // if (onProgress) {
      //     onProgress(processedCount, sourceContainers.length, currentStatus);
      // }
    }
  }

  return { status: overallStatus, successful, failed, skipped };
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
    console.log(ansiColors.yellow(JSON.stringify(createPayload)));
    console.log(ansiColors.red(JSON.stringify(error)));
    throw error;
  }
}

