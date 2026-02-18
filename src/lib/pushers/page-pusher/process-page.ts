import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { PageMapper } from "../../mappers/page-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";// Internal helper function to process a single page
import { translateZoneNames } from "./translate-zone-names";
import { findPageInOtherLocale, OtherLocaleMapping } from "./find-page-in-other-locale";
import { Logs } from "core/logs";
import { state, getFailedContent, contentExistsInSourceData, contentExistsInOtherLocale } from "core/state";

interface Props {
	channel: string,
	page: mgmtApi.PageItem,
	sourceGuid: string,
	targetGuid: string,
	locale: string,
	apiClient: mgmtApi.ApiClient,
	overwrite: boolean,
	insertBeforePageId: number | null,
	pageMapper: PageMapper,
	parentPageID: number,
	logger: Logs
}

export type PageProcessResult = { status: "success" | "skip" | "failure"; error?: string; contentID?: number };

export async function processPage({
	channel,
	page,
	sourceGuid,
	targetGuid,
	locale,
	apiClient,
	overwrite = false,
	insertBeforePageId = null,
	pageMapper,
	parentPageID,
	logger
}: Props): Promise<PageProcessResult> {
	// Returns object with status and optional error message

	let existingPage: mgmtApi.PageItem | null = null;
	let channelID = -1;

	const templateMapper = new TemplateMapper(sourceGuid, targetGuid);

	try {
		let targetTemplate: mgmtApi.PageModel | null = null;
		// Only try to find template mapping for non-folder pages
		if (page.pageType !== "folder" && page.templateName) {
			// Find the template mapping
			let templateRef = templateMapper.getTemplateMappingByPageTemplateName(page.templateName, 'source');
			if (!templateRef) {
				logger.page.error(page, `Missing page template ${page.templateName} in source data, skipping`, locale, channel, targetGuid);
				return { status: "skip" };
			}
			targetTemplate = templateMapper.getMappedEntity(templateRef, 'target') as mgmtApi.PageModel;
		}

		//get the existing page from the target instance
		const pageMapping = pageMapper.getPageMapping(page, 'source');
		existingPage = pageMapper.getMappedEntity(pageMapping, 'target');
		let mappingToOtherLocale: OtherLocaleMapping | null = null;

		if (!existingPage) {
			//check the other locales to see if this page has been mapped in another locale
			mappingToOtherLocale = await findPageInOtherLocale({
				sourcePageID: page.pageID,
				locale,
				sourceGuid,
				targetGuid
			});


		}

		// Get channel ID from target instance sitemap (not from existing page which may be invalid)
		const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
		//TODO: this is NOT using the channel reference name properly since we don't get that from the mgmt api
		//TODO: we need to add the channel reference name to the mgmt API for a proper lookup here..
		const websiteChannel = sitemap?.find((channelObj) => channelObj.name.toLowerCase() === channel.toLowerCase());
		if (websiteChannel) {
			channelID = websiteChannel.digitalChannelID;
		} else {
			channelID = sitemap?.[0]?.digitalChannelID || 1; // Fallback to first channel or default
		}

		const hasTargetChanged = pageMapper.hasTargetChanged(existingPage);
		const hasSourceChanged = pageMapper.hasSourceChanged(page);

		const isConflict = hasTargetChanged && hasSourceChanged;
		const updateRequired = (hasSourceChanged && !isConflict) || overwrite;
		const createRequired = !existingPage;

		const pageTypeDisplay =
			{
				static: "Page",
				link: "Link",
				folder: "Folder",
			}[page.pageType] || page.pageType;

		if (isConflict) {
			// CONFLICT: Target has changes, source has changes, and we're not in overwrite mode
			// Skip processing - do NOT push to target or add to publishable IDs

			const sourceUrl = `https://app.agilitycms.com/instance/${sourceGuid}/${locale}/pages/${page.pageID}`;
			const targetUrl = `https://app.agilitycms.com/instance/${targetGuid}/${locale}/pages/${existingPage.pageID}`;

			console.warn(
				`⚠️  Conflict detected ${pageTypeDisplay} ${ansiColors.underline(page.name)} ${ansiColors.bold.grey("changes detected in both source and target")}. Please resolve manually.`
			);
			console.warn(`   - Source: ${sourceUrl}`);
			console.warn(`   - Target: ${targetUrl}`);

			return { status: "skip" }; // Prevent conflicting pages from being processed and auto-published
		} else if (createRequired) {
			//CREATE NEW PAGE - nothing to do here yet...
		} else if (!updateRequired) {
			// Add to reference mapper for future lookups
			if (existingPage) {
				pageMapper.addMapping(page, existingPage);
			}

			logger.page.skipped(page, "up to date, skipping", locale, channel, targetGuid);
			return { status: "skip" }; // Skip processing - page already exists
		}

		// Map Content IDs in Zones
		// Handle folder pages which may not have zones
		let sourceZones = page.zones ? { ...page.zones } : {}; // Clone zones or use empty object

		// CRITICAL: Translate zone names to match template expectations BEFORE content mapping
		let mappedZones = translateZoneNames(sourceZones, targetTemplate);

		// Content mapping validation - collect all content IDs that need mapping
		const contentIdsToValidate: number[] = [];
		for (const [zoneName, zoneModules] of Object.entries(mappedZones)) {
			if (Array.isArray(zoneModules)) {
				for (const module of zoneModules) {
					if (module.item && typeof module.item === "object") {
						const sourceContentId = module.item.contentid || module.item.contentId;
						if (sourceContentId && sourceContentId > 0) {
							contentIdsToValidate.push(sourceContentId);
						}
					}
				}
			}
		}

		// Content mapping validation (silent unless errors)

		const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);
		// Track first missing content mapping for error summary
		let firstMissingContentError: string | null = null;
		let firstMissingContentID: number | null = null;

		for (const [zoneName, zoneModules] of Object.entries(mappedZones)) {
			const newZoneContent = [];
			if (Array.isArray(zoneModules)) {
				for (const module of zoneModules) {
					// Create copy of module to avoid modifying original
					const newModule = { ...module };

					// Check if module has content item reference
					if (module.item && typeof module.item === "object") {
						// CRITICAL FIX: Check both contentid (lowercase) and contentId (camelCase)
						// The page data contains "contentid" (lowercase) but code was checking "contentId"
						const sourceContentId = module.item.contentid || module.item.contentId;

						if (sourceContentId && sourceContentId > 0) {
							const contentMapping = contentMapper.getContentItemMappingByContentID(sourceContentId, 'source');
							const targetContentID = contentMapping?.targetContentID;
							if (targetContentID) {
								// CRITICAL FIX: Map to target content ID and remove duplicate fields
								const targetContentId = targetContentID;
								newModule.item = {
									...module.item,
									contentid: targetContentId, // Use target content ID only
									fulllist: module.item.fulllist,
								};
								// Remove contentId field to avoid confusion
								delete newModule.item.contentId;
								newZoneContent.push(newModule);
							} else {
								// Content mapping failed - check why (in priority order)
								const failedContent = getFailedContent(sourceContentId);
								const isPageUnpublished = page.properties?.state !== 2;
								const existsInSource = contentExistsInSourceData(sourceGuid, locale, sourceContentId);
								const otherLocale = !existsInSource ? contentExistsInOtherLocale(sourceGuid, locale, sourceContentId) : null;
								let mappingError: string;
								
								if (failedContent) {
									// Content failed earlier - show the upstream error
									mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content '${failedContent.referenceName}' failed earlier: ${failedContent.error}`;
								} else if (isPageUnpublished) {
									// Page is unpublished - explains why content isn't in source (it wasn't pulled)
									mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - page is unpublished and referenced content may not have been pulled`;
								} else if (otherLocale) {
									// Content exists in another locale but not this one - not initialized for this locale
									mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content not initialized in ${locale} (exists in ${otherLocale})`;
								} else if (!existsInSource) {
									// Published page but content file doesn't exist anywhere - needs re-pull
									mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content item not found in source data (may need to re-pull)`;
								} else {
									// Content exists but wasn't synced - may be model issue
									mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content has never been synced or model may have changed`;
								}
								
								// Don't log individual errors inline - they'll appear in the final summary
								// Capture first error and contentID for summary
								if (!firstMissingContentError) {
									firstMissingContentError = mappingError;
									firstMissingContentID = sourceContentId;
								}
							}
						} else {
							// Module without content reference - keep it
							newZoneContent.push(newModule);
						}
					} else {
						// Module without content reference - keep it
						newZoneContent.push(newModule);
					}
				}
			}
			mappedZones[zoneName] = newZoneContent;
		}

		// Content mapping validation - check which mappings were successful
		if (contentIdsToValidate.length > 0) {
			const mappingResults: { [contentId: number]: { found: boolean; targetId?: number; error?: string } } = {};
			let foundMappings = 0;
			let missingMappings = 0;

			contentIdsToValidate.forEach((sourceContentId) => {
				const contentMapping = contentMapper.getContentItemMappingByContentID(sourceContentId, 'source');
				const targetContentID = contentMapping?.targetContentID;
				if (targetContentID) {
					mappingResults[sourceContentId] = {
						found: true,
						targetId: targetContentID,
					};
					foundMappings++;
				} else {
					mappingResults[sourceContentId] = {
						found: false,
						error: targetContentID ? "Invalid target ID" : "No mapping found",
					};
					missingMappings++;
				}
			});

			if (missingMappings > 0) {
				console.error(
					ansiColors.bgRed(
						`✗ Page "${page.name}" failed - ${missingMappings}/${contentIdsToValidate.length} missing content mappings`
					)
				);
				return { 
					status: "failure", 
					error: firstMissingContentError || `${missingMappings} missing content mappings`,
					contentID: firstMissingContentID || undefined
				};
			}
		}

		// Check if page has any content left after filtering
		const totalModules = Object.values(mappedZones).reduce((sum: number, zone) => {
			return sum + (Array.isArray(zone) ? zone.length : 0);
		}, 0);

		// Helper function to check if a page legitimately can have no modules
		const isLegitimateEmptyPage = (page: mgmtApi.PageItem): boolean => {
			// Folder pages don't have content modules
			if (page.pageType === "folder") return true;

			// Link pages don't have content modules - they redirect to other URLs/pages/files
			if (page.pageType === "link") return true;

			// Dynamic pages don't have modules in zones - their content comes from dynamic containers
			// Check for dynamic page indicators
			const pageAny = page as any;
			if (pageAny.dynamic && pageAny.dynamic.referenceName) return true;
			if (pageAny.dynamicPageContentViewReferenceName) return true;

			// Pages with redirect URLs are link pages (even if pageType isn't explicitly 'link')
			// Check for common redirect URL properties (using 'any' type to access properties safely)
			if (pageAny.redirectUrl && pageAny.redirectUrl.trim()) return true;
			if (pageAny.redirect && pageAny.redirect.url && pageAny.redirect.url.trim()) return true;

			// Pages that link to files or other pages don't need modules
			// Using safe property access since these may not be in the type definition
			if (pageAny.linkToFileID && pageAny.linkToFileID > 0) return true;
			if (pageAny.linkToPageID && pageAny.linkToPageID > 0) return true;
			if (pageAny.linkToFile && pageAny.linkToFile > 0) return true;
			if (pageAny.linkToPage && pageAny.linkToPage > 0) return true;

			return false;
		};

		// Check if page has any content left after filtering
		if (totalModules === 0) {
			// Many pages legitimately have no modules (folder pages, link pages, etc.)
			// Only fail if this was a content page that had modules but lost them all during mapping
			const originalZones = page.zones || {};
			let originalModuleCount = 0;

			for (const [zoneName, zoneModules] of Object.entries(originalZones)) {
				if (Array.isArray(zoneModules)) {
					originalModuleCount += zoneModules.length;
				}
			}

			// If the page originally had modules but now has none, that's a problem
			// If it never had modules, that's fine (folder pages, etc.)
			if (originalModuleCount > 0 && !existingPage && !isLegitimateEmptyPage(page)) {
				const lostModulesError = `Lost all ${originalModuleCount} modules during content mapping`;
				console.error(`✗ Page "${page.name}" ${lostModulesError}`);
				return { status: "failure", error: lostModulesError };
			}
		}

		// Prepare payload - ensure proper null handling
		// Fix zones format - ensure zones is always a defined object (never null/undefined)
		const formattedZones = mappedZones && typeof mappedZones === "object" ? mappedZones : {};

		// CRITICAL FIX: Ensure every page has a valid title field
		// Folder pages often don't have titles, but API requires them
		const pageTitle = page.title || page.menuText || page.name || "Untitled Page";

		const pageJSON = JSON.stringify(page, null, 2);
		const pageCopy = JSON.parse(pageJSON) as mgmtApi.PageItem; // Create a copy to avoid modifying original

		const payload: any = {
			...pageCopy,
			// If local target file is missing but mapping exists, use the known target container ID
			// to force an UPDATE instead of INSERT (prevents duplicate name server errors)
			pageID: existingPage ? existingPage.pageID : (pageMapping?.targetPageID ?? -1),
			title: pageTitle, // CRITICAL: Ensure title is always present
			channelID: channelID, // CRITICAL: Always use target instance channel ID to avoid FK constraint errors
			zones: formattedZones,
			// CRITICAL: Include path field from sitemap enrichment (API bug: target sitemap returns null paths)
			path: page.path || "",
		};



		let parentIDArg = -1;

		if (parentPageID && parentPageID > 0) {
			const mapping = pageMapper.getPageMappingByPageID(parentPageID, 'source');

			if ((mapping?.targetPageID || 0) > 0) {
				parentIDArg = mapping.targetPageID;
				payload.parentPageID = mapping.targetPageID;
			} else {
				parentIDArg = -1;
				payload.parentPageID = -1; // No parent
			}
		} else {
			payload.parentPageID = -1; // Ensure no parent
		}

		let placeBeforeIDArg = -1;
		// Only set placeBeforeIDArg for NEW pages, not updates
		// For updates, we preserve the existing position unless explicitly moving
		if (!existingPage && insertBeforePageId && insertBeforePageId > 0) {
			//map the insertBeforePageId to the correct target page ID
			const mapping = pageMapper.getPageMappingByPageID(insertBeforePageId, 'source');
			if ((mapping?.targetPageID || 0) > 0) {
				placeBeforeIDArg = mapping.targetPageID;
			}
		} 

		const pageIDInOtherLocale = mappingToOtherLocale ? mappingToOtherLocale.PageIDOtherLanguage : -1;
		const otherLocale = mappingToOtherLocale ? mappingToOtherLocale.OtherLanguageCode : null;


		// Save the page with returnBatchID flag for consistent batch processing
		const savePageResponse = await apiClient.pageMethods.savePage(
			payload,
			targetGuid,
			locale,
			parentIDArg,
			placeBeforeIDArg,
			true,
			pageIDInOtherLocale,
			otherLocale,
			true
		);

		// Process the response - with returnBatchID=true, we should always get a batch ID
		if (Array.isArray(savePageResponse) && savePageResponse.length > 0) {
			// Final content mapping summary for debugging
			const finalContentIds: number[] = [];
			Object.values(payload.zones || {}).forEach((zone: any) => {
				if (Array.isArray(zone)) {
					zone.forEach((module: any) => {
						if (module.item?.contentid) {
							finalContentIds.push(module.item.contentid);
						}
					});
				}
			});

			// Final payload prepared (silent)

			// Extract batch ID from response
			const batchID = savePageResponse[0];
			// Page batch processing started (silent)

			// Poll batch until completion using consistent utility (pass payload for error matching)
			const { pollBatchUntilComplete, extractBatchResults } = await import("../batch-polling");
			const completedBatch = await pollBatchUntilComplete(
				apiClient,
				batchID,
				targetGuid,
				[payload], // Pass payload for FIFO error matching
				300, // maxAttempts
				2000, // intervalMs
				"Page" // batchType
			);

			// Extract result from completed batch
			const { successfulItems: batchSuccessItems, failedItems: batchFailedItems } = extractBatchResults(
				completedBatch,
				[page]
			);

			let actualPageID = -1;
			let savedPageVersionID = -1;
			if (batchSuccessItems.length > 0) {
				//grab the save page info form the batch success items
				actualPageID = batchSuccessItems[0].newId;
				savedPageVersionID = batchSuccessItems[0].newItem?.processedItemVersionID || -1;
			} else if (batchFailedItems.length > 0) {
				logger.page.error(page, `✗ Page ${page.name} batch failed: ${batchFailedItems[0].error}`, locale, channel, targetGuid);
			}

			if (actualPageID > 0) {
				// Success case
				const createdPageData = {
					...payload, // Use the payload data which has mapped zones
					pageID: actualPageID,

				} as mgmtApi.PageItem;

				if (savedPageVersionID > 0) {
					// Set version ID if available
					createdPageData.properties.versionID = savedPageVersionID; // Set version ID from batch result
				}

				pageMapper.addMapping(page, createdPageData); // Use original page for source key

				const pageTypeDisplay =
					{
						static: "Page",
						link: "Link",
						folder: "Folder",
					}[page.pageType] || page.pageType;

				if (existingPage) {
					if (overwrite) {
						logger.page.updated(page, "updated", locale, channel, targetGuid);

					} else {
						logger.page.updated(page, "updated", locale, channel, targetGuid);
					}
				} else {
					logger.page.created(page, "created", locale, channel, targetGuid);
				}
				return { status: "success" }; // Success
			} else {
				// Extract error message - prefer structured failedItems from new API
				let errorMsg: string;
				if (Array.isArray(completedBatch.failedItems) && completedBatch.failedItems.length > 0) {
					// Use structured error from new API
					errorMsg = completedBatch.failedItems[0].errorMessage || 'Unknown batch error';
				} else if (batchFailedItems.length > 0 && batchFailedItems[0].error) {
					// Use error from extractBatchResults
					errorMsg = batchFailedItems[0].error;
				} else if (completedBatch.errorData && typeof completedBatch.errorData === 'string' && !completedBatch.errorData.startsWith('{')) {
					// Use errorData only if it's a simple string (not JSON)
					errorMsg = completedBatch.errorData.trim();
				} else {
					errorMsg = `Invalid page ID: ${actualPageID}`;
				}
				logger.page.error(page, `✗ Page "${page.name}" failed - ${errorMsg}, locale:${locale}`, locale, channel, targetGuid);
				return { status: "failure", error: errorMsg };
			}
		} else {
			const errorMsg = "Unexpected response format";
			logger.page.error(page, `✗ Page "${page.name}" failed in locale:${locale} - ${errorMsg}`, locale, channel, targetGuid);
			return { status: "failure", error: errorMsg };
		}
	} catch (error: any) {
		logger.page.error(page, `✗ Page "${page.name}" failed in locale:${locale} - ${error.message}`, locale, channel, targetGuid);
		return { status: "failure", error: error.message };
	}
}
