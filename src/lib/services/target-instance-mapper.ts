import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../reference-mapper';

export interface TargetMappingResult {
    mappingsFound: number;
    newEntitiesNeeded: number;
    entityBreakdown: Record<string, { existing: number; new: number }>;
}

/**
 * Target Instance Mapper
 * 
 * Discovers existing entities on the target instance and creates mappings
 * to avoid duplicate creation during sync operations.
 * 
 * NOTE: This is a foundational implementation that needs SDK method research
 */
export class TargetInstanceMapper {
    private apiClient: mgmtApi.ApiClient;
    private targetGuid: string;
    private referenceMapper: ReferenceMapper;
    private sourceData?: any;

    constructor(apiClient: mgmtApi.ApiClient, targetGuid: string, referenceMapper: ReferenceMapper) {
        this.apiClient = apiClient;
        this.targetGuid = targetGuid;
        this.referenceMapper = referenceMapper;
    }

    /**
     * Main discovery method - checks target instance for existing entities
     * and creates mappings for found matches
     */
    async discoverAndMapExistingEntities(sourceData: any): Promise<TargetMappingResult> {
        console.log(ansiColors.cyan('\n🔍 Checking target instance for existing data...'));
        
        // Store source data for asset reference analysis
        this.sourceData = sourceData;
        
        const result: TargetMappingResult = {
            mappingsFound: 0,
            newEntitiesNeeded: 0,
            entityBreakdown: {}
        };

        try {
            // Discover entities in dependency order using REAL SDK methods
            if (sourceData.models) {
                await this.discoverModels(sourceData.models, result);
            }

            if (sourceData.galleries) {
                await this.discoverGalleries(sourceData.galleries, result);
            }

            if (sourceData.assets) {
                await this.discoverAssets(sourceData.assets, result);
            }

            if (sourceData.containers) {
                await this.discoverContainers(sourceData.containers, result);
            }

            if (sourceData.content) {
                await this.discoverContent(sourceData.content, result);
            }

            if (sourceData.templates) {
                await this.discoverTemplates(sourceData.templates, result);
            }

            if (sourceData.pages) {
                await this.discoverPages(sourceData.pages, result);
            }

            this.printDiscoveryResults(result);
            return result;

        } catch (error) {
            console.error(ansiColors.red(`❌ Error during target instance discovery: ${error.message}`));
            throw error;
        }
    }

