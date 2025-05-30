import * as path from 'path';
import * as fs from 'fs/promises';
import ansiColors from 'ansi-colors';
import * as mgmtApi from '@agility/management-sdk';
import { getAssetFilePath } from './utilities/asset-utils';

interface ReferenceRecord {
    type: 'model' | 'container' | 'content' | 'asset' | 'gallery' | 'template' | 'page' | 'url' | 'container-name';
    source: any;
    target: any | null;
    sourceGUID: string;
    targetGUID: string;
}

interface ReferenceResult<T> {
    source: T;
    target: T | null;
    sourceGUID: string;
    targetGUID: string;
}

export class ReferenceMapper {
    private records: ReferenceRecord[] = [];
    private mappingsDir: string;
    private sourceGUID: string;
    private targetGUID: string;

    constructor(sourceGUID: string, targetGUID: string) {
        this.sourceGUID = sourceGUID;
        this.targetGUID = targetGUID;
        // Store in agility-files/{targetGUID}/mappings/
        this.mappingsDir = path.join(process.cwd(), 'agility-files', targetGUID, 'mappings');
        // Load existing mappings
        this.loadMappings().catch(err => {
            console.error('Failed to load mappings:', err);
        });
    }

    private async ensureDirectory(): Promise<void> {
        await fs.mkdir(this.mappingsDir, { recursive: true });
    }

    private getMappingFilePath(type: ReferenceRecord['type']): string {
        return path.join(this.mappingsDir, `${type}-mappings.json`);
    }

    async loadMappings(): Promise<void> {
        try {
            await this.ensureDirectory();
            this.records = [];

            // Get all possible types from the ReferenceRecord type
            const types: ReferenceRecord['type'][] = [
                'model', 'container', 'content', 'asset', 'gallery', 
                'template', 'page', 'url', 'container-name'
            ];

            // Load each type's mappings
            for (const type of types) {
                const filePath = this.getMappingFilePath(type);
                try {
                    const data = await fs.readFile(filePath, 'utf-8');
                    const typeRecords = JSON.parse(data) as ReferenceRecord[];
                    // Filter out any records that don't match our source/target GUIDs
                    const filteredRecords = typeRecords.filter(record => 
                        record.sourceGUID === this.sourceGUID && 
                        record.targetGUID === this.targetGUID
                    );
                    this.records.push(...filteredRecords);
                } catch (error) {
                    // File doesn't exist or other error - skip this type
                    continue;
                }
            }
        } catch (error) {
            // If there's an error, start with empty records
            this.records = [];
            console.error('Error loading mappings:', error);
        }
    }

    private async saveMappingsByType(type: ReferenceRecord['type']): Promise<void> {
        await this.ensureDirectory();
        const filePath = this.getMappingFilePath(type);
        const typeRecords = this.records.filter(r => r.type === type);
        
        if (typeRecords.length > 0) {
            await fs.writeFile(filePath, JSON.stringify(typeRecords, null, 2), 'utf-8');
        } else {
            // If no records of this type, remove the file if it exists
            try {
                await fs.unlink(filePath);
            } catch {
                // File doesn't exist, ignore error
            }
        }
    }

