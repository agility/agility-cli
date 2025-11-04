
// Removed finder imports - using mapper directly
import ansiColors from "ansi-colors";
// Removed ContentBatchProcessor import - individual pusher only handles individual processing
import { getLoggerForGuid, state } from 'core/state';
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { filterContentItemsForProcessing } from './util/filter-content-items-for-processing';
import { getContentItemTypes } from './util/get-content-item-types';
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContentItem, Model } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { getApiClient } from 'core/state';

/**
 * Push content to the target instance
 */
export async function pushContent(
    sourceData: ContentItem[],
    targetData: ContentItem[],
    locale: string
): Promise<any> {

    // Use batch pusher for better performance (default behavior)
    const { ContentBatchProcessor } = await import('./content-batch-processor');

    const { sourceGuid, targetGuid, overwrite, cachedApiClient: apiClient } = state;
    const logger = getLoggerForGuid(sourceGuid[0]);

    const sourceGuidStr = sourceGuid[0];
    const targetGuidStr = targetGuid[0];

    const modelMapper = new ModelMapper(sourceGuidStr, targetGuidStr);
    const containerMapper = new ContainerMapper(sourceGuidStr, targetGuidStr);
    const referenceMapper = new ContentItemMapper(sourceGuidStr, targetGuidStr, locale);
    const contentItems = sourceData || [];

    if (contentItems.length === 0) {
        return { status: "success" as const, successful: 0, failed: 0, skipped: 0, publishableIds: [] };
    }

    // Deterministically classify content items based on list references (fulllist=true)
    const { normalContentItems, linkedContentItems, skippedItems } = getContentItemTypes(contentItems, {
        containerMapper,
        modelMapper,
        referenceMapper,
        logger: logger as any
    });



    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const allPublishableIds: number[] = [];

    try {
        // Import getApiClient for both batch configurations


        // Account for pre-classification skips (missing mappings)
        if (skippedItems && skippedItems.length > 0) {
            totalSkipped += skippedItems.length;
        }

        // Process linked content items second (with dependencies)
        if (linkedContentItems.length > 0) {
            const linkedBatchConfig = {
                apiClient: getApiClient(),
                targetGuid: targetGuidStr,
                sourceGuid: sourceGuidStr,
                locale,
                referenceMapper,
                batchSize: 250,
                useContentFieldMapper: true,
                defaultAssetUrl: "",
            };

            const filteredLinkedContentItems = await filterContentItemsForProcessing({
                contentItems: linkedContentItems,
                apiClient: getApiClient(),
                targetGuid: targetGuidStr,
                locale,
                referenceMapper,
                targetData,
                logger
            });




            const linkedBatchProcessor = new ContentBatchProcessor(linkedBatchConfig);
            const linkedResult = await linkedBatchProcessor.processBatches(
                filteredLinkedContentItems.itemsToProcess.reverse(),
                logger,
                "Linked Content"
            );


            totalSuccessful += linkedResult.successCount;
            totalFailed += linkedResult.failureCount;
            totalSkipped += filteredLinkedContentItems.skippedCount;
            totalSkipped += linkedResult.skippedCount;
            allPublishableIds.push(...linkedResult.publishableIds);
        }

          // Process normal content items first (no dependencies)
          if (normalContentItems.length > 0) {
            const normalBatchConfig = {
                apiClient: getApiClient(),
                targetGuid: targetGuidStr,
                sourceGuid: sourceGuidStr,
                locale,
                referenceMapper,
                batchSize: 100, // Smaller batches for linked content due to complexity
                useContentFieldMapper: true,
                defaultAssetUrl: "",
            };

            const filteredNormalContentItems = await filterContentItemsForProcessing({
                contentItems: normalContentItems,
                apiClient: getApiClient(),
                targetGuid: targetGuidStr,
                locale,
                referenceMapper,
                targetData,
                logger
            });
            const normalBatchProcessor = new ContentBatchProcessor(normalBatchConfig);
            const normalResult = await normalBatchProcessor.processBatches(
                filteredNormalContentItems.itemsToProcess as ContentItem[],
                logger,
                "Normal Content"
            );



            totalSuccessful += normalResult.successCount;
            totalFailed += normalResult.failureCount;
            totalSkipped += filteredNormalContentItems.skippedCount;
            totalSkipped += normalResult.skippedCount;
            allPublishableIds.push(...normalResult.publishableIds);
        }

        // Convert batch result to expected PusherResult format
        return {
            status: (totalFailed > 0 ? "error" : "success") as "success" | "error",
            successful: totalSuccessful,
            failed: totalFailed,
            skipped: totalSkipped,
            publishableIds: allPublishableIds,
        };
    } catch (batchError: any) {
        console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
    }

}