    /**
     * Discover existing models on target by referenceName
     * Uses: modelMethods.getContentModules() and modelMethods.getPageModules()
     */
    private async discoverModels(sourceModels: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📋 Checking models...'));
        
        try {
            // Use REAL SDK methods verified in codebase - third parameter must be false
            const contentModels = await this.apiClient.modelMethods.getContentModules(true, this.targetGuid, false);
            const pageModels = await this.apiClient.modelMethods.getPageModules(true, this.targetGuid);
            const targetModels = [...contentModels, ...pageModels];
            
            console.log(ansiColors.blue(`    🔍 API Success: Found ${contentModels.length} content modules + ${pageModels.length} page modules = ${targetModels.length} total on target`));
            
            let existing = 0;
            const missingModels: string[] = [];

            for (const sourceModel of sourceModels) {
                // Use case-insensitive comparison for reference names to handle "Changelog" vs "ChangeLog"
                const targetModel = targetModels.find(tm => 
                    tm.referenceName.toLowerCase() === sourceModel.referenceName.toLowerCase()
                );
                
                if (targetModel) {
                    this.referenceMapper.addMapping('model', sourceModel, targetModel);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('model', sourceModel, null);
                    missingModels.push(sourceModel.referenceName);
                }
            }

            result.entityBreakdown['Models'] = { existing, new: sourceModels.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourceModels.length - existing;
            
            console.log(ansiColors.green(`    ✅ Models: ${existing} existing of ${sourceModels.length} needed`));
            if (missingModels.length > 0) {
                console.log(ansiColors.yellow(`    📝 Missing models: ${missingModels.join(', ')}`));
            }
            
        } catch (error: any) {
            console.log(ansiColors.red(`    ❌ Models API Error Details:`));
            console.log(ansiColors.red(`       Message: ${error.message}`));
            console.log(ansiColors.red(`       Status: ${error.status || error.response?.status || 'unknown'}`));
            console.log(ansiColors.red(`       Response: ${JSON.stringify(error.response?.data || error.data || 'none', null, 2)}`));
            console.log(ansiColors.red(`       Full Error: ${JSON.stringify(error, null, 2)}`));
            console.log(ansiColors.gray(`    📝 Treating as no existing models (API throws when empty)`));
            
            // API throws error when no models exist - treat as normal behavior
            result.entityBreakdown['Models'] = { existing: 0, new: sourceModels.length };
            result.newEntitiesNeeded += sourceModels.length;
            
            // Add unmapped entries for all models
            const allMissingModels: string[] = [];
            for (const model of sourceModels) {
                this.referenceMapper.addMapping('model', model, null);
                allMissingModels.push(model.referenceName);
            }
            
            console.log(ansiColors.green(`    ✅ Models: 0 existing of ${sourceModels.length} needed`));
            console.log(ansiColors.yellow(`    📝 Missing models: ${allMissingModels.join(', ')}`));
        }
    }

    /**
     * Discover existing galleries on target by name
     * Uses: assetMethods.getGalleries()
     */
    private async discoverGalleries(sourceGalleries: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  🖼️  Checking galleries...'));
        
        try {
            // Use REAL SDK method verified in codebase - returns galleries directly
            const galleryResponse = await this.apiClient.assetMethods.getGalleries(this.targetGuid, '', 100, 0) as any;
            const targetGalleries = Array.isArray(galleryResponse) ? galleryResponse : (galleryResponse.galleries || []);
            let existing = 0;

            for (const sourceGallery of sourceGalleries) {
                const targetGallery = targetGalleries.find((tg: any) => tg.name === sourceGallery.name);
                
                if (targetGallery) {
                    this.referenceMapper.addMapping('gallery', sourceGallery, targetGallery);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('gallery', sourceGallery, null);
                }
            }

            result.entityBreakdown['Galleries'] = { existing, new: sourceGalleries.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourceGalleries.length - existing;
            
            console.log(ansiColors.green(`    ✅ Galleries: ${existing} existing of ${sourceGalleries.length} needed`));
            
        } catch (error: any) {
            console.log(ansiColors.red(`    ❌ Galleries API Error Details:`));
            console.log(ansiColors.red(`       Message: ${error.message}`));
            console.log(ansiColors.red(`       Status: ${error.status || error.response?.status || 'unknown'}`));
            console.log(ansiColors.gray(`    📝 Treating as no existing galleries (API throws when empty)`));
            
            // API throws error when no galleries exist - treat as normal behavior
            result.entityBreakdown['Galleries'] = { existing: 0, new: sourceGalleries.length };
            result.newEntitiesNeeded += sourceGalleries.length;
            
            // Add unmapped entries for all galleries
            for (const gallery of sourceGalleries) {
                this.referenceMapper.addMapping('gallery', gallery, null);
            }
        }
    }

    /**
     * Discover existing assets on target by URL or filename
     * Uses: assetMethods.getMediaList()
     */
    private async discoverAssets(sourceAssets: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📁 Checking assets...'));
        
        try {
            // Get all assets from target with proper pagination (API limit is 250)
            let allTargetAssets: any[] = [];
            let skip = 0;
            const take = 250; // API limit is 250, not 1000
            let hasMore = true;
            
            while (hasMore) {
                const mediaResult = await this.apiClient.assetMethods.getMediaList(take, skip, this.targetGuid);
                const batchAssets = mediaResult.assetMedias || [];
                allTargetAssets.push(...batchAssets);
                
                hasMore = batchAssets.length === take; // Continue if we got a full batch
                skip += take;
                
                // Safety limit to prevent infinite loops
                if (skip > 10000) break;
            }
            
            console.log(ansiColors.blue(`    🔍 Found ${allTargetAssets.length} assets on target instance`));
            
            let existing = 0;
            const missingAssets: string[] = [];
            
            // Track folder dependencies from source assets
            const requiredFolders = new Set<string>();

            for (const sourceAsset of sourceAssets) {
                // Extract folder path from originKey for dependency tracking
                if (sourceAsset.originKey && sourceAsset.originKey.includes('/')) {
                    const folderPath = sourceAsset.originKey.substring(0, sourceAsset.originKey.lastIndexOf('/'));
                    requiredFolders.add(folderPath);
                }

                // Try multiple matching strategies for better asset discovery
                const targetAsset = allTargetAssets.find((ta: any) => {
                    // 1. Primary: Match by filename (most reliable)
                    if (ta.fileName === sourceAsset.fileName) return true;
                    
                    // 2. Secondary: Match by any URL property (handle all URL variations)
                    if (sourceAsset.originUrl && (
                        ta.url === sourceAsset.originUrl ||
                        ta.originUrl === sourceAsset.originUrl ||
                        ta.edgeUrl === sourceAsset.originUrl
                    )) return true;
                    
                    // 3. Tertiary: Match by url property variations
                    if (sourceAsset.url && (
                        ta.url === sourceAsset.url ||
                        ta.originUrl === sourceAsset.url ||
                        ta.edgeUrl === sourceAsset.url
                    )) return true;
                    
                    return false;
                });
                
                if (targetAsset) {
                    this.referenceMapper.addMapping('asset', sourceAsset, targetAsset);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('asset', sourceAsset, null);
                    
                    // Enhanced asset identification for problematic assets
                    const assetId = this.getAssetDisplayName(sourceAsset);
                    missingAssets.push(assetId);
                }
            }

            result.entityBreakdown['Assets'] = { existing, new: sourceAssets.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourceAssets.length - existing;
            
            console.log(ansiColors.green(`    ✅ Assets: ${existing} existing of ${sourceAssets.length} needed`));
            
            // Enhanced missing assets breakdown
            if (missingAssets.length > 0) {
                this.reportMissingAssetsBreakdown(missingAssets, sourceAssets);
            }
            
        } catch (error: any) {
            console.log(ansiColors.red(`    ❌ Assets API Error - Full Debug:`));
            console.log(ansiColors.red(`       Message: ${error.message}`));
            console.log(ansiColors.red(`       Status: ${error.status || error.response?.status || 'unknown'}`));
            console.log(ansiColors.red(`       Error Type: ${error.constructor.name}`));
            
            // Dump full error object for debugging
            if (error.response) {
                console.log(ansiColors.red(`       Response Status: ${error.response.status}`));
                console.log(ansiColors.red(`       Response Status Text: ${error.response.statusText}`));
                console.log(ansiColors.red(`       Response Headers: ${JSON.stringify(error.response.headers, null, 2)}`));
                console.log(ansiColors.red(`       Response Data: ${JSON.stringify(error.response.data, null, 2)}`));
            }
            
            // Check if it's really an empty collection or a different error
            if (error.stack) {
                console.log(ansiColors.red(`       Stack Trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`));
            }
            
            console.log(ansiColors.gray(`    📝 API call: getMediaList(250, 0, '${this.targetGuid}')`));
            console.log(ansiColors.gray(`    📝 Treating as no existing assets (API throws when empty)`));
            
            // API throws error when no assets exist - treat as normal behavior
            result.entityBreakdown['Assets'] = { existing: 0, new: sourceAssets.length };
            result.newEntitiesNeeded += sourceAssets.length;
            
            // Still track folder dependencies and missing assets even if API fails
            const requiredFolders = new Set<string>();
            const allMissingAssets: string[] = [];
            for (const asset of sourceAssets) {
                this.referenceMapper.addMapping('asset', asset, null);
                
                // Enhanced asset identification for problematic assets
                const assetId = this.getAssetDisplayName(asset);
                allMissingAssets.push(assetId);
                
                if (asset.originKey && asset.originKey.includes('/')) {
                    const folderPath = asset.originKey.substring(0, asset.originKey.lastIndexOf('/'));
                    requiredFolders.add(folderPath);
                }
            }
            
            console.log(ansiColors.green(`    ✅ Assets: 0 existing of ${sourceAssets.length} needed`));
            
            // Enhanced missing assets breakdown
            if (allMissingAssets.length > 0) {
                this.reportMissingAssetsBreakdown(allMissingAssets, sourceAssets);
            }
        }
    }

    /**
     * Discover existing containers on target by referenceName
     * Uses: containerMethods.getContainerList()
     */
    private async discoverContainers(sourceContainers: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📦 Checking containers...'));
        
        try {
            // Use REAL SDK method verified in codebase
            const targetContainers = await this.apiClient.containerMethods.getContainerList(this.targetGuid);
            let existing = 0;
            const missingContainers: string[] = [];

            for (const sourceContainer of sourceContainers) {
                // Use case-insensitive comparison for reference names
                const targetContainer = targetContainers.find((tc: any) => 
                    tc.referenceName.toLowerCase() === sourceContainer.referenceName.toLowerCase()
                );
                
                if (targetContainer) {
                    this.referenceMapper.addMapping('container', sourceContainer, targetContainer);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('container', sourceContainer, null);
                    missingContainers.push(sourceContainer.referenceName);
                }
            }

            result.entityBreakdown['Containers'] = { existing, new: sourceContainers.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourceContainers.length - existing;
            
            console.log(ansiColors.green(`    ✅ Containers: ${existing} existing of ${sourceContainers.length} needed`));
            
            // Enhanced missing containers breakdown with dependency analysis
            if (missingContainers.length > 0) {
                this.reportMissingContainersBreakdown(missingContainers, sourceContainers);
            }
            
        } catch (error: any) {
            console.log(ansiColors.red(`    ❌ Containers API Error Details:`));
            console.log(ansiColors.red(`       Message: ${error.message}`));
            console.log(ansiColors.red(`       Status: ${error.status || error.response?.status || 'unknown'}`));
            console.log(ansiColors.gray(`    📝 Treating as no existing containers (API throws when empty)`));
            
            // API throws error when no containers exist - treat as normal behavior
            result.entityBreakdown['Containers'] = { existing: 0, new: sourceContainers.length };
            result.newEntitiesNeeded += sourceContainers.length;
            
            // Add unmapped entries for all containers
            const allMissingContainers: string[] = [];
            for (const container of sourceContainers) {
                this.referenceMapper.addMapping('container', container, null);
                allMissingContainers.push(container.referenceName);
            }
            
            console.log(ansiColors.green(`    ✅ Containers: 0 existing of ${sourceContainers.length} needed`));
            
            // Enhanced missing containers breakdown with dependency analysis
            if (allMissingContainers.length > 0) {
                this.reportMissingContainersBreakdown(allMissingContainers, sourceContainers);
            }
        }
    }

    /**
     * Get display name for asset with better handling of problematic assets
     */
    private getAssetDisplayName(asset: any): string {
        const fileName = asset.fileName;
        const mediaID = asset.mediaID;
        
        // Check for problematic asset patterns
        if (!fileName || fileName.length === 0) {
            return `MediaID:${mediaID || 'Unknown'} (No filename)`;
        }
        
        // Check for corrupted/encoded filenames
        if (this.isProblematicAssetName(fileName)) {
            const truncated = fileName.length > 50 
                ? fileName.substring(0, 47) + '...' 
                : fileName;
            return `MediaID:${mediaID || 'Unknown'} (${truncated})`;
        }
        
        // Normal filename
        return fileName;
    }
    
    /**
     * Detect problematic asset names (base64, special chars, excessive length)
     */
    private isProblematicAssetName(fileName: string): boolean {
        if (!fileName) return true;
        
        // Check for base64-like patterns (common in corrupted assets)
        const base64Pattern = /^[A-Za-z0-9+/=]{50,}$/;
        if (base64Pattern.test(fileName)) return true;
        
        // Check for excessive length (likely corrupted)
        if (fileName.length > 200) return true;
        
        // Check for multiple consecutive special characters
        if (/[^a-zA-Z0-9._-]{5,}/.test(fileName)) return true;
        
        // Check for URL encoding issues
        if (fileName.includes('%') && fileName.length > 100) return true;
        
        return false;
    }

    /**
     * Get all asset URLs that are referenced in content fields
     */
    private getReferencedAssetUrls(sourceAssets: any[]): Set<string> {
        const referencedUrls = new Set<string>();
        
        if (!this.sourceData) return referencedUrls;
        
        // Scan all content items for asset references
        if (this.sourceData.content) {
            this.sourceData.content.forEach((content: any) => {
                this.scanForAssetReferences(content.fields, referencedUrls);
            });
        }
        
        // Also scan page content (zones/modules)
        if (this.sourceData.pages) {
            this.sourceData.pages.forEach((page: any) => {
                if (page.zones) {
                    this.scanForAssetReferences(page.zones, referencedUrls);
                }
            });
        }
        
        return referencedUrls;
    }

    /**
     * Recursively scan object fields for asset URL references
     */
    private scanForAssetReferences(obj: any, referencedUrls: Set<string>, path: string = ''): void {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                this.scanForAssetReferences(item, referencedUrls, `${path}[${index}]`);
            });
            return;
        }
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (typeof value === 'string') {
                // Check if this string contains an Agility CDN URL
                if (value.includes('cdn.aglty.io') || value.includes('cdn.aglty.com')) {
                    referencedUrls.add(value);
                }
            } else if (typeof value === 'object' && value !== null) {
                // Check for common asset field structures
                const typedValue = value as any;
                if (typedValue.url && typeof typedValue.url === 'string' && typedValue.url.includes('cdn.aglty.io')) {
                    referencedUrls.add(typedValue.url);
                }
                
                // Recursively scan nested objects
                this.scanForAssetReferences(value, referencedUrls, currentPath);
            }
        }
    }

