import { ApiClient } from '@agility/management-sdk';
import { ReferenceMapper } from '../reference-mapper';
import { getContainer, getModel } from '../services/agility-service';

interface SinglePassContentPusherOptions {
  referenceMapper: ReferenceMapper;
  apiClient: ApiClient;
  targetGuid: string;
  locale: string;
}

export class SinglePassContentPusher {
  private options: SinglePassContentPusherOptions;

  constructor(options: SinglePassContentPusherOptions) {
    this.options = options;
  }

  async process(sourceItems: any[]): Promise<void> {
    const { referenceMapper, apiClient, targetGuid, locale } = this.options;

    for (const item of sourceItems) {
      const sourceId = item.contentID;

      // Skip if already processed
      if (referenceMapper.getMapping('content', sourceId)) {
        console.log(`Skipping already mapped content item ${sourceId}`);
        continue;
      }

      console.log(`Processing content item ${sourceId}...`);

      try {
        // Step 1: Ensure the Container and its Model are mapped
        const containerRefName = item.properties.referenceName;
        
        // First, try to get the container from our map
        let targetContainer = referenceMapper.getMapping('container', containerRefName);

        if (!targetContainer) {
          console.log(`  Container "${containerRefName}" not in map. Querying target instance...`);
          const existingContainer = await getContainer(containerRefName, apiClient, targetGuid);
          if (existingContainer) {
            targetContainer = { id: existingContainer.contentViewID, definitionId: existingContainer.contentDefinitionID };
            referenceMapper.addMapping('container', { referenceName: containerRefName }, targetContainer);
            console.log(`    Found container on target. ID: ${(targetContainer as any).id}`);
          } else {
            throw new Error(`Container "${containerRefName}" not found on target instance. It must be created first.`);
          }
        }

        // We also need the model ID for the container, which should be on the container object
        const targetModelId = (targetContainer as any).definitionId;
        if (!targetModelId) {
          throw new Error(`Target container for "${containerRefName}" is missing a model definition ID.`);
        }
        
        // Step 2: Prepare the payload for the target instance
        const contentItemPayload = {
          ...item, // Spread the source item to get all required properties
          contentID: -1, // Create as new
          contentDefinitionName: item.properties.definitionName, // Ensure these are set
          contentViewName: containerRefName,
        };
        
        // Step 3: Save the content item
        console.log(`  Saving content item to container ${(targetContainer as any).id} with model ${targetModelId}...`);
        const newContentId = await apiClient.contentMethods.saveContentItem(
          contentItemPayload,
          targetGuid,
          locale,
        );

        // Step 4: Map the new ID
        referenceMapper.addMapping('content', { id: sourceId }, { id: newContentId[0] });
        console.log(`  Successfully created content item. Source ID ${sourceId} -> Target ID ${newContentId[0]}`);

      } catch (error: any) {
        console.error(`Error processing content item ${sourceId}:`, error.message);
        if(error.response?.data) {
          console.error('API Error:', JSON.stringify(error.response.data, null, 2));
        }
        // Decide if we should re-throw or continue
        throw error;
      }
    }
  }
} 