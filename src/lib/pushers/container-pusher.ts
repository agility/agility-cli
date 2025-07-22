import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
// Removed findModelInTargetInstance import - using mapper directly
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { state, getApiClient, getState } from '../../core/state';
import { sleep } from "../shared/sleep";
import { SyncDeltaFileWorker } from "lib/shared/sync-delta-file-worker";

/**
 * Simple change detection for containers
 */
interface ChangeDetection {
  entity: any;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  reason: string;
}

function changeDetection(
  sourceEntity: any,
  targetFromMapping: any,
  targetFromData: any
): ChangeDetection {
  if (!targetFromMapping && !targetFromData) {
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      reason: 'Container does not exist in target'
    };
  }
  
  const targetEntity = targetFromData || targetFromMapping;
  
  // For containers, check modification dates
  const sourceModified = new Date(sourceEntity.lastModifiedDate || 0);
  const targetModified = new Date(targetEntity.lastModifiedDate || 0);
  
  if (sourceModified > targetModified) {
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      reason: 'Source container is newer'
    };
  }
  
  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: 'Container exists and is up to date'
  };
}

/**
 * Enhanced container finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findContainerInTargetInstanceEnhanced(
    sourceContainer: mgmtApi.Container,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapperV2
): Promise<{ container: mgmtApi.Container | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: ChangeDetection }> {
    try {
        const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Container>("container", "referenceName", sourceContainer.referenceName);
    let targetContainerFromMapping: mgmtApi.Container | null = existingMapping?.target || null;

    // STEP 2: Find target instance data with enhanced matching
    const targetInstanceData = targetData.containers?.find((c: any) => {
        if (targetContainerFromMapping) {
            return (
                c.referenceName === targetContainerFromMapping.referenceName ||
                c.contentViewID === targetContainerFromMapping.contentViewID
            );
        } else {
            // Enhanced matching strategies for containers
            if (c.referenceName === sourceContainer.referenceName) {
                return true;
            }
            
            // Case-insensitive match
            if (c.referenceName && sourceContainer.referenceName &&
                c.referenceName.toLowerCase() === sourceContainer.referenceName.toLowerCase()) {
                return true;
            }
            
            // Partial match for containers with generated suffixes
            const sourceBase = sourceContainer.referenceName?.split('_')[0]?.toLowerCase();
            const targetBase = c.referenceName?.split('_')[0]?.toLowerCase();
            
            if (sourceBase && targetBase && sourceBase === targetBase && 
                sourceBase.length > 5) { // Only match if base name is meaningful
                return true;
            }
            
            return false;
        }
    });

    // STEP 3: Use change detection for conflict resolution
    const decision = changeDetection(
        sourceContainer,
        targetContainerFromMapping,
        targetInstanceData
    );

    return {
        container: decision.entity || sourceContainer, // Fallback to source container if no target found
        shouldUpdate: decision.shouldUpdate,
        shouldCreate: decision.shouldCreate,
        shouldSkip: decision.shouldSkip,
        decision: decision
    };
    } catch (error: any) {
        console.error(`[ContainerFinder] Error in enhanced finder for container ${sourceContainer.referenceName}:`, error);
        // Fallback to safe defaults - check if container exists in target first
        const existingContainer = targetData.containers?.find((c: any) => c.referenceName === sourceContainer.referenceName);
        
        if (existingContainer) {
            // Container exists, default to skip unless forced
            return {
                container: existingContainer,
                shouldUpdate: false,
                shouldCreate: false,
                shouldSkip: true
            };
        } else {
            // Container doesn't exist, create it
            return {
                container: null,
                shouldUpdate: false,
                shouldCreate: true,
                shouldSkip: false
            };
        }
    }
}

// Function overloads to handle both Container object and string referenceName
export async function findContainerInTargetInstance(
  container: mgmtApi.Container,
  apiClient: mgmtApi.ApiClient,
  guid: string,
  referenceMapper: ReferenceMapperV2,
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    referenceName: string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    containerOrReferenceName: mgmtApi.Container | string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.Container | null> {
  try {
    // Extract referenceName from either Container object or string
    const referenceName = typeof containerOrReferenceName === 'string' 
        ? containerOrReferenceName 
        : containerOrReferenceName.referenceName;

    // First check the local reference mapper for a container with the same reference name
    const mappingResult = referenceMapper.getMappingByKey("container", "referenceName", referenceName);
    const targetMapping = mappingResult?.target;

    if (targetMapping) {
      return targetMapping as mgmtApi.Container;
    }

    // If not in mapper, try to find it in the target instance by referenceName
    const containers = await apiClient.containerMethods.getContainerList(guid);
    const targetContainer = containers.find(c => c.referenceName === referenceName);

    if (targetContainer) {
      // CRITICAL: Add the mapping so we don't lose track of it
      // Only add mapping if we have the full container object
      if (typeof containerOrReferenceName !== 'string') {
        referenceMapper.addMapping("container", containerOrReferenceName, targetContainer);
      }
      return targetContainer;
    }

    return null;
  } catch (error: any) {
    return null;
  }
}

/**
 * Container pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions
 */