    /**
     * Check if an asset is referenced by checking its URLs against referenced URLs
     */
    private isAssetReferenced(asset: any, referencedUrls: Set<string>): boolean {
        // Check all possible URL formats
        if (asset.originUrl && referencedUrls.has(asset.originUrl)) return true;
        if (asset.url && referencedUrls.has(asset.url)) return true;
        if (asset.edgeUrl && referencedUrls.has(asset.edgeUrl)) return true;
        
        return false;
    }

    /**
     * Get all container IDs that are referenced in page chains and content
     */
    private getReferencedContainerIds(): Set<number> {
        const referencedIds = new Set<number>();
        
        if (!this.sourceData) return referencedIds;
        
        // Scan pages for container references in zones/modules
        if (this.sourceData.pages) {
            this.sourceData.pages.forEach((page: any) => {
                if (page.zones) {
                    this.scanForContainerReferences(page.zones, referencedIds);
                }
            });
        }
        
        // Scan content items for container references (nested containers, linked content)
        if (this.sourceData.content) {
            this.sourceData.content.forEach((content: any) => {
                if (content.fields) {
                    this.scanForContainerReferences(content.fields, referencedIds);
                }
            });
        }
        
        return referencedIds;
    }

    /**
     * Recursively scan object fields for container ID references
     */
    private scanForContainerReferences(obj: any, referencedIds: Set<number>): void {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach((item) => {
                this.scanForContainerReferences(item, referencedIds);
            });
            return;
        }
        
