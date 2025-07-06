import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findContainerInTargetInstance, findModelInTargetInstance } from "../finders";
import { ContentHashComparer } from "../shared/content-hash-comparer";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { state } from '../../core/state';

/**
 * Container pusher with --overwrite flag compliance and content comparison
 * 
 * Behavior:
 * - overwrite=false: Skip existing containers (performance optimized)
 * - overwrite=true: Compare content hashes and update if different
 */
export async function pushContainers(
    sourceData: any,
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
    const { targetGuid, overwrite } = state;
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

   
    for (const sourceContainer of sourceContainers) {
        const sourceRefName = sourceContainer.referenceName;
        let targetContainer: mgmtApi.Container | null = null;
        
        try {
            // Find container in target instance (checks mapping cache first, then API)
            targetContainer = await findContainerInTargetInstance(sourceContainer, apiClient, targetGuid, referenceMapper);

            if (targetContainer) {
                // Container exists - determine action based on overwrite flag
                if (!overwrite) {
                    // overwrite=false: Skip existing containers (current behavior)
                    console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.bold.grey('exists, skipping')} - ${ansiColors.green(targetGuid)}: ID:${targetContainer.contentViewID}`);
                    referenceMapper.addMapping('container', sourceContainer, targetContainer);
                    skipped++;
                } else {
                    // overwrite=true: Compare content and update if different
                    const shouldUpdate = await compareContainerContent(sourceContainer, targetContainer, sourceData);
                    
                    if (shouldUpdate.needsUpdate) {
                        // Content differs - update the container
                        // console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.yellow('checking for updates...')} - ${shouldUpdate.reason}`);
                        
                        const updatedContainer = await updateExistingContainer(sourceContainer, targetContainer, sourceData, apiClient, targetGuid, referenceMapper);
                        
                        console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.green('updated')} - ${ansiColors.green(targetGuid)}: ID:${updatedContainer.contentViewID}`);
                        referenceMapper.addMapping('container', sourceContainer, updatedContainer);
                        successful++;
                    } else {
                        // Content identical - skip update
                        console.log(`✓ Container ${ansiColors.cyan.underline(sourceRefName)} ${ansiColors.bold.grey('unchanged, skipping')} - ${ansiColors.green(targetGuid)}: ID:${targetContainer.contentViewID} (${shouldUpdate.sourceHash})`);
                        referenceMapper.addMapping('container', sourceContainer, targetContainer);
                        skipped++;
                    }
                }
            } else {
                // Container doesn't exist - create new one
                const newContainer = await createNewContainer(sourceContainer, sourceData, apiClient, targetGuid, referenceMapper);
                
                console.log(`✓ Container created: ${ansiColors.cyan.underline(sourceRefName)} - ${ansiColors.green('Source')}: ${sourceContainer.contentViewID} ${ansiColors.green(targetGuid)}: ${newContainer.contentViewID} (Model:${newContainer.contentDefinitionID})`);
                referenceMapper.addMapping('container', sourceContainer, newContainer);
                successful++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing container ${sourceRefName}:`, error.message);
            failed++;
            overallStatus = 'error';
        }

        processedCount++;
        if (onProgress) {
            onProgress(processedCount, sourceContainers.length, overallStatus);
        }
    }

    return { status: overallStatus, successful, failed, skipped };
}

/**
 * Compare container content to determine if update is needed
 */