export async function pushContainers(
    sourceData: any,
    targetData: any,
    referenceMapper: ReferenceMapperV2,
    syncDeltaWorker: SyncDeltaFileWorker,
    // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {
    
    // Extract data from sourceData - unified parameter pattern
    const sourceContainers: any[] = sourceData.containers || [];

    if (!sourceContainers || sourceContainers.length === 0) {
        console.log('No containers found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const { targetGuid, cachedApiClient } = state;
    const apiClient = cachedApiClient;

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';
    let totalFailures = { value: 0 }; // Track total failures across entire operation


    for (const sourceContainer of sourceContainers) {
        const sourceRefName = sourceContainer.referenceName;
        let currentStatus: 'success' | 'error' = 'success';
        
        try {
            // Use enhanced finder to determine what action to take
            const findResult = await findContainerInTargetInstanceEnhanced(
                sourceContainer,
                apiClient,
                targetGuid[0],
                targetData,
                referenceMapper
            );

            
            // console.log(ansiColors.magenta(`findResult: ${JSON.stringify(findResult)}`));
            const { container, shouldUpdate, shouldCreate, shouldSkip } = findResult;

            if (shouldCreate) {

                await sleep(200) // help rate limiting
                
                // Check if target model mapping exists before attempting to create
                const targetModelId = referenceMapper.getMappedId('model', sourceContainer.contentDefinitionID);
                
                if (!targetModelId) {
                    console.log(`${ansiColors.yellow('⚠️ Container')} ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.yellow('skipped - target model mapping not found')} (Model ID: ${sourceContainer.contentDefinitionID})`);
                    skipped++;
                } else {
                    // Container doesn't exist - create new one
                    const createResult = await createNewContainerWithRetry(sourceContainer, sourceData, apiClient, targetGuid[0], referenceMapper, totalFailures);
                    
                    if (createResult.success) {
                        console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} created - ${ansiColors.green(state.sourceGuid[0])}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${createResult.container.contentViewID} (Model:${createResult.container.contentDefinitionID})`);
                        referenceMapper.addRecord('container', sourceContainer, createResult.container);
                        successful++;
                    } else {

                        
                        // console.log(createResult)
                        console.error(`✗ Failed to create container ${sourceRefName} after 5 attempts: ${createResult.error}`);
                        failed++;
                        currentStatus = 'error';
                        overallStatus = 'error';
                    }
                    
                    // No need to update totalFailures here - already updated during retries
                }
                
            } else if (shouldUpdate) {
                // Container exists but needs updating
                
                // Check if target model mapping exists before attempting to update
                const targetModelId = referenceMapper.getMappedId('model', sourceContainer.contentDefinitionID);
                
                if (!targetModelId) {
                    console.log(`${ansiColors.yellow('⚠️ Container')} ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.yellow('skipped - target model mapping not found')} (Model ID: ${sourceContainer.contentDefinitionID})`);
                    skipped++;
                } else {
                    const updateResult = await updateExistingContainerWithRetry(sourceContainer, container, sourceData, apiClient, targetGuid[0], referenceMapper, totalFailures);
                    
                    if (updateResult.success) {
                        console.log(`✓ Container updated: ${ansiColors.cyan.underline(sourceRefName)} - ${ansiColors.green('Source')}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${updateResult.container.contentViewID}`);
                        referenceMapper.addRecord('container', sourceContainer, updateResult.container);
                        successful++;
                    } else {
                        console.error(`✗ Failed to update container ${sourceRefName} after 5 attempts: ${updateResult.error}`);
                        failed++;
                        currentStatus = 'error';
                        overallStatus = 'error';
                    }
                    
                    // No need to update totalFailures here - already updated during retries
                }
            

            } else if (shouldSkip) {
                // Container exists and is up to date - skip
                console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.bold.gray('up to date, skipping')}`);
                
                // Add mapping for existing container
                if (container) {
                    referenceMapper.addRecord('container', sourceContainer, container);
                }
                skipped++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing container ${sourceRefName}:`, JSON.stringify(error));
            totalFailures.value++;
            await sleep(totalFailures.value * 2000); // Progressive backoff
            failed++;
            currentStatus = 'error';
            overallStatus = 'error';
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
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.Container> {
    // Find the target model ID based on source model mapping
    const targetModelId = referenceMapper.getMappedId('model', sourceContainer.contentDefinitionID);
    if (!targetModelId) {
        throw new Error(`Target model mapping not found for model ID: ${sourceContainer.contentDefinitionID}`);
    }

    // Prepare update payload
    const updatePayload = {
        ...sourceContainer,
        contentViewID: targetContainer.contentViewID, // Use target ID for update
        contentDefinitionID: targetModelId // Use target model ID
    };


    // Update the container
    const updatedContainer = await apiClient.containerMethods.saveContainer(updatePayload, targetGuid, true);
    return updatedContainer;
}

/**
 * Retry wrapper for updating existing containers
 */
async function updateExistingContainerWithRetry(
    sourceContainer: any,
    targetContainer: any,
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2,
    totalFailuresRef: { value: number }
): Promise<{ success: boolean; container?: mgmtApi.Container; error?: string; failureCount: number }> {
    let failureCount = 0;
    let lastError: string = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const container = await updateExistingContainer(sourceContainer, targetContainer, sourceData, apiClient, targetGuid, referenceMapper);
            return { success: true, container, failureCount };
        } catch (error: any) {
            failureCount++;
            totalFailuresRef.value++; // Increment immediately for progressive backoff
            lastError = error.message || JSON.stringify(error);
            
            if (attempt < 2) {
                const backoffTime = totalFailuresRef.value * 2000;
                console.log(`⚠️ Retry ${attempt}/2 for container ${sourceContainer.referenceName} (waiting ${backoffTime}ms)`);
                await sleep(backoffTime);
            }
        }
    }

    return { success: false, error: lastError, failureCount };
}

/**
 * Create a new container in the target instance
 */
async function createNewContainer(
    sourceContainer: any,
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.Container> {
    // Find the target model ID based on source model mapping
    const targetModelId = referenceMapper.getMappedId('model', sourceContainer.contentDefinitionID);
    if (!targetModelId) {
        throw new Error(`Target model mapping not found for model ID: ${sourceContainer.contentDefinitionID}`);
    }

    // Prepare creation payload
    const createPayload = {
        ...sourceContainer,
        contentViewID: -1, // Use 0 for new containers
        contentDefinitionID: targetModelId // Use target model ID
    };

    // Create the container
    try {
        const newContainer = await apiClient.containerMethods.saveContainer(createPayload, targetGuid, true);
        return newContainer;
    } catch (error: any) {

        console.log(ansiColors.yellow(JSON.stringify(createPayload)))
        console.log(ansiColors.red(JSON.stringify(error)))
        throw error;
    }
}

/**
 * Retry wrapper for creating new containers
 */
async function createNewContainerWithRetry(
    sourceContainer: any,
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2,
    totalFailuresRef: { value: number }
): Promise<{ success: boolean; container?: mgmtApi.Container; error?: string; failureCount: number }> {
    let failureCount = 0;
    let lastError: string = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const container = await createNewContainer(sourceContainer, sourceData, apiClient, targetGuid, referenceMapper);
            return { success: true, container, failureCount };
        } catch (error: any) {
            failureCount++;
            totalFailuresRef.value++; // Increment immediately for progressive backoff
            lastError = error.message || JSON.stringify(error);
            
            if (attempt < 2) {
                console.log(error)
                const backoffTime = totalFailuresRef.value * 2000;
                console.log(`⚠️ Retry ${attempt}/2 for container ${sourceContainer.referenceName} (waiting ${backoffTime}ms)`);
                await sleep(backoffTime);
            }
        }
    }

    return { success: false, error: lastError, failureCount };
}