        for (const [key, value] of Object.entries(obj)) {
            // Check for container ID fields
            if ((key === 'containerID' || key === 'contentDefinitionID') && typeof value === 'number') {
                referencedIds.add(value);
            }
            
            // Check for module/zone structures that contain containers
            if (typeof value === 'object' && value !== null) {
                const typedValue = value as any;
                if (typedValue.containerID && typeof typedValue.containerID === 'number') {
                    referencedIds.add(typedValue.containerID);
                }
                if (typedValue.contentDefinitionID && typeof typedValue.contentDefinitionID === 'number') {
                    referencedIds.add(typedValue.contentDefinitionID);
                }
                
                // Recursively scan nested objects
                this.scanForContainerReferences(value, referencedIds);
            }
        }
    }

    /**
     * Check if a container is referenced by checking its ID against referenced IDs
     */
    private isContainerReferenced(container: any, referencedIds: Set<number>): boolean {
        return referencedIds.has(container.containerID);
    }

    /**
     * Report detailed breakdown of missing containers with categorization and dependency analysis
     */
    private reportMissingContainersBreakdown(missingContainers: string[], sourceContainers: any[]): void {
        // Get containers that are referenced in page chains and content
        const referencedContainerIds = this.getReferencedContainerIds();
        
        // Categorize missing containers by dependency status
        const criticalContainers: Array<{referenceName: string, container: any}> = [];
        const skippableContainers: Array<{referenceName: string, container: any}> = [];
        
        sourceContainers.forEach(container => {
            if (missingContainers.includes(container.referenceName)) {
                const isReferenced = this.isContainerReferenced(container, referencedContainerIds);
                
                const containerInfo = {referenceName: container.referenceName, container};
                
                if (isReferenced) {
                    criticalContainers.push(containerInfo);
                } else {
                    skippableContainers.push(containerInfo);
                }
            }
        });
        
        console.log(ansiColors.yellow(`    📝 Missing containers: ${missingContainers.length} total`));
        
        // Show critical missing containers (referenced in pages/content)
        if (criticalContainers.length > 0) {
            console.log(ansiColors.red(`       Critical containers (referenced in pages/content):`));
            criticalContainers.forEach(({referenceName, container}) => {
                const containerID = container.contentViewID ? `ContainerID:${container.contentViewID}` : 'No ID';
                console.log(ansiColors.red(`       - ${containerID} (${referenceName})`));
            });
        }
        
        // Show skippable missing containers (not referenced anywhere)
        if (skippableContainers.length > 0) {
            console.log(ansiColors.gray(`       Safe to skip (not referenced in pages/content):`));
            skippableContainers.forEach(({referenceName, container}) => {
                const containerID = container.contentViewID ? `ContainerID:${container.contentViewID}` : 'No ID';
                console.log(ansiColors.gray(`       - ${containerID} (${referenceName})`));
            });
        }
        
        // Summary of critical vs skippable
        if (criticalContainers.length === 0) {
            console.log(ansiColors.green(`    ✅ No critical containers missing - all missing containers are safe to skip!`));
        } else {
            console.log(ansiColors.yellow(`    ⚠️  ${criticalContainers.length} critical containers missing, ${skippableContainers.length} safe to skip`));
        }
    }

    /**
     * Report detailed breakdown of missing assets with categorization and dependency analysis
     */
    private reportMissingAssetsBreakdown(missingAssets: string[], sourceAssets: any[]): void {
        // Get assets that are referenced in dependency chains
        const referencedAssetUrls = this.getReferencedAssetUrls(sourceAssets);
        
        // Categorize missing assets with their source asset details and dependency status
        const criticalAssets: Array<{displayName: string, asset: any, isProblematic: boolean}> = [];
        const skippableAssets: Array<{displayName: string, asset: any, isProblematic: boolean}> = [];
        
        sourceAssets.forEach(asset => {
            const displayName = this.getAssetDisplayName(asset);
            if (missingAssets.includes(displayName)) {
                const isProblematic = this.isProblematicAssetName(asset.fileName);
                const isReferenced = this.isAssetReferenced(asset, referencedAssetUrls);
                
                const assetInfo = {displayName, asset, isProblematic};
                
                if (isReferenced) {
                    criticalAssets.push(assetInfo);
                } else {
                    skippableAssets.push(assetInfo);
                }
            }
        });
        
        console.log(ansiColors.yellow(`    📝 Missing assets: ${missingAssets.length} total`));
        
        // Show critical missing assets (referenced in content/chains)
        if (criticalAssets.length > 0) {
            console.log(ansiColors.red(`       Critical assets (referenced in content):`));
            criticalAssets.forEach(({displayName, asset, isProblematic}) => {
                const mediaID = asset.mediaID ? `MediaID:${asset.mediaID}` : 'No ID';
                const problemFlag = isProblematic ? ' [PROBLEMATIC]' : '';
                const color = isProblematic ? ansiColors.red : ansiColors.yellow;
                console.log(color(`       - ${mediaID} (${displayName})${problemFlag}`));
            });
        }
        
        // Show skippable missing assets (not referenced anywhere)
        if (skippableAssets.length > 0) {
            console.log(ansiColors.gray(`       Safe to skip (not referenced in content):`));
            skippableAssets.forEach(({displayName, asset, isProblematic}) => {
                const mediaID = asset.mediaID ? `MediaID:${asset.mediaID}` : 'No ID';
                const problemFlag = isProblematic ? ' [PROBLEMATIC]' : '';
                console.log(ansiColors.gray(`       - ${mediaID} (${displayName})${problemFlag}`));
            });
        }
        
        // Summary of critical vs skippable
        if (criticalAssets.length === 0) {
            console.log(ansiColors.green(`    ✅ No critical assets missing - all missing assets are safe to skip!`));
        } else {
            console.log(ansiColors.yellow(`    ⚠️  ${criticalAssets.length} critical assets missing, ${skippableAssets.length} safe to skip`));
        }
    }

    /**
     * Discover existing content on target (complex - skip for now)
     * Content discovery is complex because we'd need to check each container
     */
    private async discoverContent(sourceContent: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📄 Checking content (skipped - complex)...'));
        
        // Content discovery is complex and would require checking each container
        // For now, mark all as new and let pushers handle duplicate detection
        const newCount = sourceContent.length;
        
        result.entityBreakdown['Content'] = { existing: 0, new: newCount };
        result.newEntitiesNeeded += newCount;
        
        // Add unmapped entries for all content
        for (const content of sourceContent) {
            this.referenceMapper.addMapping('content', content, null);
        }
    }

    /**
     * Discover existing templates on target by name
     * Uses: pageMethods.getPageTemplates()
     */
    private async discoverTemplates(sourceTemplates: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📋 Checking templates...'));
        
        try {
            // Use REAL SDK method verified in codebase
            const targetTemplates = await this.apiClient.pageMethods.getPageTemplates(this.targetGuid, 'en-us', false);
            let existing = 0;
            const missingTemplates: string[] = [];

            for (const sourceTemplate of sourceTemplates) {
                const targetTemplate = targetTemplates.find((tt: any) => tt.name === sourceTemplate.name);
                
                if (targetTemplate) {
                    this.referenceMapper.addMapping('template', sourceTemplate, targetTemplate);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('template', sourceTemplate, null);
                    missingTemplates.push(sourceTemplate.name);
                }
            }

            result.entityBreakdown['Templates'] = { existing, new: sourceTemplates.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourceTemplates.length - existing;
            
            console.log(ansiColors.green(`    ✅ Templates: ${existing} existing of ${sourceTemplates.length} needed`));
            if (missingTemplates.length > 0) {
                console.log(ansiColors.yellow(`    📝 Missing templates: ${missingTemplates.join(', ')}`));
            }
            
        } catch (error: any) {
            console.log(ansiColors.gray(`    ℹ️  Templates API response: ${error.message}`));
            console.log(ansiColors.gray(`    📝 Treating as no existing templates (API throws when empty)`));
            
            // API throws error when no templates exist - treat as normal behavior
            result.entityBreakdown['Templates'] = { existing: 0, new: sourceTemplates.length };
            result.newEntitiesNeeded += sourceTemplates.length;
            
            // Add unmapped entries for all templates
            const allMissingTemplates: string[] = [];
            for (const template of sourceTemplates) {
                this.referenceMapper.addMapping('template', template, null);
                allMissingTemplates.push(template.name);
            }
            
            console.log(ansiColors.green(`    ✅ Templates: 0 existing of ${sourceTemplates.length} needed`));
            console.log(ansiColors.yellow(`    📝 Missing templates: ${allMissingTemplates.join(', ')}`));
        }
    }

    /**
     * Discover existing pages on target by name/path
     * Uses: pageMethods.getSitemap()
     */
    private async discoverPages(sourcePages: any[], result: TargetMappingResult): Promise<void> {
        console.log(ansiColors.cyan('  📄 Checking pages...'));
        
        try {
            // Use REAL SDK method verified in codebase
            const sitemap = await this.apiClient.pageMethods.getSitemap(this.targetGuid, 'en-us');
            const targetPages = this.flattenSitemap(sitemap);
            let existing = 0;

            for (const sourcePage of sourcePages) {
                const targetPage = targetPages.find((tp: any) => tp.name === sourcePage.name);
                
                if (targetPage) {
                    this.referenceMapper.addMapping('page', sourcePage, targetPage);
                    existing++;
                } else {
                    this.referenceMapper.addMapping('page', sourcePage, null);
                }
            }

            result.entityBreakdown['Pages'] = { existing, new: sourcePages.length - existing };
            result.mappingsFound += existing;
            result.newEntitiesNeeded += sourcePages.length - existing;
            
            console.log(ansiColors.green(`    ✅ Pages: ${existing} existing of ${sourcePages.length} needed`));
            
        } catch (error: any) {
            console.log(ansiColors.gray(`    ℹ️  Pages API response: ${error.message}`));
            console.log(ansiColors.gray(`    📝 Treating as no existing pages (API throws when empty)`));
            
            // API throws error when no pages exist - treat as normal behavior
            result.entityBreakdown['Pages'] = { existing: 0, new: sourcePages.length };
            result.newEntitiesNeeded += sourcePages.length;
            
            // Add unmapped entries for all pages
            for (const page of sourcePages) {
                this.referenceMapper.addMapping('page', page, null);
            }
        }
    }

    /**
     * Helper to flatten sitemap into page array
     */
    private flattenSitemap(sitemap: any): any[] {
        const pages: any[] = [];
        
        const flatten = (items: any[]) => {
            for (const item of items) {
                pages.push(item);
                if (item.children && item.children.length > 0) {
                    flatten(item.children);
                }
            }
        };
        
        if (sitemap && sitemap.length > 0) {
            flatten(sitemap);
        }
        
        return pages;
    }

    /**
     * Print discovery results summary
     */
    private printDiscoveryResults(result: TargetMappingResult): void {
        console.log(ansiColors.green('\n✅ Target Instance Discovery Complete'));
        
        if (result.mappingsFound > 0) {
            console.log(ansiColors.green(`🎯 Found ${result.mappingsFound} existing entities that can be mapped:`));
            
            for (const [entityType, counts] of Object.entries(result.entityBreakdown)) {
                if (counts.existing > 0) {
                    console.log(ansiColors.cyan(`    ${entityType}: ${counts.existing} existing, ${counts.new} new`));
                }
            }
            
            console.log(ansiColors.blue(`\n📊 Summary: ${result.mappingsFound} entities can reuse existing targets, ${result.newEntitiesNeeded} need to be created`));
        } else {
            console.log(ansiColors.yellow('📋 No existing entities found - all entities will be created fresh'));
            
            const totalEntities = Object.values(result.entityBreakdown).reduce((sum, counts) => sum + counts.new, 0);
            console.log(ansiColors.gray(`   📊 Total entities to create: ${totalEntities}`));
            
            // Show breakdown of what would be created
            const entityCounts = Object.entries(result.entityBreakdown)
                .filter(([_, counts]) => counts.new > 0)
                .map(([type, counts]) => `${counts.new} ${type}`)
                .join(', ');
            
            if (entityCounts) {
                console.log(ansiColors.gray(`   📋 Breakdown: ${entityCounts}`));
            }
        }
    }
} 