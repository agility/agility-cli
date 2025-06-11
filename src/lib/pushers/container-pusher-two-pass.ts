/**
 * Two-Pass Container Pusher
 * 
 * Sub-task 21.9.3.2: Design 2-pass pattern for Containers
 * 
 * Implements the universal 2-pass pattern for containers:
 * Pass 1: Create container shells with basic metadata and model reference
 * Pass 2: Update containers with full definitions after all models exist
 */

import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../reference-mapper";
import ansiColors from "ansi-colors";

type ProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => void;

export interface TwoPassContainerResult {
    successfulContainers: number;
    failedContainers: number;
    status: 'success' | 'error';
}

export class TwoPassContainerPusher {
    private apiClient: mgmtApi.ApiClient;
    private referenceMapper: ReferenceMapper;
    private targetGuid: string;
    private processedContainers: Set<number> = new Set();

    constructor(apiClient: mgmtApi.ApiClient, referenceMapper: ReferenceMapper, targetGuid: string) {
        this.apiClient = apiClient;
        this.referenceMapper = referenceMapper;
        this.targetGuid = targetGuid;
    }

    /**
     * Main 2-pass push method
     */
    async pushContainersTwoPass(
        containers: mgmtApi.Container[],
        onProgress?: ProgressCallback
    ): Promise<TwoPassContainerResult> {
        let successfulContainers = 0;
        let failedContainers = 0;
        const totalContainers = containers.length;

        if (!containers || containers.length === 0) {
            console.log('No containers found to push');
            return { successfulContainers, failedContainers, status: 'success' };
        }

        console.log(ansiColors.cyan(`\n🔄 Starting 2-pass container upload for ${totalContainers} containers...`));

        // Pass 1: Create container shells with basic metadata
        console.log(ansiColors.blue('\n📋 Pass 1: Creating container shells...'));
        for (const container of containers) {
            const success = await this.processContainer(container, true, 'Pass 1: Container Shell');
            if (success) successfulContainers++;
            else failedContainers++;

            if (onProgress) {
                onProgress(successfulContainers + failedContainers, totalContainers, failedContainers > 0 ? 'error' : 'success');
            }
        }

        // Pass 2: Update containers with full definitions
        console.log(ansiColors.blue('\n📋 Pass 2: Updating container definitions...'));
        for (const container of containers) {
            const success = await this.processContainer(container, false, 'Pass 2: Full Definition');
            // Note: success count already tracked in Pass 1, this is update validation
            
            if (onProgress) {
                onProgress(successfulContainers + failedContainers, totalContainers, failedContainers > 0 ? 'error' : 'success');
            }
        }

        const status = failedContainers > 0 ? 'error' : 'success';
        console.log(ansiColors.yellow(`\n📊 Container 2-pass processing completed: ${successfulContainers} successful, ${failedContainers} failed`));
        
        return { successfulContainers, failedContainers, status };
    }

    /**
     * Process individual container (Pass 1 or Pass 2)
     */
    private async processContainer(
        container: mgmtApi.Container,
        isPass1: boolean,
        passDescription: string
    ): Promise<boolean> {
        const containerKey = `${container.referenceName}`;
        let existingContainer: mgmtApi.Container | null = null;

        try {
            // Check if container already exists on target
            existingContainer = await this.findContainerByReferenceName(container.referenceName);

            if (existingContainer) {
                // Container exists - handle based on pass
                this.referenceMapper.addRecord('container', container, existingContainer);

                if (isPass1) {
                    // Pass 1: Container exists, just record mapping and skip
                    console.log(ansiColors.gray(`  ✓ ${passDescription} ${ansiColors.underline(container.referenceName)} already exists - mapping recorded`));
                    this.processedContainers.add(container.contentViewID);
                    return true;
                } else {
                    // Pass 2: Check if update needed
                    if (this.areContainersDifferent(container, existingContainer)) {
                        const updatePayload = this.prepareContainerForUpdate(container, existingContainer);
                        const updatedContainer = await this.apiClient.containerMethods.saveContainer(updatePayload, this.targetGuid);
                        
                        this.referenceMapper.addRecord('container', container, updatedContainer);
                        console.log(`✓ ${passDescription} ${ansiColors.bold.cyan('updated')} ${ansiColors.underline(container.referenceName)}`);
                        return true;
                    } else {
                        console.log(`✓ ${passDescription} ${ansiColors.underline(container.referenceName)} ${ansiColors.bold.gray('exists and is identical')} - skipping update`);
                        return true;
                    }
                }
            }
        } catch (error: any) {
            // Container not found - proceed to creation
            const errorMessage = error.message?.toLowerCase() || "";
            const isNotFoundError = 
                (error.response && error.response.status === 404) ||
                errorMessage.includes("container not found") ||
                errorMessage.includes("unable to retrieve container");

            if (!isNotFoundError) {
                console.error(`❌ Error during ${passDescription.toLowerCase()} for container ${container.referenceName}: ${error.message}`);
                return false;
            }
        }

        // CREATE PATH: Container doesn't exist
        try {
            const containerPayload = isPass1 
                ? this.prepareContainerShell(container) 
                : this.prepareFullContainer(container);

            const savedContainer = await this.apiClient.containerMethods.saveContainer(containerPayload, this.targetGuid);
            this.referenceMapper.addRecord('container', container, savedContainer);

            const actionText = isPass1 ? 'shell created' : 'fully created';
            console.log(`✓ ${passDescription} ${ansiColors.bold.cyan(actionText)} ${ansiColors.underline(container.referenceName)} (ID: ${savedContainer.contentViewID})`);
            
            if (isPass1) {
                this.processedContainers.add(container.contentViewID);
            }
            
            return true;

        } catch (error: any) {
            console.error(`❌ Error during ${passDescription.toLowerCase()} for container ${container.referenceName}:`, error.message);
            if (error.response?.data) {
                console.error(`  API Response: ${JSON.stringify(error.response.data, null, 2)}`);
            }
            return false;
        }
    }

