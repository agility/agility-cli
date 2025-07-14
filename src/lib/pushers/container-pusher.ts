import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findContainerInTargetInstanceEnhanced, findModelInTargetInstance } from "../finders";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { state } from '../../core/state';

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
    const { targetGuid } = state;
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

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


            console.log(ansiColors.magenta(`shouldCreate: ${shouldCreate}`));
            console.log(ansiColors.magenta(`shouldUpdate: ${shouldUpdate}`));
            console.log(ansiColors.magenta(`shouldSkip: ${shouldSkip}`));

            if (shouldCreate) {
                // Container doesn't exist - create new one
                try {
                const newContainer = await createNewContainer(sourceContainer, sourceData, apiClient, targetGuid[0], referenceMapper);
                console.log(`✓ Container created: ${ansiColors.cyan.underline(sourceRefName)} - ${ansiColors.green('Source')}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${newContainer.contentViewID} (Model:${newContainer.contentDefinitionID})`);
                referenceMapper.addRecord('container', sourceContainer, newContainer);
                successful++;
                } catch (error: any) {
                    console.error(`✗ Error creating container ${sourceRefName}:`, JSON.stringify(error));
                    failed++;
                    currentStatus = 'error';
                    overallStatus = 'error';
                }
                
            } else if (shouldUpdate) {
                // Container exists but needs updating
               
                try {
                const updatedContainer = await updateExistingContainer(sourceContainer, container, sourceData, apiClient, targetGuid[0], referenceMapper);
                console.log(`✓ Container updated: ${ansiColors.cyan.underline(sourceRefName)} - ${ansiColors.green('Source')}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid[0])}: ${updatedContainer.contentViewID}`);
                referenceMapper.addRecord('container', sourceContainer, updatedContainer);
                successful++;
                } catch (error: any) {
                    console.error(`✗ Error updating container ${sourceRefName}:`, JSON.stringify(error));
                    failed++;
                    currentStatus = 'error';
                    overallStatus = 'error';
                }
            

            } else if (shouldSkip) {
                // Container exists and is up to date - skip
                console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.bold.gray('exists, skipping')} - ${ansiColors.green(targetGuid[0])}: ID:${container?.contentViewID}`);
                
                // Add mapping for existing container
                if (container) {
                    referenceMapper.addRecord('container', sourceContainer, container);
                }
                skipped++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing container ${sourceRefName}:`, JSON.stringify(error));
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
    
    if (!targetModelMapping?.target) {
        throw new Error(`Target model mapping not found for container ${sourceContainer.referenceName}`);
    }

    const targetModelId = targetModelMapping.target.id;

    // Prepare update payload
    const updatePayload = {
        ...sourceContainer,
        contentViewID: targetContainer.contentViewID, // Use target ID for update
        contentDefinitionID: targetModelId // Use target model ID
    };

    // Update the container
    try {
    const updatedContainer = await apiClient.containerMethods.saveContainer(updatePayload, targetGuid);
    return updatedContainer;
    } catch (error: any) {
        console.error(`✗ Error updating container ${sourceContainer.referenceName}:`, JSON.stringify(error));
        throw error;
    }
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
    
    if (!targetModelMapping?.target) {
        throw new Error(`Target model mapping not found for container ${sourceContainer.referenceName}`);
    }

    const targetModelId = targetModelMapping.target.id;

    // Prepare creation payload
    const createPayload = {
        ...sourceContainer,
        contentViewID: -1, // Use 0 for new containers
        contentDefinitionID: targetModelId // Use target model ID
    };

    // Create the container
    try {
    const newContainer = await apiClient.containerMethods.saveContainer(createPayload, targetGuid);
    return newContainer;
    } catch (error: any) {
        console.error(`✗ Error creating container 2 ${sourceContainer.referenceName}:`, JSON.stringify(error));
        throw error;
    }
}