async function compareContainerContent(
    sourceContainer: any, 
    targetContainer: any,
    sourceData: any
): Promise<{
    needsUpdate: boolean;
    reason: string;
    sourceHash: string;
    targetHash: string;
}> {
    try {
        // Create normalized container objects for comparison (exclude instance-specific fields)
        const sourceNormalized = normalizeContainerForComparison(sourceContainer, sourceData);
        const targetNormalized = normalizeContainerForComparison(targetContainer, sourceData);
        
        // Calculate content hashes
        const sourceHash = ContentHashComparer.calculateHash(sourceNormalized);
        const targetHash = ContentHashComparer.calculateHash(targetNormalized);
        
        const needsUpdate = sourceHash !== targetHash;
        const reason = needsUpdate ? 'content differs' : 'content identical';
        
        return {
            needsUpdate,
            reason,
            sourceHash: sourceHash.substring(0, 6),
            targetHash: targetHash.substring(0, 6)
        };
    } catch (error: any) {
        // If comparison fails, err on the side of updating
        return {
            needsUpdate: true,
            reason: `comparison error: ${error.message}`,
            sourceHash: 'error',
            targetHash: 'error'
        };
    }
}

/**
 * Normalize container for content comparison
 * Removes instance-specific fields that shouldn't affect comparison
 */
function normalizeContainerForComparison(container: any, sourceData: any): any {
    const normalized = { ...container };
    
    // Remove instance-specific fields that vary between source/target
    delete normalized.contentViewID; // Target will have different ID
    delete normalized.contentViewCategoryID; // May differ between instances
    delete normalized.websiteID; // Instance-specific
    delete normalized.id; // Alias for contentViewID
    
    // Keep fields that matter for content comparison:
    // - referenceName (business identifier)
    // - displayName 
    // - description
    // - contentDefinitionID (will be mapped to target model)
    // - settings/configuration
    
    return normalized;
}

/**
 * Update existing container with source content
 */
async function updateExistingContainer(
    sourceContainer: any,
    targetContainer: any,
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container> {
    
    // Find the source model and map it to target
    const sourceModel = sourceData.models?.find((m: any) => m.id === sourceContainer.contentDefinitionID);
    if (!sourceModel) {
        throw new Error(`Cannot update container ${sourceContainer.referenceName} because its source model (ID: ${sourceContainer.contentDefinitionID}) was not found in source data.`);
    }
    
    const targetModel = await findModelInTargetInstance(sourceModel, apiClient, targetGuid, referenceMapper);
    if (!targetModel) {
        throw new Error(`Cannot update container ${sourceContainer.referenceName} because its model (ID: ${sourceContainer.contentDefinitionID}) has not been mapped yet.`);
    }

    // Prepare update payload (preserve target container ID and instance-specific fields)
    const payload = { ...sourceContainer };
    payload.contentViewID = targetContainer.contentViewID; // Keep existing ID for update
    payload.contentDefinitionID = targetModel.id; // Use mapped model ID
    payload.contentViewCategoryID = targetContainer.contentViewCategoryID || -1; // Preserve category or default
    
    // Perform update with forceReferenceName to preserve reference names
    const updatedContainer = await apiClient.containerMethods.saveContainer(payload, targetGuid, true);
    return updatedContainer;
}

/**
 * Create new container from source
 */
async function createNewContainer(
    sourceContainer: any,
    sourceData: any,
    apiClient: ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container> {
    
    // Find the source model and map it to target
    const sourceModel = sourceData.models?.find((m: any) => m.id === sourceContainer.contentDefinitionID);
    if (!sourceModel) {
        throw new Error(`Cannot create container ${sourceContainer.referenceName} because its source model (ID: ${sourceContainer.contentDefinitionID}) was not found in source data.`);
    }
    
    const targetModel = await findModelInTargetInstance(sourceModel, apiClient, targetGuid, referenceMapper);
    if (!targetModel) {
        throw new Error(`Cannot create container ${sourceContainer.referenceName} because its model (ID: ${sourceContainer.contentDefinitionID}) has not been mapped yet.`);
    }

    // Prepare create payload
    const payload = { ...sourceContainer };
    payload.contentDefinitionID = targetModel.id; // Use mapped model ID
    payload.contentViewID = -1; // Create as new
    payload.contentViewCategoryID = -1; // Don't bother with categories for now

    // Create new container with forceReferenceName to preserve reference names
    const newContainer = await apiClient.containerMethods.saveContainer(payload, targetGuid, true);
    return newContainer;
}