    /**
     * 
     * The reference mapper is the memory behind the content pushing operations
     * since we generally end up with new ID's and reference names when we create content
     * we need to use that content in subsequent content and page pushes
     * 
     * 
     * Add or update a reference record
     * @param type - The type of the reference record
     * @param source - The source object of the reference record
     * @param target - The target object of the reference record
     * 
     * Both source and target should be pushed together, so that the reference is always consistent.
     */
    addRecord(type: ReferenceRecord['type'], source: any, target: any | null = null): void {
        const existingIndex = this.records.findIndex(r => {
            if (r.type !== type) return false;
            
            // Add specific ID check for content items
            if (type === 'content' && source.contentID) {
                return r.source.contentID === source.contentID;
            }

            // Add specific ID check for models
            if (type === 'model' && source.id) {
                return r.source.id === source.id;
            }

            // Special handling for templates
            if (type === 'template' && source.pageTemplateName) {
                return r.source.pageTemplateName === source.pageTemplateName;
            }

            // *** RE-ADDED: Special handling for pages ***
            if (type === 'page' && source.pageID) {
                return r.source.pageID === source.pageID;
            }

            // Special handling for containers by contentViewID  
            if (type === 'container' && source.contentViewID) {
                return r.source.contentViewID === source.contentViewID;
            }

            // Special handling for assets by originUrl
            if (type === 'asset' && source.originUrl) {
                return r.source.originUrl === source.originUrl;
            }

            // Special handling for URLs
            if (type === 'url' && source.url) {
                return r.source.url === source.url;
            }

            // Special handling for container-name mappings
            if (type === 'container-name' && source.originalName) {
                return r.source.originalName === source.originalName;
            }

            // Default comparison for other types
            return JSON.stringify(r.source) === JSON.stringify(source);
        });

        if (existingIndex >= 0) {
            // Update existing record - prefer records with targets
            const existingRecord = this.records[existingIndex];
            const updatedRecord = {
                type,
                source,
                target: target || existingRecord.target, // Keep existing target if no new target provided
                sourceGUID: this.sourceGUID,
                targetGUID: this.targetGUID
            };

            // Only update if we're providing a better record (with target when existing doesn't have one)
            if (target || !existingRecord.target) {
                this.records[existingIndex] = updatedRecord;
                
                // Log update for debugging
                if (type === 'model' || type === 'container') {
                    const identifier = type === 'model' ? source.id : source.contentViewID;
                    console.log(ansiColors.blue(`[Mapper] Updated ${type} mapping: ${identifier} → ${target ? (type === 'model' ? target.id : target.contentViewID) : 'null'}`));
                }
            }
        } else {
            // Add new record
            const newRecord = {
                type,
                source,
                target,
                sourceGUID: this.sourceGUID,
                targetGUID: this.targetGUID
            };
            
            this.records.push(newRecord);
            
            // Log addition for debugging
            if (type === 'model' || type === 'container') {
                const identifier = type === 'model' ? source.id : source.contentViewID;
                console.log(ansiColors.green(`[Mapper] Added ${type} mapping: ${identifier} → ${target ? (type === 'model' ? target.id : target.contentViewID) : 'null'}`));
            }
        }

        // Save the specific type's mappings
        this.saveMappingsByType(type).catch(err => {
            console.error(`Failed to save ${type} mappings:`, err);
        });
    }

    /**
     * Get a mapping by type and any property of the source object
     * @param type - The type of record to find
     * @param key - The property name to search by
     * @param value - The value to match
     * @returns The source and target objects, or null if not found
     */
    getMapping<T>(type: ReferenceRecord['type'], key: string, value: any): ReferenceResult<T> | null {
        if(type === 'asset' && key === 'originUrl') {
            // For asset originUrl lookups, we need to handle both direct matches and path matches
            const record = this.records.find(r => 
                r.type === type && 
                (typeof value === 'string' 
                    ? r.source[key]?.toLowerCase() === value.toLowerCase() ||
                      r.source[key]?.toLowerCase().endsWith(value.toLowerCase().split('/').pop())
                    : r.source[key] === value)
            );
            return record ? { 
                source: record.source, 
                target: record.target,
                sourceGUID: record.sourceGUID,
                targetGUID: record.targetGUID
            } : null;
        }

        // Find all matching records
        const matchingRecords = this.records.filter(r => 
            r.type === type && 
            (typeof value === 'string' && typeof r.source[key] === 'string'
                ? r.source[key].toLowerCase() === value.toLowerCase()
                : r.source[key] === value)
        );

        if (matchingRecords.length === 0) {
            return null;
        }

        // If there are multiple records, prioritize ones with non-null targets
        const recordWithTarget = matchingRecords.find(r => r.target !== null);
        const record = recordWithTarget || matchingRecords[0];

        return { 
            source: record.source, 
            target: record.target,
            sourceGUID: record.sourceGUID,
            targetGUID: record.targetGUID
        };
    }

    /**
     * Get a mapping by type and a specific key-value pair
     * @param type - The type of record to find
     * @param key - The property name to search by
     * @param value - The value to match
     * @returns The source and target objects, or null if not found
     */
    getMappingByKey<T>(type: ReferenceRecord['type'], key: string, value: any): ReferenceResult<T> | null {
        const record = this.records.find(r => 
            r.type === type && 
            r.source && 
            r.source[key] !== undefined &&
            (typeof value === 'string' && typeof r.source[key] === 'string'
                ? r.source[key].toLowerCase() === value.toLowerCase()
                : r.source[key] === value)
        );
        
        // --- DEBUG: Log find result ---
        if(type === 'page') {
             console.log(ansiColors.yellow(`[Mapper Debug getMappingByKey] Searching for type=${type}, key=${key}, value=${value}`));
             console.log(ansiColors.yellow(`[Mapper Debug getMappingByKey] Found record: ${record ? `SourceID: ${record.source?.pageID}, TargetID: ${record.target?.pageID}` : 'null'}`));
        }
        // --- END DEBUG ---

        return record ? { 
            source: record.source, 
            target: record.target,
            sourceGUID: record.sourceGUID,
            targetGUID: record.targetGUID
        } : null;
    }

