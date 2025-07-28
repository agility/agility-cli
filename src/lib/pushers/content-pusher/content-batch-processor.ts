import * as mgmtApi from "@agility/management-sdk";
import { pollBatchUntilComplete, extractBatchResults } from "../batch-polling";
import ansiColors from "ansi-colors";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { AssetMapper } from "lib/mappers/asset-mapper";
import { BatchFailedItem, BatchProcessingResult, BatchProgressCallback, BatchSuccessItem, ContentBatchConfig } from "./util/types";
import { findContentInOtherLocale } from "./util/find-content-in-other-locale";
import { Logs } from "core/logs";
/******
* USAGE PATTERN:
* 1. Filter content items BEFORE creating the batch processor using filterContentItemsForProcessing()
* 2. Create the batch processor with pre - filtered items
* 3. Call processBatches() with the filtered items
*
* This ensures consistent use of the new versioning logic and eliminates duplicate filtering.
*/
export class ContentBatchProcessor {
	private config: ContentBatchConfig;

	constructor(config: ContentBatchConfig) {
		this.config = {
			...config,
			batchSize: config.batchSize || 250, // Default batch size
		};
	}

	/**
	 * Process content items in batches using saveContentItems API
	 * NOTE: Content items should already be filtered by the caller using filterContentItemsForProcessing()
	 */
	async processBatches(
		contentItems: mgmtApi.ContentItem[],
		logger: Logs,
		batchType?: string
	): Promise<BatchProcessingResult> {
		const batchSize = this.config.batchSize!;
		const contentBatches = this.createContentBatches(contentItems, batchSize);

		console.log(
			`Processing ${contentItems.length || 0} content items in ${contentBatches.length} bulk ${batchType || ""} batches`
		);

		let totalSuccessCount = 0;
		let totalFailureCount = 0;
		let totalSkippedCount = 0;
		const allSuccessfulItems: BatchSuccessItem[] = [];
		const allFailedItems: BatchFailedItem[] = [];
		const startTime = Date.now();

		for (let i = 0; i < contentBatches.length; i++) {
			const contentBatch = contentBatches[i];
			const batchNumber = i + 1;
			const processedSoFar = i * batchSize;

			// Calculate ETA for bulk batches
			const elapsed = Date.now() - startTime;
			const avgTimePerBatch = elapsed / batchNumber;
			const remainingBatches = contentBatches.length - batchNumber;
			const etaMs = remainingBatches * avgTimePerBatch;
			const etaMinutes = Math.round(etaMs / 60000);

			const progress = Math.round((batchNumber / contentBatches.length) * 100);
			console.log(
				`[${progress}%] Bulk batch ${batchNumber}/${contentBatches.length}: Processing ${contentBatch.length} content items (ETA: ${etaMinutes}m)...`
			);

			// if (onProgress) {
			// 	onProgress(batchNumber, contentBatches.length, processedSoFar, contentItems.length, "processing");
			// }

			try {
				// Prepare content payloads for bulk upload

				const { payloads: contentPayloads, skippedCount: batchSkippedCount } = await this.prepareContentPayloads(
					contentBatch,
					this.config.sourceGuid,
					this.config.targetGuid
				);

				// Track skipped items from this batch
				totalSkippedCount += batchSkippedCount;

				// Execute bulk upload using saveContentItems API with returnBatchID flag
				const batchIDResult = await this.config.apiClient.contentMethods.saveContentItems(
					contentPayloads,
					this.config.targetGuid,
					this.config.locale,
					true // returnBatchID flag
				);

				// Extract batch ID from array response
				const batchID = Array.isArray(batchIDResult) ? batchIDResult[0] : batchIDResult;
				// console.log(`📦 Batch ${batchNumber} started with ID: ${batchID}`);

				// Poll batch until completion (pass payloads for error matching)
				const completedBatch = await pollBatchUntilComplete(
					this.config.apiClient,
					batchID,
					this.config.targetGuid,
					contentPayloads, // Pass original payloads for FIFO error matching
					300, // maxAttempts
					2000, // intervalMs
					batchType || "Content" // Use provided batch type or default to 'Content'
				);

				// Extract results from completed batch
				const { successfulItems, failedItems } = extractBatchResults(completedBatch, contentBatch);

				// Convert to expected format
				const batchResult = {
					successCount: successfulItems.length,
					failureCount: failedItems.length,
					skippedCount: 0, // Individual batches don't track skipped items (handled at processBatches level)
					successfulItems: successfulItems.map((item) => ({
						originalContent: item.originalItem,
						newItem: item.newItem,
						newContentId: item.newId,
					})),
					failedItems: failedItems.map((item) => ({
						originalContent: item.originalItem,
						error: item.error,
					})),
					publishableIds: successfulItems.map((item) => item.newId),
				};

				totalSuccessCount += batchResult.successCount;
				totalFailureCount += batchResult.failureCount;
				allSuccessfulItems.push(...batchResult.successfulItems);
				allFailedItems.push(...batchResult.failedItems);

				// Update ID mappings for successful uploads
				if (batchResult.successfulItems.length > 0) {
					this.updateContentIdMappings(batchResult.successfulItems);
				}

				console.log("\n");
				// Display individual item results for better visibility
				if (batchResult.successfulItems.length > 0) {
					batchResult.successfulItems.forEach((item) => {
						// const modelName = item.originalContent.properties.definitionName || "Unknown";
						logger.content.created(item.originalContent, "created", this.config.locale);
					});
				}

				if (batchResult.failedItems.length > 0) {
					console.log(`❌ Batch ${batchNumber} failed items:`);
					batchResult.failedItems.forEach((item) => {
						// const modelName = item.originalContent.properties.definitionName || "Unknown";
						logger.content.error(item.originalContent, item.error);
					});
				}

				// Call batch completion callback (for mapping saves, etc.)
				if (this.config.onBatchComplete) {
					try {
						await this.config.onBatchComplete(batchResult, batchNumber);
					} catch (callbackError: any) {
						console.warn(`⚠️ Batch completion callback failed for batch ${batchNumber}: ${callbackError.message}`);
						// Don't fail the entire batch due to callback errors
					}
				}

				// if (onProgress) {
				// 	onProgress(
				// 		batchNumber,
				// 		contentBatches.length,
				// 		processedSoFar + contentBatch.length,
				// 		contentItems.length,
				// 		"success"
				// 	);
				// }

				// Add small delay between batches to prevent API throttling
				if (i < contentBatches.length - 1) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			} catch (error: any) {
				console.error(`❌ Bulk batch ${batchNumber} failed:`, error.message);

				// Batch pusher only handles batches - mark entire batch as failed
				// Individual processing fallbacks should be handled at the sync level
				const failedBatchItems: BatchFailedItem[] = contentBatch.map((item) => ({
					originalContent: item,
					error: `Batch processing failed: ${error.message}`,
				}));

				totalFailureCount += failedBatchItems.length;
				allFailedItems.push(...failedBatchItems);

				// if (onProgress) {
				// 	onProgress(
				// 		batchNumber,
				// 		contentBatches.length,
				// 		processedSoFar + contentBatch.length,
				// 		contentItems.length,
				// 		"error"
				// 	);
				// }
			}
		}

		// console.log(`🎯 Content batch processing complete: ${totalSuccessCount} success, ${totalFailureCount} failed`);

		return {
			successCount: totalSuccessCount,
			failureCount: totalFailureCount,
			skippedCount: totalSkippedCount,
			successfulItems: allSuccessfulItems,
			failedItems: allFailedItems,
			publishableIds: allSuccessfulItems.map((item) => item.newContentId),
		};
	}

