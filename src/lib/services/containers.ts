import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';
import ansiColors from 'ansi-colors';
import path from 'path';


export class containers {
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;
    _rootPath: string;
    _legacyFolders: boolean;
    private _progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

    constructor(
        options: mgmtApi.Options,
        multibar: cliProgress.MultiBar,
        rootPath: string, 
        legacyFolders: boolean,
        progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
        ){
        this._options = options;
        this._multibar = multibar;
        this._rootPath = rootPath;
        this._legacyFolders = legacyFolders;
        this._progressCallback = progressCallback;
    }

    async getContainers(guid: string, locale: string, isPreview: boolean = true){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let successfullyDownloadedCount = 0;
        let totalContainers = 0;

        try{
            console.log('🔍 Using model-based container discovery (getContainerList misses containers)...');
            
            // FIXED: Use model-based discovery instead of broken getContainerList
            const containersList = await this.discoverContainersFromModels(apiClient, guid);
            totalContainers = containersList.length;
            console.log(`📦 Model-based discovery found ${totalContainers} containers (vs ${await this.getContainerListCount(apiClient, guid)} from getContainerList)`);
            
            if (this._progressCallback) {
                this._progressCallback(0, totalContainers, 'progress');
            } else if (totalContainers > 0 && this._multibar && !this._legacyFolders) {
            } 
    
            let fileExport = new fileOperations(this._rootPath, guid, locale, isPreview);
            let containersDestPath: string;

            if (this._legacyFolders) {
                // Legacy mode: exportFiles constructs path like agility-files/guid/locale/mode/containers from relative parts
                // No specific containersDestPath needed here as exportFiles builds it.
            } else {
                // Non-legacy mode: this._rootPath is already agility-files/guid/locale/mode
                // containersDestPath is this._rootPath joined with 'containers'
                containersDestPath = path.join(this._rootPath, 'containers');
                // fs.mkdirSync in exportFiles will handle creating containersDestPath if it doesn't exist.
                // No need for: if (!this._legacyFolders) fileExport.createFolder(containersDestPath); 
            }

            for(let i = 0; i < containersList.length; i++){
                try {
                    // Use the already-retrieved container details instead of making redundant API calls
                    const containerDetails = containersList[i];
                    let referenceName = containerDetails.referenceName || "";
                    
                    // Clean only truly problematic characters for filenames, keep dashes, dots, etc.
                    referenceName = referenceName.replace(/[<>:"/\\|?*]/g, "").trim();
                    
                    // Fallback to containerID if referenceName is empty/invalid after cleaning
                    if (!referenceName) {
                        referenceName = `Container_${containerDetails.contentViewID}`;
                        console.log(`   🔧 Using fallback name for container with no/invalid name: ${referenceName}`);
                    }
                    
                    if (this._legacyFolders) {
                        fileExport.exportFiles(`${guid}/${locale}/${isPreview ? "preview":"live"}/containers`, referenceName, containerDetails, this._rootPath);
                    } else {
                        // In non-legacy, containersDestPath is already set correctly above.
                        fileExport.exportFiles("", referenceName, containerDetails, containersDestPath!);
                    }
                    console.log('✓ Downloaded container', ansiColors.cyan(referenceName));
                    successfullyDownloadedCount++;
                } catch (error: any) {
                    console.error(ansiColors.red(`✗ Error processing container ${containersList[i]?.contentViewID || containersList[i]?.referenceName || 'unknown'}: ${error.message}`));
                }
                
                if (this._progressCallback) {
                    this._progressCallback(successfullyDownloadedCount, totalContainers, 'progress');
                } 
            }

            const errorCount = totalContainers - successfullyDownloadedCount;
            const summaryMessage = `Downloaded ${successfullyDownloadedCount} containers (${successfullyDownloadedCount}/${totalContainers} containers, ${errorCount} errors)`;
            
            if (this._progressCallback) {
                this._progressCallback(successfullyDownloadedCount, totalContainers, errorCount === 0 ? 'success' : 'error');
                if (errorCount > 0) console.log(ansiColors.yellow(summaryMessage));
                else console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }
            
        } catch (mainError: any) {
            console.error(ansiColors.red(`An error occurred during container processing: ${mainError.message}`));
            const errorCount = totalContainers - successfullyDownloadedCount; 
            const summaryMessage = `Downloaded ${successfullyDownloadedCount} containers (${successfullyDownloadedCount}/${totalContainers} containers, ${errorCount} errors)`;
            if (this._progressCallback) {
                this._progressCallback(successfullyDownloadedCount, totalContainers, 'error');
                console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }
        }
       
    }

    async validateContainers(guid: string,locale: string, isPreview: boolean = true){
        try{
            let apiClient = new mgmtApi.ApiClient(this._options);
            const basePath = this._legacyFolders ? this._rootPath : path.join(this._rootPath, guid, locale, isPreview ? "preview" : "live");
            const containersReadPath = path.join(basePath, 'containers');

            let fileOperation = new fileOperations(this._rootPath, guid, locale, isPreview);
            let files = fileOperation.readDirectory(this._legacyFolders ? `${guid}/${locale}/${isPreview ? "preview":"live"}/containers` : containersReadPath);
    
            let containerStr: string[] = [];
            for(let i = 0; i < files.length; i++){
                let container = JSON.parse(files[i]) as mgmtApi.Container;
                let existingContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
    
                if(existingContainer.referenceName){
                    containerStr.push(existingContainer.referenceName);
                }
               
            }
            return containerStr;
        } catch{

        }
        
    }

    deleteContainerFiles(containersToDelete: string[], guid: string, locale:string, isPreview:boolean = true){
        let file = new fileOperations(this._rootPath, guid, locale, isPreview);
        const basePath = this._legacyFolders ? this._rootPath : path.join(this._rootPath, guid, locale, isPreview ? "preview" : "live");
        const containersBasePath = path.join(basePath, 'containers');

        for(let i = 0; i < containersToDelete.length; i++){
            let fileName = `${containersToDelete[i]}.json`;
            const fullPathToDelete = this._legacyFolders 
                ? `agility-files/${guid}/${locale}/${isPreview ? "preview":"live"}/containers/${fileName}` 
                : path.join(containersBasePath, fileName);
            file.deleteFile(fullPathToDelete);
        }
    }

    /**
     * Discover containers through model-based approach
     * This finds containers that getContainerList() misses
     */
    private async discoverContainersFromModels(apiClient: mgmtApi.ApiClient, guid: string): Promise<any[]> {
        const discoveredContainers = new Map<number, any>();
        
        try {
            // Get containers from standard list first
            const standardContainers = await apiClient.containerMethods.getContainerList(guid);
            console.log(`📋 Standard getContainerList found: ${standardContainers.length} containers`);
            
            // Add standard containers to discovery
            for (const container of standardContainers) {
                discoveredContainers.set(container.contentViewID, container);
            }
            
            // Discover additional containers through models
            console.log('🔍 Discovering additional containers through COMPREHENSIVE model discovery...');
            const models = await this.discoverAllModels(apiClient, guid);
            
            for (const model of models) {
                try {
                    // Get containers by model - this might find containers getContainerList missed
                    const modelContainers = await apiClient.containerMethods.getContainersByModel(model.id, guid);
                    
                    for (const container of modelContainers) {
                        if (!discoveredContainers.has(container.contentViewID)) {
                            console.log(`   ✅ Found missing container via model: ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`);
                            discoveredContainers.set(container.contentViewID, container);
                        }
                    }
                } catch (error: any) {
                    // Some models might not have containers
                    if (!error.message.includes('404')) {
                        console.warn(`⚠️  Model ${model.displayName}: ${error.message}`);
                    }
                }
            }
            
            console.log(`📦 Model-based discovery complete: ${discoveredContainers.size} containers`);
            
            // ADDITIONAL DISCOVERY: Content-based container discovery
            // This finds containers that are referenced in content but not in getContainerList or getContainersByModel
            console.log('🔍 Discovering additional containers through content references...');
            const contentBasedContainers = await this.discoverContainersFromContent(apiClient, guid);
            
            for (const container of contentBasedContainers) {
                if (!discoveredContainers.has(container.contentViewID)) {
                    console.log(`   ✅ Found missing container via content: ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`);
                    discoveredContainers.set(container.contentViewID, container);
                }
            }
            
            console.log(`📦 Total containers discovered: ${discoveredContainers.size} (${discoveredContainers.size - standardContainers.length} additional via enhanced discovery)`);
            return Array.from(discoveredContainers.values());
            
        } catch (error: any) {
            console.warn(`⚠️  Model-based discovery failed, falling back to standard list: ${error.message}`);
            // Fallback to standard approach
            return await apiClient.containerMethods.getContainerList(guid);
        }
    }
    
    /**
     * Get count from standard getContainerList for comparison
     */
    private async getContainerListCount(apiClient: mgmtApi.ApiClient, guid: string): Promise<number> {
        try {
            const containers = await apiClient.containerMethods.getContainerList(guid);
            return containers.length;
        } catch {
            return 0;
        }
    }
    
    /**
     * Discover containers by examining content references with optimized failure handling
     * This finds containers that content items reference but aren't in standard discovery
     */
    private async discoverContainersFromContent(apiClient: mgmtApi.ApiClient, guid: string): Promise<any[]> {
        const discoveredContainers: any[] = [];
        
        try {
            console.log('📋 Scanning content files for container references...');
            
            // Load content from Sync SDK list files (like our analysis does)
            const contentItems = await this.loadContentFromSyncSDK();
            
            // Extract container IDs referenced in content (already returns Set for uniqueness)
            const referencedContainerIds = this.extractContainerIdsFromContent(contentItems);
            
            console.log(`🔍 Found ${referencedContainerIds.size} unique container IDs referenced in content`);
            
            // Failure tracking to avoid re-attempting known failures
            const failureCache = {
                notFound: new Set<number>(),          // 404 - Container doesn't exist
                accessDenied: new Set<number>(),      // 403 - Permission denied  
                serverError: new Set<number>(),       // 500+ - Server issues
                otherErrors: new Set<number>()        // Other unexpected errors
            };
            
            let foundCount = 0;
            let skippedCount = 0;
            
            const containerIdArray = Array.from(referencedContainerIds);
            console.log(`🔄 Attempting to retrieve ${containerIdArray.length} unique containers...`);
            
            for (const containerId of containerIdArray) {
                try {
                    const container = await apiClient.containerMethods.getContainerByID(containerId, guid);
                    if (container) {
                        discoveredContainers.push(container);
                        foundCount++;
                        
                        // Log successful retrieval for high-value containers
                        if (foundCount <= 10 || [405, 407, 408, 409, 410].includes(containerId)) {
                            console.log(`   ✅ Found missing container via content: ContainerID:${containerId} (${container.referenceName || 'No Name'})`);
                        }
                    }
                } catch (error: any) {
                    // Categorize failures for better understanding
                    this.categorizeContainerFailure(containerId, error, failureCache);
                    skippedCount++;
                }
                
                // Progress indicator for large operations
                if ((foundCount + skippedCount) % 100 === 0) {
                    console.log(`   📊 Progress: ${foundCount + skippedCount}/${containerIdArray.length} processed (${foundCount} found, ${skippedCount} failed)`);
                }
            }
            
            // Detailed failure reporting
            this.reportContainerFailures(failureCache, containerIdArray.length);
            
            console.log(`✅ Content-based discovery: ${foundCount} containers retrieved via direct ID lookup`);
            console.log(`   📊 Success rate: ${foundCount}/${containerIdArray.length} = ${((foundCount/containerIdArray.length)*100).toFixed(1)}%`);
            
            return discoveredContainers;
            
        } catch (error: any) {
            console.warn(`⚠️  Content-based discovery failed: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Categorize container retrieval failures for analysis
     */
    private categorizeContainerFailure(containerId: number, error: any, failureCache: any): void {
        const errorMessage = error.message || '';
        const statusCode = error.response?.status || 0;
        
        if (statusCode === 404 || errorMessage.includes('Unable to retreive') || errorMessage.includes('not found')) {
            failureCache.notFound.add(containerId);
        } else if (statusCode === 403 || errorMessage.includes('access denied') || errorMessage.includes('unauthorized')) {
            failureCache.accessDenied.add(containerId);
        } else if (statusCode >= 500 || errorMessage.includes('server error') || errorMessage.includes('timeout')) {
            failureCache.serverError.add(containerId);
        } else {
            failureCache.otherErrors.add(containerId);
            // Log unexpected errors for debugging
            console.warn(`⚠️  ContainerID:${containerId}: Unexpected error - ${errorMessage}`);
        }
    }
    
    /**
     * Report detailed failure statistics
     */
    private reportContainerFailures(failureCache: any, totalAttempted: number): void {
        const totalFailures = failureCache.notFound.size + failureCache.accessDenied.size + 
                             failureCache.serverError.size + failureCache.otherErrors.size;
        
        if (totalFailures === 0) {
            console.log(`   🎉 Perfect success rate: All ${totalAttempted} containers retrieved!`);
            return;
        }
        
        console.log(`\n📊 CONTAINER RETRIEVAL FAILURE ANALYSIS:`);
        console.log(`   Total failed: ${totalFailures}/${totalAttempted} (${((totalFailures/totalAttempted)*100).toFixed(1)}%)`);
        
        if (failureCache.notFound.size > 0) {
            console.log(`   🚫 Not Found (404): ${failureCache.notFound.size} containers`);
            console.log(`      Likely deleted/archived containers still referenced in content`);
            
            // Show sample of missing containers
            const notFoundArray = Array.from(failureCache.notFound);
            const sampleMissing = notFoundArray.slice(0, 10);
            console.log(`      Sample IDs: ${sampleMissing.join(', ')}${notFoundArray.length > 10 ? '...' : ''}`);
        }
        
        if (failureCache.accessDenied.size > 0) {
            console.log(`   🔒 Access Denied (403): ${failureCache.accessDenied.size} containers`);
            console.log(`      May require different permissions or user role`);
        }
        
        if (failureCache.serverError.size > 0) {
            console.log(`   🌐 Server Errors (5xx): ${failureCache.serverError.size} containers`);
            console.log(`      Temporary issues - consider retry on next pull`);
        }
        
        if (failureCache.otherErrors.size > 0) {
            console.log(`   ❓ Other Errors: ${failureCache.otherErrors.size} containers`);
            console.log(`      Unexpected failures - check logs above for details`);
        }
        
        // Check for our critical missing containers
        const criticalMissing = [405, 407, 408, 409, 410];
        const foundCritical = criticalMissing.filter(id => 
            failureCache.notFound.has(id) || failureCache.accessDenied.has(id) || 
            failureCache.serverError.has(id) || failureCache.otherErrors.has(id)
        );
        
        if (foundCritical.length > 0) {
            console.log(`\n🎯 CRITICAL MISSING CONTAINERS STATUS:`);
            for (const id of criticalMissing) {
                let status = 'Unknown';
                if (failureCache.notFound.has(id)) status = 'Not Found (404)';
                else if (failureCache.accessDenied.has(id)) status = 'Access Denied (403)';
                else if (failureCache.serverError.has(id)) status = 'Server Error (5xx)';
                else if (failureCache.otherErrors.has(id)) status = 'Other Error';
                
                if (status !== 'Unknown') {
                    console.log(`   ContainerID:${id} - ${status}`);
                }
            }
        }
    }
    
    /**
     * Load content from Sync SDK files (similar to chain-data-loader)
     */
    private async loadContentFromSyncSDK(): Promise<any[]> {
        const fs = require('fs');
        const path = require('path');
        
        const listPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'list');
        const itemPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'item');
        
        let contentItems: any[] = [];
        
        // Load from list files
        if (fs.existsSync(listPath)) {
            const listFiles = fs.readdirSync(listPath).filter((f: string) => f.endsWith('.json'));
            for (const file of listFiles) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
                    if (Array.isArray(content)) {
                        contentItems.push(...content);
                    } else {
                        contentItems.push(content);
                    }
                } catch {
                    // Skip invalid files
                }
            }
        }
        
        // Load from item files  
        if (fs.existsSync(itemPath)) {
            const itemFiles = fs.readdirSync(itemPath).filter((f: string) => f.endsWith('.json'));
            for (const file of itemFiles) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(itemPath, file), 'utf8'));
                    contentItems.push(content);
                } catch {
                    // Skip invalid files
                }
            }
        }
        
        return contentItems;
    }
    
    /**
     * Extract container IDs from content item fields
     */
    private extractContainerIdsFromContent(contentItems: any[]): Set<number> {
        const containerIds = new Set<number>();
        
        for (const contentItem of contentItems) {
            try {
                // Parse the content item and look for container references
                this.scanObjectForContainerReferences(contentItem, '', containerIds);
            } catch {
                // Skip invalid content items
            }
        }
        
        return containerIds;
    }
    
    /**
     * Recursively scan object for container references (similar to nested-container-analyzer)
     */
    private scanObjectForContainerReferences(obj: any, path: string, containerIds: Set<number>): void {
        if (!obj || typeof obj !== 'object') return;
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Look for contentid/contentID fields that indicate container references
            if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                containerIds.add(value);
            }
            
            // Recursively scan nested objects and arrays
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        this.scanObjectForContainerReferences(item, `${currentPath}[${index}]`, containerIds);
                    });
                } else {
                    this.scanObjectForContainerReferences(value, currentPath, containerIds);
                }
            }
        }
    }
    
    /**
     * Comprehensive model discovery that goes beyond standard methods
     * This includes models that might not be found through standard getContentModules/getPageModules
     */
    private async discoverAllModels(apiClient: mgmtApi.ApiClient, guid: string): Promise<any[]> {
        const discoveredModels = new Map<number, any>();
        
        try {
            console.log('📋 Standard model discovery...');
            
            // Standard model discovery
            const contentModels = await apiClient.modelMethods.getContentModules(true, guid, false);
            const pageModels = await apiClient.modelMethods.getPageModules(true, guid);
            const standardModels = [...contentModels, ...pageModels];
            
            console.log(`   📄 Content modules: ${contentModels.length}`);
            console.log(`   📝 Page modules: ${pageModels.length}`);
            console.log(`   📊 Standard total: ${standardModels.length}`);
            
            // Add standard models
            for (const model of standardModels) {
                discoveredModels.set(model.id, model);
            }
            
            // ENHANCED: Discover models referenced in existing content
            console.log('🔍 Enhanced model discovery via content definitions...');
            const contentBasedModels = await this.discoverModelsFromContent(apiClient, guid);
            
            for (const model of contentBasedModels) {
                if (!discoveredModels.has(model.id)) {
                    console.log(`   ✅ Found additional model via content: ${model.displayName || model.referenceName || 'No Name'} (ID: ${model.id})`);
                    discoveredModels.set(model.id, model);
                }
            }
            
            console.log(`📦 Total models discovered: ${discoveredModels.size} (${discoveredModels.size - standardModels.length} additional)`);
            return Array.from(discoveredModels.values());
            
        } catch (error: any) {
            console.warn(`⚠️  Enhanced model discovery failed: ${error.message}`);
            // Fallback to standard approach
            const contentModels = await apiClient.modelMethods.getContentModules(true, guid, false);
            const pageModels = await apiClient.modelMethods.getPageModules(true, guid);
            return [...contentModels, ...pageModels];
        }
    }
    
    /**
     * Discover models by examining content definitions referenced in content
     */
    private async discoverModelsFromContent(apiClient: mgmtApi.ApiClient, guid: string): Promise<any[]> {
        const discoveredModels: any[] = [];
        
        try {
            // Load content from both list and item directories
            const contentItems = await this.loadContentFromSyncSDK();
            
            // Extract model definition IDs from content
            const referencedModelIds = this.extractModelIdsFromContent(contentItems);
            
            console.log(`🔍 Found ${referencedModelIds.size} unique model IDs referenced in content`);
            
            // Try to fetch each referenced model directly by ID
            let foundCount = 0;
            const modelIdArray = Array.from(referencedModelIds);
            for (const modelId of modelIdArray) {
                try {
                    // Try both content and page model methods
                    let model = null;
                    
                    try {
                        const contentModels = await apiClient.modelMethods.getContentModules(true, guid, false);
                        model = contentModels.find(m => m.id === modelId);
                    } catch {
                        try {
                            const pageModels = await apiClient.modelMethods.getPageModules(true, guid);
                            model = pageModels.find(m => m.id === modelId);
                        } catch {
                            // Model doesn't exist or access denied
                        }
                    }
                    
                    if (model) {
                        discoveredModels.push(model);
                        foundCount++;
                    }
                } catch (error: any) {
                    // Model doesn't exist or access denied - this is expected for some IDs
                    if (!error.message.includes('404') && !error.message.includes('Unable to retreive')) {
                        console.warn(`⚠️  ModelID:${modelId}: ${error.message}`);
                    }
                }
            }
            
            console.log(`✅ Content-based model discovery: ${foundCount} models retrieved`);
            return discoveredModels;
            
        } catch (error: any) {
            console.warn(`⚠️  Content-based model discovery failed: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Extract model definition IDs from content items
     */
    private extractModelIdsFromContent(contentItems: any[]): Set<number> {
        const modelIds = new Set<number>();
        
        for (const contentItem of contentItems) {
            try {
                // Look for contentDefinitionID/modelDefinitionID in content items
                if (contentItem.properties?.contentDefinitionID && typeof contentItem.properties.contentDefinitionID === 'number') {
                    modelIds.add(contentItem.properties.contentDefinitionID);
                }
                
                if (contentItem.contentDefinitionID && typeof contentItem.contentDefinitionID === 'number') {
                    modelIds.add(contentItem.contentDefinitionID);
                }
                
                if (contentItem.modelDefinitionID && typeof contentItem.modelDefinitionID === 'number') {
                    modelIds.add(contentItem.modelDefinitionID);
                }
                
                // Also look in nested structures
                this.scanObjectForModelReferences(contentItem, '', modelIds);
            } catch {
                // Skip invalid content items
            }
        }
        
        return modelIds;
    }
    
    /**
     * Recursively scan object for model definition references
     */
    private scanObjectForModelReferences(obj: any, path: string, modelIds: Set<number>): void {
        if (!obj || typeof obj !== 'object') return;
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Look for model definition ID fields
            if ((key === 'contentDefinitionID' || key === 'modelDefinitionID') && typeof value === 'number') {
                modelIds.add(value);
            }
            
            // Recursively scan nested objects and arrays
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        this.scanObjectForModelReferences(item, `${currentPath}[${index}]`, modelIds);
                    });
                } else {
                    this.scanObjectForModelReferences(value, currentPath, modelIds);
                }
            }
        }
    }
}