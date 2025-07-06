import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findContainerInTargetInstance, findModelInTargetInstance } from "../finders";
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
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const container of sourceContainers) {
        const sourceRefName = container.referenceName;
        let targetContainer: mgmtApi.Container | null = null;
        try {
            // SIMPLIFICATION: Remove redundant mapping check - findContainerInTargetInstance handles this
            // The finder function already checks mapping cache first, then API if not found
            targetContainer = await findContainerInTargetInstance(container, apiClient, targetGuid, referenceMapper);

            if (targetContainer) {
                // Container exists with correct model mapping - this is a skip, not success
                console.log(`✓ Container ${ansiColors.underline(sourceRefName)} ${ansiColors.bold.grey('exists')} - ${ansiColors.green(targetGuid)}: ID:${targetContainer.contentViewID} (Model:${targetContainer.contentDefinitionID})`);
                referenceMapper.addMapping('container', container, targetContainer);
                skipped++; // Existing containers are skipped, not successful
            } else {
                console.log(ansiColors.yellow(`✗ Container ${container.referenceName} not found in target instance`));
                // Container doesn't exist or was cleared due to bad mapping - create new one
                // Prepare payload (needs model mapping first!)
                
                // First find the source model from sourceData by ID
                const sourceModel = sourceData.models?.find((m: any) => m.id === container.contentDefinitionID);
                if (!sourceModel) {
                    throw new Error(`Cannot create container ${sourceRefName} because its source model (ID: ${container.contentDefinitionID}) was not found in source data.`);
                }
                
                // Now find the corresponding model in the target instance
                const model = await findModelInTargetInstance(sourceModel, apiClient, targetGuid, referenceMapper);
              
                // const modelMapping = referenceMapper.getMapping('model', container.contentDefinitionID);
                if (!model) {
                    throw new Error (`Cannot create container ${sourceRefName} because its model (ID: ${container.contentDefinitionID}) has not been mapped yet.`);
                }

                const targetModelId = model.id;
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
            console.error(`✗ Error processing container ${sourceRefName}`);
            console.log(await error);
            console.log(targetContainer);
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