    /**
     * Get a content mapping by content ID
     * @param contentId - The content ID to look up
     * @returns The source and target content items, or null if not found
     */
    getContentMappingById<T>(contentId: number | string): ReferenceResult<T> | null {
        const record = this.records.find(r => 
            r.type === 'content' 
            && r.source.contentID === contentId
        );

        return record ? { 
            source: record.source, 
            target: record.target,
            sourceGUID: record.sourceGUID,
            targetGUID: record.targetGUID
        } : null;
    }

    /**
     * Get all records of a specific type
     */
    getRecordsByType(type: ReferenceRecord['type']): ReferenceResult<any>[] {
        return this.records
            .filter(r => r.type === type)
            .map(r => ({ source: r.source, target: r.target, sourceGUID: r.sourceGUID, targetGUID: r.targetGUID }));
    }

    /**
     * Clear all records and optionally delete mapping files
     */
    clear(deleteFiles: boolean = false): void {
        this.records = [];
        
        if (deleteFiles) {
            // Delete mapping files from disk
            const types: ReferenceRecord['type'][] = [
                'model', 'container', 'content', 'asset', 'gallery', 
                'template', 'page', 'url', 'container-name'
            ];
            types.forEach(type => {
                const filePath = this.getMappingFilePath(type);
                fs.unlink(filePath).catch(() => { /* ignore if file doesn't exist */ });
            });
            console.log(ansiColors.yellow('Mappings cleared from memory and disk.'));
        } else {
            console.log(ansiColors.yellow('Mappings cleared from memory only.'));
        }
    }

    /**
     * Clear stale/duplicate mappings and rebuild clean state
     * This removes duplicates and incomplete mappings from persistent storage
     */
    async clearAndRebuild(): Promise<void> {
        console.log(ansiColors.yellow('[Mapper] Clearing and rebuilding mappings to remove duplicates...'));
        
        // Group records by type and ID to remove duplicates
        const deduplicatedRecords: ReferenceRecord[] = [];
        const seenKeys = new Set<string>();
        
        for (const record of this.records) {
            let uniqueKey: string;
            
            // Create unique keys based on record type
            switch (record.type) {
                case 'model':
                    uniqueKey = `${record.type}-${record.source.id}`;
                    break;
                case 'container':
                    uniqueKey = `${record.type}-${record.source.contentViewID}`;
                    break;
                case 'content':
                    uniqueKey = `${record.type}-${record.source.contentID}`;
                    break;
                case 'asset':
                    uniqueKey = `${record.type}-${record.source.originUrl}`;
                    break;
                case 'page':
                    uniqueKey = `${record.type}-${record.source.pageID}`;
                    break;
                case 'template':
                    uniqueKey = `${record.type}-${record.source.pageTemplateName}`;
                    break;
                case 'url':
                    uniqueKey = `${record.type}-${record.source.url}`;
                    break;
                case 'container-name':
                    uniqueKey = `${record.type}-${record.source.originalName}`;
                    break;
                default:
                    uniqueKey = `${record.type}-${JSON.stringify(record.source)}`;
            }
            
            if (!seenKeys.has(uniqueKey)) {
                // Prefer records with targets over those without
                const existingRecord = deduplicatedRecords.find(r => {
                    switch (record.type) {
                        case 'model':
                            return r.type === record.type && r.source.id === record.source.id;
                        case 'container':
                            return r.type === record.type && r.source.contentViewID === record.source.contentViewID;
                        case 'content':
                            return r.type === record.type && r.source.contentID === record.source.contentID;
                        case 'asset':
                            return r.type === record.type && r.source.originUrl === record.source.originUrl;
                        case 'page':
                            return r.type === record.type && r.source.pageID === record.source.pageID;
                        case 'template':
                            return r.type === record.type && r.source.pageTemplateName === record.source.pageTemplateName;
                        case 'url':
                            return r.type === record.type && r.source.url === record.source.url;
                        case 'container-name':
                            return r.type === record.type && r.source.originalName === record.source.originalName;
                        default:
                            return false;
                    }
                });
                
                if (existingRecord) {
                    // Replace if this record has a target and the existing one doesn't
                    if (record.target && !existingRecord.target) {
                        const index = deduplicatedRecords.indexOf(existingRecord);
                        deduplicatedRecords[index] = record;
                    }
                } else {
                    deduplicatedRecords.push(record);
                    seenKeys.add(uniqueKey);
                }
            }
        }
        
        // Update records and save
        this.records = deduplicatedRecords;
        
        // Save each type to clean files
        const types: ReferenceRecord['type'][] = [
            'model', 'container', 'content', 'asset', 'gallery', 
            'template', 'page', 'url', 'container-name'
        ];
        
        for (const type of types) {
            await this.saveMappingsByType(type);
        }
        
        console.log(ansiColors.green(`[Mapper] Rebuilt mappings: ${deduplicatedRecords.length} total records`));
    }

