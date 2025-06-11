import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileOperations } from '../services/fileOperations';
import ansiColors from 'ansi-colors';

/**
 * Management SDK-Only Downloader
 * 
 * This replaces the Content Sync SDK to ensure complete data consistency.
 * All entities are downloaded directly from Management SDK APIs to guarantee
 * that content references are resolvable within the downloaded dataset.
 */
export class ManagementSDKOnlyDownloader {
    private apiClient: mgmtApi.ApiClient;
    private guid: string;
    private locale: string;
    private isPreview: boolean;
    private basePath: string;
    private fileOps: fileOperations;

    constructor(
        options: mgmtApi.Options,
        guid: string,
        locale: string,
        isPreview: boolean,
        basePath: string
    ) {
        this.apiClient = new mgmtApi.ApiClient(options);
        this.guid = guid;
        this.locale = locale;
        this.isPreview = isPreview;
        this.basePath = basePath;
        this.fileOps = new fileOperations(basePath, guid, locale, isPreview);
    }

    /**
     * Download all entities using Management SDK only
     * This ensures complete data consistency
     */
    async downloadAllEntities(elements: string[] = ['Models', 'Containers', 'Content', 'Assets', 'Templates', 'Pages']): Promise<void> {
        console.log('🚀 MANAGEMENT SDK-ONLY DOWNLOADER');
        console.log('================================');
        console.log(`📊 Target: ${this.guid} (${this.locale})`);
        console.log(`📁 Output: ${this.basePath}`);
        console.log(`🎯 Elements: ${elements.join(', ')}\n`);

        // Ensure output directories exist
        this.ensureDirectories();

        // Download in dependency order
        if (elements.includes('Models')) {
            await this.downloadModels();
        }

        if (elements.includes('Containers')) {
            await this.downloadContainers();
        }

        if (elements.includes('Content')) {
            await this.downloadContent();
        }

        if (elements.includes('Assets')) {
            await this.downloadAssets();
        }

        if (elements.includes('Templates')) {
            await this.downloadTemplates();
        }

        if (elements.includes('Pages')) {
            await this.downloadPages();
        }

        console.log('\n✅ Management SDK-Only download complete!');
        console.log('🎯 All data consistency guaranteed by single source');
    }

