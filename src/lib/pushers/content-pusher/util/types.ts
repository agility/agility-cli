import * as mgmtApi from "@agility/management-sdk";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";

/**
 * Configuration for content batch processing
 */
export interface ContentBatchConfig {
	apiClient: mgmtApi.ApiClient;
	targetGuid: string;
	sourceGuid: string;
	locale: string;
	referenceMapper: ContentItemMapper;
	batchSize?: number; // Default: 100, Max: 250
	useContentFieldMapper?: boolean; // Whether to use enhanced field mapping
	defaultAssetUrl?: string; // Default asset URL for content mapping
	targetData?: any; // Target instance data for checking existing content
	onBatchComplete?: (batchResult: BatchProcessingResult, batchNumber: number) => Promise<void>; // Callback after each batch completes
}

/**
 * Result of processing a single batch
 */
export interface BatchProcessingResult {
	successCount: number;
	failureCount: number;
	skippedCount: number; // Number of items skipped due to existing content
	successfulItems: BatchSuccessItem[];
	failedItems: BatchFailedItem[];
	publishableIds: number[]; // Target content IDs for auto-publishing
}

/**
 * Successful item with original content and new ID
 */
export interface BatchSuccessItem {
	originalContent: mgmtApi.ContentItem;
	newItem: mgmtApi.BatchItem;
	newContentId: number;
}

/**
 * Failed item with original content and error details
 */
export interface BatchFailedItem {
	originalContent: mgmtApi.ContentItem;
	error: string;
}

/**
 * Progress callback for batch processing
 */
export type BatchProgressCallback = (
	batchNumber: number,
	totalBatches: number,
	processed: number,
	total: number,
	status: "processing" | "success" | "error"
) => void;