    /**
     * Add a URL mapping between source and target URLs
     * @param sourceUrl - The source URL
     * @param targetUrl - The target URL
     */
    addUrlMapping(sourceUrl: string, targetUrl: string): void {
        this.addRecord('url', { url: sourceUrl }, { url: targetUrl });
    }

    /**
     * Get the target URL for a source URL
     * @param sourceUrl - The source URL to look up
     * @returns The target URL or null if not found
     */
    getTargetUrl(sourceUrl: string): string | null {
        const mapping = this.getMapping<{ url: string }>('url', 'url', sourceUrl);
        return mapping?.target?.url || null;
    }

    /**
     * Check if an asset exists in the target instance by URL.
     * @param sourceMediaObject - The source asset media object.
     * @param apiClient - The API client to use.
     * @param guid - The target instance GUID.
     * @param defaultAssetContainerOriginUrl - The origin URL of the default asset container in the target instance.
     * @returns The existing asset if found, null if not found.
     */
    public async checkExistingAsset(
        sourceMediaObject: mgmtApi.Media, // Assuming mgmtApi.Media is the correct type
        apiClient: mgmtApi.ApiClient, 
        guid: string, 
        defaultAssetContainerOriginUrl: string,
    ): Promise<mgmtApi.Media | null> { 
        
        // 1. Check the local cache first using the sourceMediaObject's originUrl
        const cachedMapping = this.getMapping<mgmtApi.Media>('asset', 'originUrl', sourceMediaObject.originUrl);
        if (cachedMapping?.target) {
            // Verify that the cached asset has the same filename as what we're looking for
            const sourceFileName = sourceMediaObject.fileName || sourceMediaObject.originUrl?.split('/').pop()?.split('?')[0];
            const cachedFileName = cachedMapping.target.fileName || cachedMapping.target.originUrl?.split('/').pop()?.split('?')[0];
            
            if (sourceFileName && cachedFileName && sourceFileName === cachedFileName) {
                return cachedMapping.target;
            } else {
                console.log(`[Mapper] Cached asset filename mismatch: looking for '${sourceFileName}' but cached has '${cachedFileName}' - bypassing cache`);
                // Don't return cached result, continue to API lookup
            }
        }

        // 2. If not in cache, construct the target URL and query the Agility API
        const relativeAssetPath = getAssetFilePath(sourceMediaObject.originUrl);
        if (!relativeAssetPath || relativeAssetPath.startsWith('error-') || relativeAssetPath === 'unknown-asset') {
            console.warn(`[Mapper Warn checkExistingAsset] Could not determine valid relative path for asset: ${sourceMediaObject.originUrl}`);
            return null;
        }

        // Ensure no double slashes when joining
        const cleanDefaultUrl = defaultAssetContainerOriginUrl.endsWith('/') 
            ? defaultAssetContainerOriginUrl.slice(0, -1) 
            : defaultAssetContainerOriginUrl;
        const cleanRelativePath = relativeAssetPath.startsWith('/') 
            ? relativeAssetPath.slice(1) 
            : relativeAssetPath;

        const targetUrlToCheck = `${cleanDefaultUrl}/${cleanRelativePath}`;

        try {
            // Attempt with the constructed URL (assuming it might need to be unencoded or specifically encoded by SDK)
            let assetDetail = await apiClient.assetMethods.getAssetByUrl(targetUrlToCheck, guid);
            
            if (assetDetail && assetDetail.mediaID > 0) {
                // Verify that the returned asset has the same filename as what we're looking for
                const sourceFileName = sourceMediaObject.fileName || sourceMediaObject.originUrl?.split('/').pop()?.split('?')[0];
                const targetFileName = assetDetail.fileName || assetDetail.originUrl?.split('/').pop()?.split('?')[0];
                
                if (sourceFileName && targetFileName && sourceFileName === targetFileName) {
                    this.addRecord('asset', sourceMediaObject, assetDetail); 
                    return assetDetail;
                } else {
                    console.log(`[Mapper] Asset filename mismatch: looking for '${sourceFileName}' but found '${targetFileName}' - treating as not found`);
                    return null; // Filename doesn't match, treat as not found
                }
            }

            // Fallback: try with basic encodeURIComponent on the full path if not found
            // This is a common pattern if spaces or special characters are in filenames/paths.
            // However, getAssetByUrl ideally handles encoding correctly or expects a certain format.
            // Only try this if the first attempt fails and returns null (not an error that would be caught).
            if (!assetDetail) {
                const encodedTargetUrlToCheck = encodeURIComponent(targetUrlToCheck);
                 try {
                    assetDetail = await apiClient.assetMethods.getAssetByUrl(encodedTargetUrlToCheck, guid);
                    if (assetDetail && assetDetail.mediaID > 0) {
                        // Verify filename match for encoded URL as well
                        const sourceFileName = sourceMediaObject.fileName || sourceMediaObject.originUrl?.split('/').pop()?.split('?')[0];
                        const targetFileName = assetDetail.fileName || assetDetail.originUrl?.split('/').pop()?.split('?')[0];
                        
                        if (sourceFileName && targetFileName && sourceFileName === targetFileName) {
                            this.addRecord('asset', sourceMediaObject, assetDetail); 
                            return assetDetail;
                        } else {
                            console.log(`[Mapper] Asset filename mismatch (encoded): looking for '${sourceFileName}' but found '${targetFileName}' - treating as not found`);
                            return null;
                        }
                    }
                 } catch (error:any) {
                    // If encoded also errors (e.g. 404), that is fine, means not found.
                     if (!(error.response && error.response.status === 404)) {
                         // Log other errors if not 404
                         // console.error(`[Mapper Error checkExistingAsset] API error (encoded URL) for ${encodedTargetUrlToCheck}: ${error.message}`);
                     }
                 }
            }
            
            return null; // If all attempts fail to find it

        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                return null; // Asset not found
            }
            // console.error(`[Mapper Error checkExistingAsset] API error for ${targetUrlToCheck}: ${error.message}`);
            return null; // For other errors, also treat as not found for simplicity here
        }
    }

    /**
     * Process a content item's fields to update any URLs, fetching missing assets if needed
     * @param contentItem - The content item to process
     * @param apiClient - The API client to use for fetching
     * @param guid - The instance GUID
     * @param defaultAssetContainerOriginUrl - The origin URL of the default asset container in the target instance.
     * @returns The processed content item with updated URLs
     */
    async processContentItemUrls(
        contentItem: any, 
        apiClient: mgmtApi.ApiClient, // Ensure this is mgmtApi.ApiClient
        guid: string,
        defaultAssetContainerOriginUrl: string,
    ): Promise<any> {
        const totalFields = Object.keys(contentItem.fields).length;
        let processedUrls = 0;
        let foundUrls = 0;
        
        // Process fields
        for (const [fieldName, fieldValue] of Object.entries(contentItem.fields)) {
            if (fieldValue && typeof fieldValue === 'object') { // Ensure fieldValue is not null
                const processUrlField = async (item: any, basePath: string | null = null) => {
                    if (item && typeof item === 'object' && 'url' in item) {
                        const sourceUrl = item.url as string;
                        if (!sourceUrl) return; // Skip if URL is empty

                        processedUrls++;
                        let targetUrl = this.getTargetUrl(sourceUrl);

                        if (!targetUrl) {
                            // Check general asset mappings first
                            const assetRecords = this.getRecordsByType('asset');
                            const assetMapping = assetRecords.find(record =>
                                record.source.originUrl === sourceUrl ||
                                record.target?.originUrl === sourceUrl
                            );

                            if (assetMapping?.target?.originUrl) {
                                targetUrl = assetMapping.target.originUrl;
                                this.addUrlMapping(sourceUrl, targetUrl);
                                foundUrls++;
                            } else {
                                // If not in any mappings, try to find it in the target instance via API
                                // First, try to find by filename in existing asset mappings
                                const sourceFileName = sourceUrl.split('/').pop()?.split('?')[0];
                                if (sourceFileName) {
                                    const assetRecords = this.getRecordsByType('asset');
                                    const fileNameMapping = assetRecords.find(record => {
                                        const sourceAssetFileName = record.source.fileName || record.source.originUrl?.split('/').pop()?.split('?')[0];
                                        const targetAssetFileName = record.target?.fileName || record.target?.originUrl?.split('/').pop()?.split('?')[0];
                                        
                                        // Check if source filename matches what we're looking for
                                        if (sourceAssetFileName === sourceFileName) {
                                            return true;
                                        }
                                        
                                        // Also check if target filename contains the source filename (for cases like powerball.png -> copy-of-907powerball.png)
                                        if (targetAssetFileName && targetAssetFileName.includes(sourceFileName.replace('.png', '').replace('.jpg', '').replace('.jpeg', ''))) {
                                            return true;
                                        }
                                        
                                        return false;
                                    });
                                    
                                    if (fileNameMapping?.target?.originUrl) {
                                        targetUrl = fileNameMapping.target.originUrl;
                                        this.addUrlMapping(sourceUrl, targetUrl);
                                        foundUrls++;
                                        console.log(`[Mapper] Found asset by filename mapping: ${sourceFileName} -> ${fileNameMapping.target.fileName} (${targetUrl})`);
                                    }
                                }
                                
                                // If still not found, check if this is a MediaGroupings URL that needs gallery ID translation
                                let potentialTargetUrl: string | null = null;
                                
                                if (!targetUrl) {
                                    // Check if URL contains MediaGroupings/{id}/ pattern
                                    const mediaGroupingsMatch = sourceUrl.match(/\/MediaGroupings\/(\d+)\//);
                                    if (mediaGroupingsMatch) {
                                        const sourceGalleryId = parseInt(mediaGroupingsMatch[1]);
                                        const fileName = sourceUrl.split('/').pop();
                                        
                                        // Find the gallery mapping by source ID
                                        const galleryRecords = this.getRecordsByType('gallery');
                                        const galleryMapping = galleryRecords.find(record => 
                                            record.source.mediaGroupingID === sourceGalleryId
                                        );
                                        
                                        if (galleryMapping?.target?.mediaGroupingID && fileName) {
                                            const targetGalleryId = galleryMapping.target.mediaGroupingID;
                                            const cleanDefaultUrl = defaultAssetContainerOriginUrl.endsWith('/')
                                                ? defaultAssetContainerOriginUrl.slice(0, -1)
                                                : defaultAssetContainerOriginUrl;
                                            potentialTargetUrl = `${cleanDefaultUrl}/MediaGroupings/${targetGalleryId}/${fileName}`;
                                        }
                                    }
                                }
                                
                                // If not a MediaGroupings URL or no gallery mapping found, use enhanced path logic
                                if (!potentialTargetUrl) {
                                    const potentialUrls = this.generatePotentialAssetUrls(sourceUrl, defaultAssetContainerOriginUrl);
                                    
                                    // Try each potential URL until we find one that works
                                    for (const testUrl of potentialUrls) {
                                        try {
                                            const targetAsset = await apiClient.assetMethods.getAssetByUrl(testUrl, guid);
                                            if (targetAsset && targetAsset.originUrl) {
                                                targetUrl = targetAsset.originUrl;
                                                this.addUrlMapping(sourceUrl, targetUrl);
                                                foundUrls++;
                                                break; // Found it, stop trying other URLs
                                            }
                                        } catch (error: any) {
                                            if (!(error.response && error.response.status === 404)) {
                                                // Log non-404 errors
                                                console.warn(`[Mapper] API error checking asset URL ${testUrl}: ${error.message}`);
                                            }
                                            // Continue to next potential URL
                                            continue;
                                        }
                                    }
                                    
                                    // If we didn't find it via the multiple URL approach, fall back to original logic
                                    if (!targetUrl) {
                                        const relativeAssetPath = getAssetFilePath(sourceUrl);
                                        if (relativeAssetPath && !relativeAssetPath.startsWith('error-') && relativeAssetPath !== 'unknown-asset') {
                                            const cleanDefaultUrl = defaultAssetContainerOriginUrl.endsWith('/')
                                                ? defaultAssetContainerOriginUrl.slice(0, -1)
                                                : defaultAssetContainerOriginUrl;
                                            const cleanRelativePath = relativeAssetPath.startsWith('/')
                                                ? relativeAssetPath.slice(1)
                                                : relativeAssetPath;
                                            potentialTargetUrl = `${cleanDefaultUrl}/${cleanRelativePath}`;
                                        }
                                    }
                                }

                                if (potentialTargetUrl) {
                                    try {
                                        const targetAsset = await apiClient.assetMethods.getAssetByUrl(potentialTargetUrl, guid);
                                        if (targetAsset && targetAsset.originUrl) {
                                            targetUrl = targetAsset.originUrl;
                                            this.addUrlMapping(sourceUrl, targetUrl);
                                            foundUrls++;
                                        } else {
                                            // Try encoded URL as a fallback
                                            const encodedPotentialTargetUrl = encodeURIComponent(potentialTargetUrl);
                                            try {
                                                const targetAssetEncoded = await apiClient.assetMethods.getAssetByUrl(encodedPotentialTargetUrl, guid);
                                                if (targetAssetEncoded && targetAssetEncoded.originUrl) {
                                                    targetUrl = targetAssetEncoded.originUrl;
                                                    this.addUrlMapping(sourceUrl, targetUrl);
                                                    foundUrls++;
                                                }
                                            } catch (e) {
                                                // Asset not found
                                            }
                                        }
                                    } catch (error: any) {
                                         if (!(error.response && error.response.status === 404)) {
                                            console.warn(`[Mapper] API error checking asset URL ${potentialTargetUrl}: ${error.message}`);
                                         }
                                    }
                                } else {
                                    console.warn(`[Mapper] Could not find asset in target instance (possibly deleted from source history): ${sourceUrl}`);
                                }
                            }
                        } else {
                            foundUrls++;
                        }

                        if (targetUrl) {
                            // Update the URL field with the mapped target URL
                            if (basePath && Array.isArray(contentItem.fields[basePath])) {
                                const index = contentItem.fields[basePath].indexOf(item);
                                if (index !== -1) {
                                    contentItem.fields[basePath][index].url = targetUrl;
                                }
                            } else if (basePath === null) { // Direct object under fields
                                (contentItem.fields[fieldName] as any).url = targetUrl;
                            }
                        } else {
                            // Asset not found - remove the URL field rather than failing the entire content item
                            // This handles cases where content history references deleted assets
                            console.warn(`[Mapper] ⚠ Removing unmappable asset URL from content item (likely deleted from source): ${sourceUrl}`);
                            if (basePath && Array.isArray(contentItem.fields[basePath])) {
                                const index = contentItem.fields[basePath].indexOf(item);
                                if (index !== -1) {
                                    // Remove the url property from the item
                                    delete contentItem.fields[basePath][index].url;
                                }
                            } else if (basePath === null) { // Direct object under fields
                                // Remove the url property from the field object
                                delete (contentItem.fields[fieldName] as any).url;
                            }
                        }
                    }
                };

                if (Array.isArray(fieldValue)) {
                    for (let i = 0; i < fieldValue.length; i++) {
                        const item = fieldValue[i];
                        await processUrlField(item, fieldName);
                    }
                } else { // Single object
                    await processUrlField(fieldValue);
                }
            }
        }
        
        if (processedUrls > 0) {
            const skippedUrls = processedUrls - foundUrls;
            if (skippedUrls > 0) {
                console.log(ansiColors.yellow(`[Mapper] Processed ${processedUrls} URLs (${foundUrls} mapped, ${skippedUrls} removed due to missing assets) for ${contentItem.properties?.referenceName || 'Unknown'}`));
            } else {
                console.log(ansiColors.gray(`[Mapper] Processed ${processedUrls} URLs (${foundUrls} mapped) for ${contentItem.properties?.referenceName || 'Unknown'}`));
            }
        }
        
        return contentItem;
    }

    /**
     * Validate URLs in a content item against our asset mappings
     * @param contentItem - The content item to validate
     * @returns An array of missing URLs
     */
    validateContentItemUrls(contentItem: any): string[] {
        const missingUrls: string[] = [];
        
        // Process fields
        for (const [fieldName, fieldValue] of Object.entries(contentItem.fields)) {
            if (typeof fieldValue === 'object') {
                if (Array.isArray(fieldValue)) {
                    for (let i = 0; i < fieldValue.length; i++) {
                        const item = fieldValue[i];
                        if (item && typeof item === 'object' && 'url' in item) {
                            const url = item.url as string;
                            if (url && !this.getTargetUrl(url)) {
                                missingUrls.push(url);
                            }
                        }
                    }
                } else if (fieldValue && typeof fieldValue === 'object' && 'url' in fieldValue) {
                    const url = fieldValue.url as string;
                    if (url && !this.getTargetUrl(url)) {
                        missingUrls.push(url);
                    }
                }
            }
        }
        
        return missingUrls;
    }

    /**
     * Generate multiple potential asset URLs to try when mapping a source URL to target
     * @param sourceUrl - The source URL to map
     * @param defaultAssetContainerOriginUrl - The target instance's default asset container URL
     * @returns Array of potential target URLs to try
     */
    private generatePotentialAssetUrls(sourceUrl: string, defaultAssetContainerOriginUrl: string): string[] {
        const potentialUrls: string[] = [];
        const cleanDefaultUrl = defaultAssetContainerOriginUrl.endsWith('/')
            ? defaultAssetContainerOriginUrl.slice(0, -1)
            : defaultAssetContainerOriginUrl;
        
        // Extract filename from source URL
        const fileName = sourceUrl.split('/').pop()?.split('?')[0];
        if (!fileName) return potentialUrls;
        
        // Try direct filename in root
        potentialUrls.push(`${cleanDefaultUrl}/${fileName}`);
        
        // Extract path components from source URL for folder-based matching
        let urlPath = '';
        try {
            const url = new URL(sourceUrl);
            urlPath = url.pathname;
        } catch {
            // If not a full URL, try to extract path from relative URL
            if (sourceUrl.startsWith('/')) {
                urlPath = sourceUrl.split('?')[0];
            }
        }
        
        if (urlPath) {
            // Extract folder path from URL (everything except the filename)
            const pathParts = urlPath.split('/').filter(part => part.length > 0);
            if (pathParts.length > 1) {
                const folderPath = pathParts.slice(0, -1).join('/');
                const lastFileName = pathParts[pathParts.length - 1];
                
                // Try with the original folder structure
                potentialUrls.push(`${cleanDefaultUrl}/${folderPath}/${lastFileName}`);
                
                // Try with just the last folder (common pattern: /instance/folder/file.jpg -> /folder/file.jpg)
                if (pathParts.length > 2) {
                    const lastFolder = pathParts[pathParts.length - 2];
                    potentialUrls.push(`${cleanDefaultUrl}/${lastFolder}/${lastFileName}`);
                }
                
                // For common folder names, try variations
                const commonFolderMappings: { [key: string]: string[] } = {
                    'logos': ['logos', 'logo', 'branding'],
                    'hero-bg': ['hero-bg', 'hero', 'banners', 'backgrounds'],
                    'Attachments': ['Attachments', 'attachments', ''],
                    'NewItems': ['NewItems', 'new-items', 'new', '']
                };
                
                // Apply folder mappings
                for (const [originalFolder, variations] of Object.entries(commonFolderMappings)) {
                    if (folderPath.includes(originalFolder)) {
                        for (const variation of variations) {
                            if (variation === '') {
                                // Try without the folder
                                potentialUrls.push(`${cleanDefaultUrl}/${lastFileName}`);
                            } else {
                                // Try with folder variation
                                const newPath = folderPath.replace(originalFolder, variation);
                                potentialUrls.push(`${cleanDefaultUrl}/${newPath}/${lastFileName}`);
                            }
                        }
                    }
                }
            }
        }
        
        // Remove duplicates and return
        return Array.from(new Set(potentialUrls));
    }

    /**
     * Get all URL mappings
     * @returns Array of source and target URL mappings
     */
    getAllUrlMappings(): { source: string; target: string }[] {
        return this.getRecordsByType('url')
            .map(mapping => ({
                source: mapping.source.url,
                target: mapping.target.url
            }));
    }
} 