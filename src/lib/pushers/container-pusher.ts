import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findContainerInTargetInstanceEnhanced, findModelInTargetInstance } from "../finders";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { state, getApiClient } from '../../core/state';
import { sleep } from "../shared/sleep";
import { prepareModelPayload } from "lib/models";
/**
 * Container pusher with enhanced version-based comparison
 * Uses lastModifiedDate for intelligent update decisions
 */
export async function pushContainers(
    sourceData: any,
    targetData: any,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
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
                const targetModelMapping = referenceMapper.getMapping<any>('model', 'id', sourceContainer.contentDefinitionID);
                
                if (!targetModelMapping?.target) {
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
                const targetModelMapping = referenceMapper.getMapping<any>('model', 'id', sourceContainer.contentDefinitionID);
                
                if (!targetModelMapping?.target) {
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
            if (onProgress) {
                onProgress(processedCount, sourceContainers.length, currentStatus);
            }
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
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container> {
    // Find the target model ID based on source model mapping
    const targetModelMapping = referenceMapper.getMapping<mgmtApi.Model>('model', 'id', sourceContainer.contentDefinitionID);
    const targetModelId = targetModelMapping!.target!.id; // We know it exists from upfront check

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
    referenceMapper: ReferenceMapper,
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
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container> {
    // Find the target model ID based on source model mapping
    const targetModelMapping = referenceMapper.getMapping<mgmtApi.Model>('model', 'id', sourceContainer.contentDefinitionID);
    const targetModelId = targetModelMapping!.target!.id; // We know it exists from upfront check

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
    referenceMapper: ReferenceMapper,
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
