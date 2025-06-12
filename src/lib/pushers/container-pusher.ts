import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../reference-mapper";
import { findContainerInTargetInstance } from "../finders/container-finder";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';


export async function pushContainers(
    sourceContainers: any[],
    targetGuid: string,
    apiClient: ApiClient,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successfulContainers: number, failedContainers: number }> {

    if (!sourceContainers || sourceContainers.length === 0) {
        console.log('No containers found to process.');
        return { status: 'success', successfulContainers: 0, failedContainers: 0 };
    }

    let successfulContainers = 0;
    let failedContainers = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const container of sourceContainers) {
        const sourceRefName = container.referenceName;

        try {
            // Skip if already processed
            if (referenceMapper.getMapping('container', sourceRefName)) {
                console.log(`Skipping already mapped container ${sourceRefName}`);
                successfulContainers++;
                processedCount++;
                if (onProgress) {
                    onProgress(processedCount, sourceContainers.length, overallStatus);
                }
                continue;
            }

            console.log(`Processing container ${sourceRefName}...`);

            // Check if container exists on target using proper finder (checks mappings then SDK)
            let targetContainer = await findContainerInTargetInstance(container, apiClient, targetGuid, referenceMapper);

            if (targetContainer) {
                console.log(`  Container ${sourceRefName} already exists on target. Mapping it.`);
                referenceMapper.addMapping('container', { referenceName: sourceRefName }, targetContainer);
                successfulContainers++;
            } else {
                console.log(`  Container ${sourceRefName} does not exist. Creating it...`);
                // Prepare payload (needs model mapping first!)
                // For now, let's assume model is mapped for simplicity
                const modelMapping = referenceMapper.getMapping('model', container.contentDefinitionID);
                if (!modelMapping) {
                    throw new Error (`Cannot create container ${sourceRefName} because its model (ID: ${container.contentDefinitionID}) has not been mapped yet.`);
                }

                const payload = { ...container };

                // Reset the ids with the correct model so we can create a new container
                payload.contentDefinitionID = (modelMapping as any).id;
                payload.contentViewID = -1; // Create as new

                // TODO: create the container group in the API here so we don't have to set the contentViewCategoryID to -1
                payload.contentViewCategoryID = -1; // Don't bother with categories for now

                const newContainer = await apiClient.containerMethods.saveContainer(payload, targetGuid);
                
                console.log(`  Successfully created container ${newContainer.referenceName}`);
                referenceMapper.addMapping('container', { referenceName: sourceRefName }, newContainer);
                successfulContainers++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing container ${sourceRefName}:`, error.message);
            failedContainers++;
            overallStatus = 'error';
        }

        processedCount++;
        if (onProgress) {
            onProgress(processedCount, sourceContainers.length, overallStatus);
        }
    }

    console.log(ansiColors.yellow(`Processed ${successfulContainers}/${sourceContainers.length} containers (${failedContainers} failed)`));
    return { status: overallStatus, successfulContainers, failedContainers };
}
