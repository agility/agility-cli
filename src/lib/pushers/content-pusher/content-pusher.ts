
// Removed finder imports - using mapper directly
import ansiColors from "ansi-colors";
// Removed ContentBatchProcessor import - individual pusher only handles individual processing
import { state } from '../../../core/state';
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { filterContentItemsForProcessing } from './util/filter-content-items-for-processing';
import { areContentDependenciesResolved } from "./util/are-content-dependencies-resolved";


/**
 * Push content to the target instance
 */
export async function pushContent(
    sourceData: any,
    targetData: any,
): Promise<any> {



    // Use batch pusher for better performance (default behavior)
    const { ContentBatchProcessor } = await import('./content-batch-processor');


    const { sourceGuid, targetGuid, locale } = state;

    const referenceMapper = new ContentItemMapper(sourceGuid[0], targetGuid[0], locale[0]);
    const contentItems = sourceData.content || [];

    if (contentItems.length === 0) {
        return { status: "success" as const, successful: 0, failed: 0, skipped: 0, publishableIds: [] };
    }

    // Separate content items into normal and linked batches
    const normalContentItems: any[] = [];
    const linkedContentItems: any[] = [];

    for (const contentItem of contentItems) {
        // Find source model for this content item
        let sourceModel = sourceData.models?.find(
            (m: any) => m.referenceName === contentItem.properties.definitionName
        );
        if (!sourceModel && sourceData.models) {
            sourceModel = sourceData.models.find(
                (m: any) => m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
            );
        }

        if (!sourceModel) {
            // No model found - treat as linked content for dependency resolution
            linkedContentItems.push(contentItem);
            continue;
        }

        // Check if content has unresolved dependencies
        if (areContentDependenciesResolved(contentItem, referenceMapper, [sourceModel])) {
            normalContentItems.push(contentItem);
        } else {
            linkedContentItems.push(contentItem);
        }
    }

    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const allPublishableIds: number[] = [];

    try {
        // Import getApiClient for both batch configurations
        const { getApiClient } = await import('../../../core/state');

        // Process normal content items first (no dependencies)
        if (normalContentItems.length > 0) {
            const normalBatchConfig = {
                apiClient: getApiClient(),
                targetGuid: state.targetGuid[0],
                sourceGuid: state.sourceGuid[0],
                locale: state.locale[0],
                referenceMapper,
                batchSize: 250,
                useContentFieldMapper: true,
                models: sourceData.models,
                defaultAssetUrl: "",
            };

            const filteredNormalContentItems = await filterContentItemsForProcessing(
                normalContentItems,
                getApiClient(),
                state.targetGuid[0],
                state.locale[0],
                referenceMapper,
                targetData,
                "normal"
            );
            const normalBatchProcessor = new ContentBatchProcessor(normalBatchConfig);
            const normalResult = await normalBatchProcessor.processBatches(
                filteredNormalContentItems.itemsToCreate as any,
                undefined,
                "Normal Content"
            );

            totalSuccessful += normalResult.successCount;
            totalFailed += normalResult.failureCount;
            totalSkipped += filteredNormalContentItems.skippedCount;
            totalSkipped += normalResult.skippedCount;
            allPublishableIds.push(...normalResult.publishableIds);
        }

        // Process linked content items second (with dependencies)
        if (linkedContentItems.length > 0) {
            const linkedBatchConfig = {
                apiClient: getApiClient(),
                targetGuid: state.targetGuid[0],
                sourceGuid: state.sourceGuid[0],
                locale: state.locale[0],
                referenceMapper,
                batchSize: 100, // Smaller batches for linked content due to complexity
                useContentFieldMapper: true,
                models: sourceData.models,
                defaultAssetUrl: "",
            };

            const filteredLinkedContentItems = await filterContentItemsForProcessing(
                linkedContentItems,
                getApiClient(),
                state.targetGuid[0],
                state.locale[0],
                referenceMapper,
                targetData,
                "linked"
            );
            const linkedBatchProcessor = new ContentBatchProcessor(linkedBatchConfig);
            const linkedResult = await linkedBatchProcessor.processBatches(
                filteredLinkedContentItems.itemsToCreate,
                undefined,
                "Linked Content"
            );

            totalSuccessful += linkedResult.successCount;
            totalFailed += linkedResult.failureCount;
            totalSkipped += filteredLinkedContentItems.skippedCount;
            totalSkipped += linkedResult.skippedCount;
            allPublishableIds.push(...linkedResult.publishableIds);
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



