import { ReferenceMapper } from "../reference-mapper";
import * as mgmtApi from '@agility/management-sdk';
import { findContentInTargetInstance } from "../finders/content-item-finder";
import ansiColors from "ansi-colors";

// Simple content item mapping function to replace the deleted mapper
async function mapContentItem(
    contentItem: mgmtApi.ContentItem,
    referenceMapper: ReferenceMapper,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    defaultAssetUrl: string
): Promise<mgmtApi.ContentItem> {
    // For now, return the content item as-is
    // TODO: Add field mapping logic here if needed
    return { ...contentItem };
}

export class pushContentItems {
    private apiClient: mgmtApi.ApiClient;
    private referenceMapper: ReferenceMapper;
    private targetGuid: string;
    private locale: string;
    private successfulItems: number = 0;
    private failedItems: number = 0;
    private defaultTargetAssetContainerOriginUrl: string | null = null;

    constructor(apiClient: mgmtApi.ApiClient, referenceMapper: ReferenceMapper, targetGuid: string, locale: string) {
        this.apiClient = apiClient;
        this.referenceMapper = referenceMapper;
        this.targetGuid = targetGuid;
        this.locale = locale;
        this.successfulItems = 0;
        this.failedItems = 0;
    }

    private async initialize(): Promise<void> {
        try {
            const defaultContainer = await this.apiClient.assetMethods.getDefaultContainer(this.targetGuid);
            this.defaultTargetAssetContainerOriginUrl = defaultContainer?.originUrl || null;
            if (!this.defaultTargetAssetContainerOriginUrl) {
                console.warn(ansiColors.yellow(`[Content Item Pusher] Could not retrieve default asset container origin URL for target GUID ${this.targetGuid}. Asset URL mapping might be incomplete.`));
            }
        } catch (err: any) {
            console.error(ansiColors.red(`[Content Item Pusher] Error fetching default asset container for target GUID ${this.targetGuid}: ${err.message}`));
            this.defaultTargetAssetContainerOriginUrl = null; 
        }
    }