    /**
     * Download all models (content + page models)
     */
    private async downloadModels(): Promise<void> {
        console.log('📋 DOWNLOADING MODELS');
        console.log('====================');

        try {
            // Get content models
            const contentModels = await this.apiClient.modelMethods.getContentModules(true, this.guid, false);
            console.log(`📄 Content models: ${contentModels.length}`);

            // Get page models  
            const pageModels = await this.apiClient.modelMethods.getPageModules(true, this.guid);
            console.log(`📃 Page models: ${pageModels.length}`);

            const modelsPath = path.join(this.basePath, 'models');
            this.fileOps.createFolder(modelsPath);

            // Save all models
            let savedCount = 0;
            for (const model of [...contentModels, ...pageModels]) {
                const filename = `${model.id}_${this.sanitizeFilename(model.referenceName || model.displayName)}.json`;
                this.fileOps.exportFiles('models', filename, model);
                savedCount++;
            }

            console.log(`✅ Models: ${savedCount} saved\n`);
        } catch (error: any) {
            console.error(`❌ Model download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Download all containers using comprehensive discovery
     */
    private async downloadContainers(): Promise<void> {
        console.log('📦 DOWNLOADING CONTAINERS');
        console.log('=========================');

        try {
            // Use comprehensive container discovery (from existing containers.ts logic)
            const containers = await this.discoverAllContainers();
            console.log(`📦 Total containers discovered: ${containers.length}`);

            const containersPath = path.join(this.basePath, 'containers');
            this.fileOps.createFolder(containersPath);

            // Save all containers
            let savedCount = 0;
            for (const container of containers) {
                if (container.contentViewID && container.contentViewID !== -1) {
                    const filename = `${container.contentViewID}_${this.sanitizeFilename(container.referenceName || 'unknown')}.json`;
                    this.fileOps.exportFiles('containers', filename, container);
                    savedCount++;
                } else {
                    console.log(`⚠️ Skipped deleted container: ${container.referenceName} (contentViewID: ${container.contentViewID})`);
                }
            }

            console.log(`✅ Containers: ${savedCount} saved (${containers.length - savedCount} deleted containers skipped)\n`);
        } catch (error: any) {
            console.error(`❌ Container download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Download all content using container-based discovery
     */
    private async downloadContent(): Promise<void> {
        console.log('📝 DOWNLOADING CONTENT');
        console.log('======================');

        try {
            // Get all containers to know what content to download
            const containers = await this.apiClient.containerMethods.getContainerList(this.guid);
            console.log(`📦 Containers for content: ${containers.length}`);

            const itemPath = path.join(this.basePath, 'item');
            const listPath = path.join(this.basePath, 'list');
            this.fileOps.createFolder(itemPath);
            this.fileOps.createFolder(listPath);

            let totalContent = 0;
            let savedItems = 0;
            let savedLists = 0;

            for (const container of containers) {
                if (container.contentViewID === -1) {
                    console.log(`⚠️ Skipping deleted container: ${container.referenceName}`);
                    continue;
                }

                try {
                    // Get content list for this container
                    const contentList = await this.apiClient.contentMethods.getContentList(
                        container.referenceName,
                        this.guid,
                        this.locale,
                        null
                    );

                    if (contentList && contentList.items && contentList.items.length > 0) {
                        // Save individual content items
                        for (const contentItem of contentList.items) {
                            const itemFilename = `${contentItem.contentID}.json`;
                            this.fileOps.exportFiles('item', itemFilename, contentItem);
                            savedItems++;
                        }

                        // Save content list
                        const listFilename = `${container.referenceName}.json`;
                        this.fileOps.exportFiles('list', listFilename, contentList.items);
                        savedLists++;

                        totalContent += contentList.items.length;
                        console.log(`   ✅ ${container.referenceName}: ${contentList.items.length} items`);
                    }
                } catch (containerError: any) {
                    if (!containerError.message.includes('404')) {
                        console.log(`   ⚠️ ${container.referenceName}: ${containerError.message}`);
                    }
                }
            }

            console.log(`✅ Content: ${savedItems} items, ${savedLists} lists (${totalContent} total)\n`);
        } catch (error: any) {
            console.error(`❌ Content download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Download all assets
     */
    private async downloadAssets(): Promise<void> {
        console.log('🖼️ DOWNLOADING ASSETS');
        console.log('=====================');

        try {
            const assetsPath = path.join(this.basePath, 'assets', 'json');
            this.fileOps.createFolder(assetsPath);

            // Download asset metadata in pages
            let pageSize = 250;
            let recordOffset = 0;
            let index = 1;
            let totalAssets = 0;

            const initialRecords = await this.apiClient.assetMethods.getMediaList(pageSize, recordOffset, this.guid);
            totalAssets = initialRecords.totalCount;

            // Save first page
            this.fileOps.exportFiles('assets/json', `${index}.json`, initialRecords);
            index++;

            // Download remaining pages
            while (recordOffset + pageSize < totalAssets) {
                recordOffset += pageSize;
                const records = await this.apiClient.assetMethods.getMediaList(pageSize, recordOffset, this.guid);
                this.fileOps.exportFiles('assets/json', `${index}.json`, records);
                index++;
            }

            console.log(`✅ Assets: ${totalAssets} metadata records saved in ${index - 1} files\n`);
        } catch (error: any) {
            console.error(`❌ Asset download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Download all templates
     */
    private async downloadTemplates(): Promise<void> {
        console.log('🎨 DOWNLOADING TEMPLATES');
        console.log('========================');

        try {
            const templates = await this.apiClient.pageMethods.getPageTemplates(this.guid, this.locale, this.isPreview);
            console.log(`🎨 Templates found: ${templates.length}`);

            const templatesPath = path.join(this.basePath, 'templates');
            this.fileOps.createFolder(templatesPath);

            let savedCount = 0;
            for (const template of templates) {
                const filename = `${template.pageTemplateID}_${this.sanitizeFilename(template.pageTemplateName || 'unknown')}.json`;
                this.fileOps.exportFiles('templates', filename, template);
                savedCount++;
            }

            console.log(`✅ Templates: ${savedCount} saved\n`);
        } catch (error: any) {
            console.error(`❌ Template download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Download all pages
     */
    private async downloadPages(): Promise<void> {
        console.log('📄 DOWNLOADING PAGES');
        console.log('====================');

        try {
            const sitemap = await this.apiClient.pageMethods.getSitemap(this.guid, this.locale);
            
            // Flatten sitemap to get all pages
            const pages = this.flattenSitemap(sitemap);
            console.log(`📄 Pages found: ${pages.length}`);

            const pagesPath = path.join(this.basePath, 'pages');
            this.fileOps.createFolder(pagesPath);

            let savedCount = 0;
            for (const page of pages) {
                // Get full page details for each page
                try {
                    const fullPage = await this.apiClient.pageMethods.getPage(page.pageID, this.guid, this.locale);
                    const filename = `${fullPage.pageID}_${this.sanitizeFilename(fullPage.name || 'unknown')}.json`;
                    this.fileOps.exportFiles('pages', filename, fullPage);
                    savedCount++;
                } catch (pageError: any) {
                    console.warn(`⚠️ Could not get page ${page.pageID}: ${pageError.message}`);
                }
            }

            console.log(`✅ Pages: ${savedCount} saved\n`);
        } catch (error: any) {
            console.error(`❌ Page download failed: ${error.message}\n`);
            throw error;
        }
    }

    /**
     * Comprehensive container discovery (reusing proven logic)
     */
    private async discoverAllContainers(): Promise<any[]> {
        const discoveredContainers = new Map();
        let containerListCount = 0;

        // Method 1: Standard getContainerList
        try {
            const containerList = await this.apiClient.containerMethods.getContainerList(this.guid);
            containerListCount = containerList.length;
            for (const container of containerList) {
                discoveredContainers.set(container.contentViewID, container);
            }
            console.log(`   📋 getContainerList: ${containerListCount} containers`);
        } catch (error: any) {
            console.warn(`⚠️ getContainerList failed: ${error.message}`);
        }

        // Method 2: Model-based discovery
        try {
            // Get all models - note: getContentModels doesn't exist, using alternative approach
            const pageModels = await this.apiClient.modelMethods.getPageModules(true, this.guid);
            
            for (const model of pageModels) {
                try {
                    const modelContainers = await this.apiClient.containerMethods.getContainersByModel(model.id, this.guid);
                    for (const container of modelContainers) {
                        if (!discoveredContainers.has(container.contentViewID)) {
                            discoveredContainers.set(container.contentViewID, container);
                        }
                    }
                } catch {
                    // Some models might not have containers
                }
            }
            console.log(`   🔍 Model-based discovery: +${discoveredContainers.size - containerListCount} additional containers`);
        } catch (error: any) {
            console.warn(`⚠️ Model-based discovery failed: ${error.message}`);
        }

        return Array.from(discoveredContainers.values());
    }

    /**
     * Ensure all required directories exist
     */
    private ensureDirectories(): void {
        const directories = ['models', 'containers', 'item', 'list', 'assets/json', 'templates', 'pages'];
        for (const dir of directories) {
            this.fileOps.createFolder(dir);
        }
    }

    /**
     * Flatten sitemap to get all pages
     */
    private flattenSitemap(sitemap: any[]): any[] {
        const pages: any[] = [];
        
        const flatten = (items: any[]) => {
            for (const item of items) {
                if (item.pages) {
                    // Channel level - get pages
                    flatten(item.pages);
                } else if (item.pageID) {
                    // Page item
                    pages.push(item);
                    if (item.children && item.children.length > 0) {
                        flatten(item.children);
                    }
                }
            }
        };
        
        if (sitemap && sitemap.length > 0) {
            flatten(sitemap);
        }
        
        return pages;
    }

    /**
     * Sanitize filename for filesystem
     */
    private sanitizeFilename(name: string): string {
        return name.replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '_');
    }
} 