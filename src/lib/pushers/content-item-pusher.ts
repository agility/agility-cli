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

// Helper function to get default asset container URL
async function getDefaultAssetContainerUrl(apiClient: mgmtApi.ApiClient, targetGuid: string): Promise<string | null> {
    try {
        const defaultContainer = await apiClient.assetMethods.getDefaultContainer(targetGuid);
        const defaultUrl = defaultContainer?.originUrl || null;
        if (!defaultUrl) {
            console.warn(ansiColors.yellow(`[Content Pusher] Could not retrieve default asset container origin URL for target GUID ${targetGuid}. Asset URL mapping might be incomplete.`));
        }
        return defaultUrl;
    } catch (err: any) {
        console.error(ansiColors.red(`[Content Pusher] Error fetching default asset container for target GUID ${targetGuid}: ${err.message}`));
        return null; 
    }
}

// Helper function to wrap text lines
function wrapLines(str: string, width: number = 80): string {
    return str.replace(new RegExp(`(.{1,${width}})(\\s+|$)`, 'g'), (match, p1) => p1.trim() + '\n');
}

export async function pushContent(
    contentItems: mgmtApi.ContentItem[],
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successfulItems: number, failedItems: number }> {

    if (!contentItems || contentItems.length === 0) {
        console.log('No content items found to process.');
        return { status: 'success', successfulItems: 0, failedItems: 0 };
    }

    const originalItemCount = contentItems.length;
    let processedItemCount = 0;
    let successfulItems = 0;
    let failedItems = 0;
    let overallStatus: 'success' | 'error' = 'success';

    // Initialize default asset container URL
    const defaultTargetAssetContainerOriginUrl = await getDefaultAssetContainerUrl(apiClient, targetGuid);

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
        let itemStatus: 'success' | 'error' = 'success';
        
        try {
            existingContentItem = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, referenceMapper);

            // *** Map the content item JUST BEFORE saving ***
            mappedContentItem = await mapContentItem(
                contentItem, 
                referenceMapper,
                apiClient,
                targetGuid,
                defaultTargetAssetContainerOriginUrl || ''
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
            const targetContentId = await apiClient.contentMethods.saveContentItem(payload, targetGuid, locale);
            
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
                referenceMapper.addRecord('content', contentItem, failedContentItem);
                failedItems++;
                itemStatus = 'error';
                overallStatus = 'error';
            } else if (targetContentId && (typeof targetContentId === 'object' && 'errorData' in targetContentId)) {
                console.log(`✗ Content item ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) failed with API error:`);
                console.log(`[Debug] Error:`, (targetContentId as any).errorData);
                console.log(`[Debug] Payload fields:`, Object.keys(payload.fields).join(', '));
                
                // Add to mapper with -1 to track the failure
                const failedContentItem: mgmtApi.ContentItem = {
                    ...payload,
                    contentID: -1
                };
                referenceMapper.addRecord('content', contentItem, failedContentItem);
                failedItems++;
                itemStatus = 'error';
                overallStatus = 'error';
            } else if (targetContentId) { 
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
                    failedItems++;
                    itemStatus = 'error';
                    overallStatus = 'error';
                    processedItemCount++;
                    if (onProgress) {
                        onProgress(processedItemCount, totalItemCount, overallStatus);
                    }
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
                    referenceMapper.addRecord('content', contentItem, failedContentItem);
                    failedItems++;
                    itemStatus = 'error';
                    overallStatus = 'error';
                } else {
                    // Success case
                    const targetContentItem: mgmtApi.ContentItem = {
                        ...payload,
                        contentID: actualContentId
                    };
                    
                    referenceMapper.addRecord('content', contentItem, targetContentItem);
                    console.log(`✓ Content item created: ${contentItem.properties.referenceName} (${contentItem.properties.definitionName}) - Source: ${contentItem.contentID} Target: ${actualContentId}`);
                    successfulItems++;
                }
            }

        } catch (error: any) {
            console.error(`✗ Error processing content item ${contentItem.properties.referenceName}:`, error.message);
            failedItems++;
            itemStatus = 'error';
            overallStatus = 'error';
        }

        processedItemCount++;
        if (onProgress) {
            onProgress(processedItemCount, totalItemCount, itemStatus);
        }
    }

    // Process nested content items second
    for (let j = 0; j < nestedContentItems.length; j++) {
        const contentItem = nestedContentItems[j];
        
        let existingContentItem = null;
        let mappedContentItem = null;
        let payload = null;
        let itemStatus: 'success' | 'error' = 'success';
        
        try {
            existingContentItem = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, referenceMapper);

            // *** Map the content item JUST BEFORE saving ***
            mappedContentItem = await mapContentItem(
                contentItem, 
                referenceMapper,
                apiClient,
                targetGuid,
                defaultTargetAssetContainerOriginUrl || ''
            );

            // Define default SEO and Scripts
            const defaultSeo: mgmtApi.SeoProperties = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
            const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };

            payload = {
                ...mappedContentItem,
                contentID: existingContentItem ? existingContentItem.contentID : -1,
                properties: {
                    ...mappedContentItem.properties,
                    definitionName: mappedContentItem.properties.definitionName || contentItem.properties.definitionName,
                    referenceName: mappedContentItem.properties.referenceName || contentItem.properties.referenceName,
                    itemOrder: existingContentItem ? existingContentItem.properties.itemOrder : mappedContentItem.properties.itemOrder
                },
                fields: mappedContentItem.fields,
                seo: mappedContentItem.seo ?? defaultSeo,
                scripts: mappedContentItem.scripts ?? defaultScripts
            }

            const targetContentId = await apiClient.contentMethods.saveContentItem(payload, targetGuid, locale);
            
            // Handle response similar to normal content items
            if (!targetContentId) {
                console.log(`✗ Nested content item ${contentItem.properties.referenceName} failed - API returned null/undefined`);
                failedItems++;
                itemStatus = 'error';
                overallStatus = 'error';
            } else if (targetContentId && (typeof targetContentId === 'object' && 'errorData' in targetContentId)) {
                console.log(`✗ Nested content item ${contentItem.properties.referenceName} failed with API error:`, (targetContentId as any).errorData);
                failedItems++;
                itemStatus = 'error';
                overallStatus = 'error';
            } else {
                // Extract actual content ID
                let actualContentId: number;
                if (typeof targetContentId === 'number') {
                    actualContentId = targetContentId;
                } else if (Array.isArray(targetContentId)) {
                    actualContentId = targetContentId[0];
                } else if (typeof targetContentId === 'object' && 'items' in targetContentId) {
                    actualContentId = (targetContentId as any).items[0].itemID;
                } else {
                    console.log(`✗ Unexpected nested content response format:`, targetContentId);
                    failedItems++;
                    itemStatus = 'error';
                    overallStatus = 'error';
                    processedItemCount++;
                    if (onProgress) {
                        onProgress(processedItemCount, totalItemCount, overallStatus);
                    }
                    continue;
                }

                if (actualContentId && actualContentId > 0) {
                    const targetContentItem: mgmtApi.ContentItem = {
                        ...payload,
                        contentID: actualContentId
                    };
                    referenceMapper.addRecord('content', contentItem, targetContentItem);
                    console.log(`✓ Nested content item created: ${contentItem.properties.referenceName} - Source: ${contentItem.contentID} Target: ${actualContentId}`);
                    successfulItems++;
                } else {
                    console.log(`✗ Invalid nested content ID: ${actualContentId}`);
                    failedItems++;
                    itemStatus = 'error';
                    overallStatus = 'error';
                }
            }

        } catch (error: any) {
            console.error(`✗ Error processing nested content item ${contentItem.properties.referenceName}:`, error.message);
            failedItems++;
            itemStatus = 'error';
            overallStatus = 'error';
        }

        processedItemCount++;
        if (onProgress) {
            onProgress(processedItemCount, totalItemCount, itemStatus);
        }
    }

    console.log(ansiColors.yellow(`Processed ${successfulItems}/${totalItemCount} content items (${failedItems} failed)`));
    return { status: overallStatus, successfulItems, failedItems };
}