	/**
	 * Create batches of content items for bulk processing
	 */
	private createContentBatches(contentItems: mgmtApi.ContentItem[], batchSize: number): mgmtApi.ContentItem[][] {
		const batches: mgmtApi.ContentItem[][] = [];
		for (let i = 0; i < contentItems.length; i += batchSize) {
			batches.push(contentItems.slice(i, i + batchSize));
		}
		return batches;
	}

	/**
	 * Prepare content payloads for bulk upload API
	 * Uses the same payload structure as individual content pusher
	 */
	private async prepareContentPayloads(
		contentBatch: mgmtApi.ContentItem[],
		sourceGuid: string,
		targetGuid: string

	): Promise<{ payloads: any[]; skippedCount: number }> {
		const payloads: any[] = [];
		let skippedCount = 0;

		// No imports needed - using reference mapper directly
		const modelMapper = new ModelMapper(sourceGuid, targetGuid);
		const containerMapper = new ContainerMapper(sourceGuid, targetGuid);
		const assetMapper = new AssetMapper(sourceGuid, targetGuid);

		for (const contentItem of contentBatch) {


			if (contentItem.properties.definitionName.toLowerCase() === "richtextarea"
				&& contentItem.fields.textblob) {
				//if this is a RichText item, we don't need to do the extra processing - just upload it as is

				//see if it's already mapped
				const existingMapping = this.config.referenceMapper.getContentItemMappingByContentID(contentItem.contentID, 'source');

				const payload = {
					...contentItem, // Start with original content item
					contentID: existingMapping ? existingMapping.targetContentID : -1,
				};

				payloads.push(payload);
			} else {
				//map the content item to the target instance
				const modelMapping = modelMapper.getModelMappingByReferenceName(contentItem.properties.definitionName, 'source');

				try {
					// STEP 1: Find source model by content item's definitionName (matching original logic)


					let sourceModel: mgmtApi.Model | null = null;
					if (modelMapping) sourceModel = modelMapper.getMappedEntity(modelMapping, 'source');


					if (!sourceModel) {
						// Enhanced error reporting for missing content definitions

						const errorDetails = [
							`📋 Content Definition Not Found: "${contentItem.properties.definitionName}"`,
							`🔍 Content Item: ${contentItem.properties.referenceName}`,
							`💡 Common causes:`,
							`   • Model was deleted from source instance`,
							`   • Model(s) not included in sync elements`
						].join("\n   ");

						throw new Error(
							`Source model not found for content definition: ${contentItem.properties.definitionName}\n   ${errorDetails}`
						);
					}

					// STEP 2: Find target model using reference mapper (simplified)

					if (!modelMapping) {
						throw new Error(`Target model mapping not found for: ${sourceModel.referenceName} (ID: ${sourceModel.id})`);
					}

					// Create model object with target ID and fields from source
					const model = {
						id: modelMapping.targetID,
						referenceName: sourceModel.referenceName,
						fields: sourceModel.fields || []
					};

					// STEP 3: Find container using reference mapper (simplified)
					const containerMapping = containerMapper.getContainerMappingByReferenceName(contentItem.properties.referenceName, 'source');

					if (!containerMapping) {
						throw new Error(`Container mapping not found: ${contentItem.properties.referenceName}`);
					}

					const targetContainer = containerMapper.getMappedEntity(containerMapping, 'target');

					// STEP 4: Check if content already exists using reference mapper (since filtering already happened)
					const existingMapping = this.config.referenceMapper.getContentItemMappingByContentID(contentItem.contentID, 'source');
					const existingTargetContentItem = this.config.referenceMapper.getMappedEntity(existingMapping, 'target');

					let existingContentID = existingTargetContentItem ? existingTargetContentItem.contentID : -1;

					if (!existingTargetContentItem) {
						//see if this content item has been mapped in another locale
						existingContentID = await findContentInOtherLocale({
							sourceGuid,
							targetGuid,
							sourceContentID: contentItem.contentID,
							locale: this.config.locale
						});
					}

					// STEP 5: Use proper ContentFieldMapper for field mapping and validation
					const { ContentFieldMapper } = await import("../../content/content-field-mapper");
					const fieldMapper = new ContentFieldMapper();

					const mappingResult = fieldMapper.mapContentFields(contentItem.fields || {}, {
						referenceMapper: this.config.referenceMapper,
						assetMapper,
						apiClient: this.config.apiClient,
						targetGuid: this.config.targetGuid,
					});

					// Only log field mapper issues if there are actual errors (not warnings)
					if (mappingResult.validationErrors > 0) {
						console.warn(
							`⚠️ Field mapping errors for ${contentItem.properties.referenceName}: ${mappingResult.validationErrors} errors`
						);
					}

					// STEP 6: Normalize field names and add defaults ONLY for truly missing required fields
					let validatedFields = { ...mappingResult.mappedFields };

					// Create field name mapping: source field names (camelCase) to model field names (as-defined)
					const fieldNameMap = new Map<string, string>();
					const camelize = (str: string): string => {
						return str
							.replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
								return index === 0 ? word.toLowerCase() : word.toUpperCase();
							})
							.replace(/\s+/g, "");
					};

					if (model && model.fields) {
						model.fields.forEach((fieldDef) => {
							const camelCaseFieldName = camelize(fieldDef.name);
							fieldNameMap.set(camelCaseFieldName, fieldDef.name);
							fieldNameMap.set(fieldDef.name.toLowerCase(), fieldDef.name);
						});
					}

					// STEP 7: Define default SEO and Scripts (matching original logic)
					const defaultSeo = {
						metaDescription: null,
						metaKeywords: null,
						metaHTML: null,
						menuVisible: null,
						sitemapVisible: null,
					};
					const defaultScripts = { top: null, bottom: null };

					// STEP 8: Create payload using EXACT original logic
					const payload = {
						...contentItem, // Start with original content item
						contentID: existingContentID,
						fields: validatedFields, // Use validated fields with defaults for required fields
						properties: {
							...contentItem.properties,
							referenceName: targetContainer?.referenceName || contentItem.properties.referenceName, // Use TARGET container reference name if possible
							itemOrder: existingTargetContentItem
								? existingTargetContentItem.properties.itemOrder
								: contentItem.properties.itemOrder,
						},
						seo: contentItem.seo ?? defaultSeo,
						scripts: contentItem.scripts ?? defaultScripts,
					};

					payloads.push(payload);
				} catch (error: any) {
					console.error(
						ansiColors.yellow(
							`✗ Orphaned content item ${contentItem.contentID}, skipping - ${error.message || 'payload preparation failed'}.`
						)
					);

					// Track skipped item and continue with the rest of the batch
					skippedCount++;
					continue;
				}
			}
		}

		return { payloads, skippedCount };
	}

	/**
	 * Update content ID mappings in reference mapper
	 */
	private updateContentIdMappings(successfulItems: BatchSuccessItem[]): void {
		successfulItems.forEach((item) => {
			const sourceContentItem = item.originalContent;
			const targetContentItem = item.newItem as mgmtApi.BatchItem;

			const targetContentItemWithId = {
				...sourceContentItem,
				contentID: targetContentItem.itemID,
				properties: {
					versionID: targetContentItem.processedItemVersionID
				}
			} as mgmtApi.ContentItem;

			this.config.referenceMapper.addMapping(sourceContentItem, targetContentItemWithId);
		});
	}
}