    /**
     * Prepare container shell for Pass 1 (minimal fields)
     */
    private prepareContainerShell(container: mgmtApi.Container): mgmtApi.Container {
        // Get mapped model ID for content definition
        const mappedModel = this.referenceMapper.getMappingByKey('model', 'referenceName', this.getModelReferenceNameForContainer(container));
        const mappedModelId = (mappedModel?.target as any)?.id;

        if (!mappedModelId) {
            throw new Error(`No mapped model found for container ${container.referenceName} - ensure models are processed first`);
        }

        return {
            contentViewID: -1, // New container
            referenceName: container.referenceName,
            contentDefinitionID: mappedModelId,
            isShared: container.isShared || false
        } as mgmtApi.Container;
    }

    /**
     * Prepare full container for Pass 2 (all fields)
     */
    private prepareFullContainer(container: mgmtApi.Container): mgmtApi.Container {
        // Get mapped model ID for content definition
        const mappedModel = this.referenceMapper.getMappingByKey('model', 'referenceName', this.getModelReferenceNameForContainer(container));
        const mappedModelId = (mappedModel?.target as any)?.id;

        if (!mappedModelId) {
            throw new Error(`No mapped model found for container ${container.referenceName}`);
        }

        return {
            ...container,
            contentViewID: -1, // New container
            contentDefinitionID: mappedModelId,
            // Remove fields that shouldn't be included in creation
            lastModifiedDate: undefined,
            lastModifiedBy: undefined,
            lastModifiedAuthorID: undefined
        } as mgmtApi.Container;
    }

    /**
     * Prepare container for update (Pass 2 on existing container)
     */
    private prepareContainerForUpdate(sourceContainer: mgmtApi.Container, existingContainer: mgmtApi.Container): mgmtApi.Container {
        // Get mapped model ID for content definition
        const mappedModel = this.referenceMapper.getMappingByKey('model', 'referenceName', this.getModelReferenceNameForContainer(sourceContainer));
        const mappedModelId = (mappedModel?.target as any)?.id;

        return {
            ...sourceContainer,
            contentViewID: existingContainer.contentViewID, // Keep existing ID for update
            contentDefinitionID: mappedModelId || existingContainer.contentDefinitionID,
            // Remove fields that shouldn't be included in update
            lastModifiedDate: undefined,
            lastModifiedBy: undefined,
            lastModifiedAuthorID: undefined
        } as mgmtApi.Container;
    }

    /**
     * Find container by reference name in target instance
     */
    private async findContainerByReferenceName(referenceName: string): Promise<mgmtApi.Container | null> {
        try {
            const containers = await this.apiClient.containerMethods.getContainerList(this.targetGuid);
            return containers.find(c => c.referenceName === referenceName) || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if containers are different (simple comparison for now)
     */
    private areContainersDifferent(source: mgmtApi.Container, target: mgmtApi.Container): boolean {
        // Compare key fields that might differ
        return (
            source.isShared !== target.isShared ||
            JSON.stringify((source as any).settings || {}) !== JSON.stringify((target as any).settings || {})
        );
    }

    /**
     * Get model reference name for container (helper method)
     */
    private getModelReferenceNameForContainer(container: mgmtApi.Container): string {
        // This would need to be implemented based on how you track model references
        // For now, we'll try to get it from the reference mapper or container data
        
        // First, try to find the model reference from existing mapper records
        const allModelRecords = this.referenceMapper.getRecordsByType('model');
        const modelRecord = allModelRecords.find(record => record.source.id === container.contentDefinitionID);
        
        if (modelRecord?.source?.referenceName) {
            return modelRecord.source.referenceName;
        }

        // Fallback: this should be improved based on your specific model tracking
        throw new Error(`Cannot determine model reference name for container ${container.referenceName} with contentDefinitionID ${container.contentDefinitionID}`);
    }

    /**
     * Reset processing state for new push operation
     */
    resetState(): void {
        this.processedContainers.clear();
    }
}

/**
 * Legacy compatibility function - wraps 2-pass pusher
 */
export async function pushContainersTwoPass(
    containers: mgmtApi.Container[],
    apiOptions: mgmtApi.Options,
    targetGuid: string,
    referenceMapper: ReferenceMapper,
    onProgress?: ProgressCallback
): Promise<TwoPassContainerResult> {
    const apiClient = new mgmtApi.ApiClient(apiOptions);
    const pusher = new TwoPassContainerPusher(apiClient, referenceMapper, targetGuid);
    
    return await pusher.pushContainersTwoPass(containers, onProgress);
} 