    async pushContentItems(contentItems: mgmtApi.ContentItem[], onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void): Promise<{ successfulItems: number, failedItems: number }> {
        const originalItemCount = contentItems.length;
        let processedItemCount = 0;
        let lastItemStatus: 'success' | 'error' = 'success'; // Track status of the *last* item attempt

        await this.initialize();

        // Filter out i18 content items to speed up testing
        const nonI18ContentItems = contentItems.filter(item => {
            const referenceName = item.properties.referenceName?.toLowerCase() || '';
            const definitionName = item.properties.definitionName?.toLowerCase() || '';
            
            // Skip i18 content items (internationalization/localization items)
            if (referenceName.includes('i18') || definitionName.includes('i18')) {
                return false;
            }
            
            return true;
        });

        const totalItemCount = nonI18ContentItems.length; // Update total to reflect filtered items
        console.log(ansiColors.cyan(`[Content Pusher] Processing ${totalItemCount} content items (filtered ${originalItemCount - totalItemCount} i18 items)`));

        // First, process content items without nested content references
        const normalContentItems = nonI18ContentItems.filter(item => {
            const definitionName = item.properties.definitionName; // Get definition name
            // Check if any field contains a nested content reference, EXCLUDING known list refs
            const isNested = Object.entries(item.fields).some(([key, field]) => {
                // Rule out PostsListing.posts field
                if (definitionName === 'PostsListing' && key === 'posts') {
                    return false;
                }
                // Add rules for other known list reference fields here if needed
                // Example: if (definitionName === 'MyListModule' && key === 'myListField') return false;

                if (typeof field === 'object' && field !== null) {
                    // A simple check for a nested content item structure
                    return 'contentid' in field || 'contentID' in field;
                }
                return false;
            });
            return !isNested;
        });

        // Then process content items with nested content references
        const nestedContentItems = nonI18ContentItems.filter(item => !normalContentItems.includes(item)).reverse();

        console.log(ansiColors.cyan(`[Content Pusher] Categorization: ${normalContentItems.length} normal + ${nestedContentItems.length} nested items`));

        // Process normal content items first
        for (let i = 0; i < normalContentItems.length; i++) {
            const contentItem = normalContentItems[i];
            
            let existingContentItem = null;
            let mappedContentItem = null;
            let payload = null;
            lastItemStatus = 'success'; // Assume success initially
            try {
                existingContentItem = await findContentInTargetInstance(contentItem, this.apiClient, this.targetGuid, this.locale, this.referenceMapper);

                // *** Map the content item JUST BEFORE saving ***
                mappedContentItem = await mapContentItem(
                    contentItem, 
                    this.referenceMapper,
                    this.apiClient,
                    this.targetGuid,
                    this.defaultTargetAssetContainerOriginUrl || ''
                );

                // Define default SEO and Scripts
                const defaultSeo: mgmtApi.SeoProperties = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
                const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };

                payload = {
                    ...mappedContentItem, // Spread the mapped item first
                    contentID: existingContentItem ? existingContentItem.contentID : -1, // ALWAYS set to -1 for create/update
                    properties: {
                        ...mappedContentItem.properties,
                        // Ensure definitionName and referenceName are present
                        definitionName: mappedContentItem.properties.definitionName || contentItem.properties.definitionName,
                        referenceName: mappedContentItem.properties.referenceName || contentItem.properties.referenceName,
                        itemOrder: existingContentItem ? existingContentItem.properties.itemOrder : mappedContentItem.properties.itemOrder
                    },
                    fields: mappedContentItem.fields,
                    seo: mappedContentItem.seo ?? defaultSeo, // Ensure seo exists
                    scripts: mappedContentItem.scripts ?? defaultScripts // Ensure scripts exists
                }

                // Restore 4th argument to true
                const targetContentId = await this.apiClient.contentMethods.saveContentItem(payload, this.targetGuid, this.locale);
                
                if(typeof targetContentId !== 'object'){
                    console.log('targetContentId', targetContentId);
                }
                
                // Enhanced error analysis for content item failures
                if (!targetContentId) {
                    console.log(`✗ Content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) failed - API returned null/undefined`);
                    console.log(`[Debug] Payload fields:`, Object.keys(payload.fields).join(', '));
                    
                    // Add to mapper with -1 to track the failure
                    const failedContentItem: mgmtApi.ContentItem = {
                        ...payload,
                        contentID: -1
                    };
                    this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                    this.failedItems++;
                    lastItemStatus = 'error';
                    continue;
                }
                
                // Check for API error data primarily
                if (targetContentId && (typeof targetContentId === 'object' && 'errorData' in targetContentId)) {
                    console.log(`✗ Content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) failed with API error:`);
                    console.log(`[Debug] Error:`, (targetContentId as any).errorData);
                    console.log(`[Debug] Payload fields:`, Object.keys(payload.fields).join(', '));
                    
                    // Add to mapper with -1 to track the failure
                    const failedContentItem: mgmtApi.ContentItem = {
                        ...payload,
                        contentID: -1
                    };
                    this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                    this.failedItems++;
                    lastItemStatus = 'error';
                    continue;
                }
                
                if (targetContentId) { 
                    // Extract the actual content ID - it might be a number or a batch response object
                    let actualContentId: number;
                    
                    if (typeof targetContentId === 'number') {
                        actualContentId = targetContentId;
                    } else if (typeof targetContentId === 'object' && Array.isArray(targetContentId)) {
                        // Handle array response - use the first item
                        actualContentId = targetContentId[0];
                    } else if (typeof targetContentId === 'object' && 'items' in targetContentId && Array.isArray((targetContentId as any).items) && (targetContentId as any).items[0]) {
                        // Handle batch response - extract the itemID from the first item
                        actualContentId = (targetContentId as any).items[0].itemID;
                    } else {
                        console.log(`✗ Unexpected targetContentId format for ${contentItem.properties.referenceName}:`, targetContentId);
                        console.log(`[Debug] Content type: ${contentItem.properties.definitionName}`);
                        this.failedItems++;
                        lastItemStatus = 'error';
                        continue;
                    }

                    // Validate that we got a valid content ID
                    if (!actualContentId || actualContentId <= 0) {
                        console.log(`✗ Content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) creation failed - received invalid contentID: ${actualContentId}`);
                        console.log(`[Debug] Response type: ${typeof targetContentId}, Response:`, JSON.stringify(targetContentId, null, 2));
                        console.log(`[Debug] Payload fields with potential issues:`, Object.entries(payload.fields).filter(([key, value]) => {
                            // Check for asset URLs, content references, etc.
                            const valueStr = JSON.stringify(value).toLowerCase();
                            return valueStr.includes('http') || valueStr.includes('contentid') || valueStr.includes('referencename');
                        }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`));
                        
                        // Add to mapper with -1 to track the failure
                        const failedContentItem: mgmtApi.ContentItem = {
                            ...payload,
                            contentID: -1
                        };
                        this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                        this.failedItems++;
                        lastItemStatus = 'error';
                        continue;
                    }

                    // Construct the target item for the mapper
                    const newContentItem: mgmtApi.ContentItem = {
                        ...payload, // Use the payload we sent
                        contentID: actualContentId // Update with the actual numeric target ID
                    };
                    
                    this.referenceMapper.addRecord('content', contentItem, newContentItem); // Use addRecord
                    // const action = existingContentItem ? 'updated':'created';
                    console.log(`✓ Content item ${ansiColors.underline(contentItem.properties.referenceName)} ${ansiColors.bold.cyan(existingContentItem ? 'updated' : 'created')} ${ansiColors.green('Source:')} ${contentItem.contentID} ${ansiColors.green(this.targetGuid)}  contentID:${actualContentId}`);
                    this.successfulItems++;
                } else {
                    // This case might happen if creating failed silently or response is unexpected
                    console.log(`✗ Content item save reported success by API, but no target ID found.`,ansiColors.red('Source:'), contentItem.properties.referenceName , '(ID:', contentItem.contentID, ')');
                    this.failedItems++;
                    lastItemStatus = 'error'; // Mark as error
                }
            } catch (error) {
                console.error(`✗ Error during processing/saving normal content item ${contentItem?.properties?.referenceName} (ID: ${contentItem?.contentID}):`, error);
                // Optionally log payload if available
                if (payload) console.error('Payload at time of error:', JSON.stringify(payload, null, 2));
                this.failedItems++;
                lastItemStatus = 'error'; // Mark as error
            }
            // Increment count and call callback after each item attempt
            processedItemCount++;
            if (onProgress) {
                onProgress(processedItemCount, totalItemCount, lastItemStatus);
            }
        }

        // Process nested content items with multi-pass logic for complex dependencies
        let remainingNestedItems = [...nestedContentItems];
        let passNumber = 1;
        const maxPasses = 3; // Limit passes to prevent infinite loops
        
        while (remainingNestedItems.length > 0 && passNumber <= maxPasses) {
            console.log(ansiColors.cyan(`[Content Pusher] Nested content pass ${passNumber}: ${remainingNestedItems.length} items remaining`));
            const itemsToRetry: mgmtApi.ContentItem[] = [];
            
                         for (let i = 0; i < remainingNestedItems.length; i++) {
                const contentItem = remainingNestedItems[i];
            
            let existingContentItem = null;
            let mappedContentItem = null;
            let payload = null;
            lastItemStatus = 'success'; // Assume success initially
            try {
                existingContentItem = await findContentInTargetInstance(contentItem, this.apiClient, this.targetGuid, this.locale, this.referenceMapper);

                // *** Map the content item JUST BEFORE saving ***
                mappedContentItem = await mapContentItem(
                    contentItem, 
                    this.referenceMapper,
                    this.apiClient,
                    this.targetGuid,
                    this.defaultTargetAssetContainerOriginUrl || ''
                );

                // Define default SEO and Scripts
                const defaultSeo: mgmtApi.SeoProperties = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
                const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };
                
                payload = {
                    ...mappedContentItem, // Spread the mapped item first
                    contentID: existingContentItem ? existingContentItem.contentID : -1, // ALWAYS set to -1 for create/update
                    properties: {
                        ...mappedContentItem.properties,
                        // Ensure definitionName and referenceName are present
                        definitionName: mappedContentItem.properties.definitionName || contentItem.properties.definitionName,
                        referenceName: mappedContentItem.properties.referenceName || contentItem.properties.referenceName,
                        itemOrder: existingContentItem ? existingContentItem.properties.itemOrder : mappedContentItem.properties.itemOrder
                    },
                    fields: mappedContentItem.fields,
                    seo: mappedContentItem.seo ?? defaultSeo, // Ensure seo exists
                    scripts: mappedContentItem.scripts ?? defaultScripts // Ensure scripts exists
                }

                // Use 4 args for detailed response
                const targetContentId = await this.apiClient.contentMethods.saveContentItem(payload, this.targetGuid, this.locale);

                // Enhanced error analysis for nested content item failures
                if (!targetContentId) {
                    console.log(`✗ Nested content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) failed - API returned null/undefined (Pass ${passNumber})`);
                    console.log(`[Debug] Payload fields:`, Object.keys(payload.fields).join(', '));
                    
                    // Add to retry list for potential dependency issues
                    if (passNumber < maxPasses) {
                        itemsToRetry.push(contentItem);
                    } else {
                        // Add to mapper with -1 to track the final failure
                        const failedContentItem: mgmtApi.ContentItem = {
                            ...payload,
                            contentID: -1
                        };
                        this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                        this.failedItems++;
                        lastItemStatus = 'error';
                    }
                    continue;
                }
                
                // Check for API error data primarily
                if (targetContentId && (typeof targetContentId === 'object' && 'errorData' in targetContentId)) {
                    console.log(`✗ Nested content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) failed with API error (Pass ${passNumber}):`);
                    console.log(`[Debug] Error:`, (targetContentId as any).errorData);
                    console.log(`[Debug] Payload fields:`, Object.keys(payload.fields).join(', '));
                    
                    // Add to retry list for potential dependency issues
                    if (passNumber < maxPasses) {
                        itemsToRetry.push(contentItem);
                    } else {
                        // Add to mapper with -1 to track the final failure
                        const failedContentItem: mgmtApi.ContentItem = {
                            ...payload,
                            contentID: -1
                        };
                        this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                        this.failedItems++;
                        lastItemStatus = 'error';
                    }
                    continue;
                }
                
                if (targetContentId) {
                    // Extract the actual content ID - it might be a number or a batch response object
                    let actualContentId: number;
                    
                    if (typeof targetContentId === 'number') {
                        actualContentId = targetContentId;
                    } else if (typeof targetContentId === 'object' && Array.isArray(targetContentId)) {
                        // Handle array response - use the first item
                        actualContentId = targetContentId[0];
                    } else if (typeof targetContentId === 'object' && 'items' in targetContentId && Array.isArray((targetContentId as any).items) && (targetContentId as any).items[0]) {
                        // Handle batch response - extract the itemID from the first item
                        actualContentId = (targetContentId as any).items[0].itemID;
                    } else {
                        console.log(`✗ Unexpected nested targetContentId format for ${contentItem.properties.referenceName}:`, targetContentId);
                        console.log(`[Debug] Content type: ${contentItem.properties.definitionName}`);
                        this.failedItems++;
                        lastItemStatus = 'error';
                        continue;
                    }

                    // Validate that we got a valid content ID
                    if (!actualContentId || actualContentId <= 0) {
                        console.log(`✗ Nested content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) creation failed - received invalid contentID: ${actualContentId} (Pass ${passNumber})`);
                        console.log(`[Debug] Response type: ${typeof targetContentId}, Response:`, JSON.stringify(targetContentId, null, 2));
                        console.log(`[Debug] Payload fields with potential issues:`, Object.entries(payload.fields).filter(([key, value]) => {
                            // Check for asset URLs, content references, etc.
                            const valueStr = JSON.stringify(value).toLowerCase();
                            return valueStr.includes('http') || valueStr.includes('contentid') || valueStr.includes('referencename');
                        }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`));
                        
                        // Add to retry list for potential dependency issues
                        if (passNumber < maxPasses) {
                            itemsToRetry.push(contentItem);
                        } else {
                            // Add to mapper with -1 to track the final failure
                            const failedContentItem: mgmtApi.ContentItem = {
                                ...payload,
                                contentID: -1
                            };
                            this.referenceMapper.addRecord('content', contentItem, failedContentItem);
                            this.failedItems++;
                            lastItemStatus = 'error';
                        }
                        continue;
                    }

