import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findContainerInTargetInstance } from "../finders";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { state } from '../../core/state';


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
    const { targetGuid } = state;
    const apiClient = state.apiClient;

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const container of sourceContainers) {
        const sourceRefName = container.referenceName;

        try {
            // SIMPLIFICATION: Remove redundant mapping check - findContainerInTargetInstance handles this
            // The finder function already checks mapping cache first, then API if not found
            let targetContainer = await findContainerInTargetInstance(container, apiClient, targetGuid, referenceMapper);

            if (targetContainer) {
                // 🚨 VALIDATION: Check if container has correct model mapping
                const expectedModelMapping = referenceMapper.getMapping('model', container.contentDefinitionID);
                const expectedTargetModelId = expectedModelMapping ? (expectedModelMapping as any).id : null;
                
                if (expectedTargetModelId && targetContainer.contentDefinitionID !== expectedTargetModelId) {
                    console.warn(ansiColors.yellow(`⚠️  Container ${sourceRefName} has WRONG model mapping:`));
                    console.warn(ansiColors.yellow(`   Expected model ID: ${expectedTargetModelId}`));
                    console.warn(ansiColors.yellow(`   Actual model ID: ${targetContainer.contentDefinitionID}`));
                    console.warn(ansiColors.yellow(`   🔧 Removing bad container mapping to force recreation...`));
                    
                    // Clear the bad mapping to force recreation
                    referenceMapper.removeMapping('container', container.referenceName);
                    targetContainer = null; // Force recreation with correct model
                }
            }

            if (targetContainer) {
                // Container exists with correct model mapping - this is a skip, not success
                console.log(`✓ Container ${ansiColors.underline(sourceRefName)} ${ansiColors.bold.grey('exists')} - ${ansiColors.green(targetGuid)}: ID:${targetContainer.contentViewID} (Model:${targetContainer.contentDefinitionID})`);
                referenceMapper.addMapping('container', container, targetContainer);
                skipped++; // Existing containers are skipped, not successful
            } else {
                // Container doesn't exist or was cleared due to bad mapping - create new one
                // Prepare payload (needs model mapping first!)
                const modelMapping = referenceMapper.getMapping('model', container.contentDefinitionID);
                if (!modelMapping) {
                    throw new Error (`Cannot create container ${sourceRefName} because its model (ID: ${container.contentDefinitionID}) has not been mapped yet.`);
                }

                const targetModelId = (modelMapping as any).id;
                // console.log(`🔧 Creating container ${sourceRefName} with model mapping: ${container.contentDefinitionID} → ${targetModelId}`);

                const payload = { ...container };

                // Reset the ids with the correct model so we can create a new container
                payload.contentDefinitionID = targetModelId;
                payload.contentViewID = -1; // Create as new

                // TODO: create the container group in the API here so we don't have to set the contentViewCategoryID to -1
                payload.contentViewCategoryID = -1; // Don't bother with categories for now

                // 🚨 CRITICAL FIX: Add forceReferenceName parameter to preserve reference names
                const newContainer = await apiClient.containerMethods.saveContainer(payload, targetGuid, true);
                
                console.log(`✓ Container created: ${sourceRefName} - ${ansiColors.green('Source')}: ${container.contentViewID} ${ansiColors.green(targetGuid)}: ${newContainer.contentViewID} (Model:${newContainer.contentDefinitionID})`);
                referenceMapper.addMapping('container', container, newContainer);
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

    console.log(ansiColors.yellow(`Processed ${successful}/${sourceContainers.length} containers (${failed} failed, ${skipped} skipped)`));
    return { status: overallStatus, successful, failed, skipped };
}
