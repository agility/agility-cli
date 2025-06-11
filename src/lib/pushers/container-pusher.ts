import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../reference-mapper";
import { findContainerInTargetInstance } from "../finders/container-finder";
import ansiColors from "ansi-colors";
import { ApiClient } from '@agility/management-sdk';
import { getContainer } from '../services/agility-service';

interface ContainerPusherOptions {
    referenceMapper: ReferenceMapper;
    apiClient: ApiClient;
    targetGuid: string;
}

export class ContainerPusher {
    private options: ContainerPusherOptions;

    constructor(options: ContainerPusherOptions) {
        this.options = options;
    }

    async process(sourceContainers: any[]): Promise<void> {
        const { referenceMapper, apiClient, targetGuid } = this.options;

        for (const container of sourceContainers) {
            const sourceRefName = container.referenceName;

            // Skip if already processed
            if (referenceMapper.getMapping('container', sourceRefName)) {
                console.log(`Skipping already mapped container ${sourceRefName}`);
                continue;
            }

            console.log(`Processing container ${sourceRefName}...`);

            try {
                // Check if container exists on target
                let targetContainer = await getContainer(sourceRefName, apiClient, targetGuid);

                if (targetContainer) {
                    console.log(`  Container ${sourceRefName} already exists on target. Mapping it.`);
                    referenceMapper.addMapping('container', { referenceName: sourceRefName }, targetContainer);
                } else {
                    console.log(`  Container ${sourceRefName} does not exist. Creating it...`);
                    // Prepare payload (needs model mapping first!)
                    // For now, let's assume model is mapped for simplicity
                    const modelMapping = referenceMapper.getMapping('model', container.contentDefinitionID);
                    if (!modelMapping) {
                        throw new Error (`Cannot create container ${sourceRefName} because its model (ID: ${container.contentDefinitionID}) has not been mapped yet.`);
                    }

                    const payload = { ...container };
                    payload.contentDefinitionID = (modelMapping as any).id;
                    payload.contentViewID = -1; // Create as new

                    const newContainer = await apiClient.containerMethods.saveContainer(payload, targetGuid);
                    
                    console.log(`  Successfully created container ${newContainer.referenceName}`);
                    referenceMapper.addMapping('container', { referenceName: sourceRefName }, newContainer);
                }

            } catch (error: any) {
                console.error(`Error processing container ${sourceRefName}:`, error.message);
                throw error;
            }
        }
    }
}