                    // Construct the target item for the mapper
                    const newContentItem: mgmtApi.ContentItem = {
                        ...payload, // Use the payload we sent
                        contentID: actualContentId // Update with the actual numeric target ID
                    };
                    
                    this.referenceMapper.addRecord('content', contentItem, newContentItem); // Use addRecord
                    // const action = existingContentItem ? 'updated':'created';
                    console.log(`✓ Nested Content item ${ansiColors.underline(contentItem.properties.referenceName)} ${ansiColors.bold.cyan(existingContentItem ? 'updated' : 'created')} ${ansiColors.green('Source:')} ${contentItem.contentID} ${ansiColors.green(this.targetGuid)} contentID:${actualContentId}`);
                    this.successfulItems++;
                } else {
                    // This case might happen if creating failed silently or response is unexpected
                    console.log(`✗ Nested content item save reported success by API, but no target ID found (Pass ${passNumber}).`,ansiColors.red('Source:'), contentItem.properties.referenceName , '(ID:', contentItem.contentID, ')');
                    
                    // Add to retry list for potential dependency issues
                    if (passNumber < maxPasses) {
                        itemsToRetry.push(contentItem);
                    } else {
                        this.failedItems++;
                        lastItemStatus = 'error'; // Mark as error
                    }
                }
            } catch (error) {
                console.error(`✗ Error during processing/saving nested content item ${contentItem?.properties?.referenceName} (ID: ${contentItem?.contentID}):`, error);
                // Optionally log payload if available
                if (payload) console.error('Payload at time of error:', JSON.stringify(payload, null, 2));
                
                // Add to retry list for potential dependency issues
                if (passNumber < maxPasses) {
                    itemsToRetry.push(contentItem);
                } else {
                    this.failedItems++;
                    lastItemStatus = 'error'; // Mark as error
                }
            }
            // Increment count and call callback after each item attempt
            processedItemCount++;
            if (onProgress) {
                onProgress(processedItemCount, totalItemCount, lastItemStatus);
            }
        }
        
        // Prepare for next pass
        remainingNestedItems = itemsToRetry;
        passNumber++;
        
        // If we have items to retry but made no progress this pass, break to avoid infinite loop
        if (itemsToRetry.length === remainingNestedItems.length && passNumber > 1) {
            console.warn(ansiColors.yellow(`[Content Pusher] No progress made in nested content pass ${passNumber - 1}. Stopping retries.`));
            this.failedItems += remainingNestedItems.length;
            break;
        }
    }

        console.log(ansiColors.cyan(`[Content Pusher] ✓ Completed: ${this.successfulItems} successful, ${this.failedItems} failed`));
        return { successfulItems: this.successfulItems, failedItems: this.failedItems };
    }

 
    private wrapLines(str, width = 80) {
        return str
          .split('\n')
          .map(line => {
            const result = [];
            while (line.length > width) {
              let sliceAt = line.lastIndexOf(' ', width);
              if (sliceAt === -1) sliceAt = width;
              result.push(line.slice(0, sliceAt));
              line = line.slice(sliceAt).trimStart();
            }
            result.push(line);
            return result.join('\n');
          })
          .join('\n');
      }
}