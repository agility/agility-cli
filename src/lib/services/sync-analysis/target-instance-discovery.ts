/**
 * Target Instance Discovery Service - SIMPLIFIED VERSION
 * 
 * Discovers what entities already exist in the target instance during analysis phase.
 * This enables pre-population of mappings and perfect sync planning.
 */

import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../../reference-mapper';

export interface TargetEntities {
    models: any[];
    containers: any[];
    content: any[];
    templates: any[];
    pages: any[];
    assets: any[];
    galleries: any[];
    sitemap: any[];
}

export interface SyncPlan {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    entityBreakdown: {
        [entityType: string]: {
            create: number;
            update: number;
            skip: number;
            total: number;
        };
    };
    estimatedTimeMinutes: number;
    successProbability: number;
}

export class TargetInstanceDiscovery {
    private apiClient?: mgmtApi.ApiClient;
    private targetGuid: string;
    private targetEntities?: TargetEntities;

    constructor(targetGuid: string) {
        this.targetGuid = targetGuid;
    }

    /**
     * Initialize with API client for target instance
     */
    async initialize(options: mgmtApi.Options): Promise<void> {
        if (this.targetGuid === 'test') {
            console.log(ansiColors.cyan('🧪 Test mode: Skipping target instance authentication'));
            return;
        }

        console.log(ansiColors.cyan(`🔗 Authenticating with target instance: ${this.targetGuid}`));
        this.apiClient = new mgmtApi.ApiClient(options);
        
        // Validate connection with a simple API call (try getting containers)
        try {
            await this.apiClient.containerMethods.getContainerList(this.targetGuid);
            console.log(ansiColors.green('✅ Target instance authentication successful'));
        } catch (error: any) {
            console.error(ansiColors.red(`❌ Failed to authenticate with target instance: ${error.message}`));
            throw new Error(`Target instance authentication failed: ${error.message}`);
        }
    }

    /**
     * Discover all entities in target instance
     */
    async discoverAllEntities(): Promise<TargetEntities> {
        if (this.targetGuid === 'test') {
            console.log(ansiColors.cyan('🧪 Test mode: Using empty target entities'));
            this.targetEntities = {
                models: [],
                containers: [],
                content: [],
                templates: [],
                pages: [],
                assets: [],
                galleries: [],
                sitemap: []
            };
            return this.targetEntities;
        }

        if (!this.apiClient) {
            throw new Error('API client not initialized. Call initialize() first.');
        }

        console.log(ansiColors.yellow('🔍 Discovering entities in target instance...'));

        try {
            // Discover all entity types in parallel for efficiency
            console.log(ansiColors.cyan('  🔍 Discovering models and containers...'));
            const [models, containers] = await Promise.all([
                this.discoverModels(),
                this.discoverContainers()
            ]);

            console.log(ansiColors.cyan('  🔍 Discovering templates and content...'));
            const [templates, content] = await Promise.all([
                this.discoverTemplates(),
                this.discoverContent()
            ]);

            console.log(ansiColors.cyan('  🔍 Discovering pages, assets, and galleries...'));
            const [pages, assets, galleries] = await Promise.all([
                this.discoverPages(),
                this.discoverAssets(),
                this.discoverGalleries()
            ]);

            const sitemap = await this.discoverSitemap();

            this.targetEntities = {
                models,
                containers,
                content,
                templates,
                pages,
                assets,
                galleries,
                sitemap
            };

            console.log(ansiColors.green('✅ Target instance discovery complete:'));
            console.log(ansiColors.green(`  📋 Models: ${models.length}`));
            console.log(ansiColors.green(`  📦 Containers: ${containers.length}`));
            console.log(ansiColors.green(`  📝 Content: ${content.length}`));
            console.log(ansiColors.green(`  🏗️ Templates: ${templates.length}`));
            console.log(ansiColors.green(`  📄 Pages: ${pages.length}`));
            console.log(ansiColors.green(`  📎 Assets: ${assets.length}`));
            console.log(ansiColors.green(`  🖼️ Galleries: ${galleries.length}`));

            return this.targetEntities;

        } catch (error: any) {
            console.error(ansiColors.red(`❌ Error discovering target entities: ${error.message}`));
            throw new Error(`Target entity discovery failed: ${error.message}`);
        }
    }

    /**
     * Populate ReferenceMapper with source→target mappings
     */
    populateReferenceMapper(sourceEntities: any, referenceMapper: ReferenceMapper): SyncPlan {
        if (!this.targetEntities) {
            throw new Error('Target entities not discovered. Call discoverAllEntities() first.');
        }

        console.log(ansiColors.yellow('🗺️ Building source→target mappings...'));

        const syncPlan: SyncPlan = {
            willCreate: 0,
            willUpdate: 0,
            willSkip: 0,
            entityBreakdown: {},
            estimatedTimeMinutes: 0,
            successProbability: 100.0
        };

        // Map each entity type with full multi-level mapping support
        this.mapModels(sourceEntities.models || [], this.targetEntities.models, referenceMapper, syncPlan);
        this.mapContainers(sourceEntities.containers || [], this.targetEntities.containers, referenceMapper, syncPlan);
        this.mapTemplates(sourceEntities.templates || [], this.targetEntities.templates, referenceMapper, syncPlan);
        this.mapContent(sourceEntities.content || [], this.targetEntities.content, referenceMapper, syncPlan);
        this.mapPages(sourceEntities.pages || [], this.targetEntities.pages, referenceMapper, syncPlan);
        this.mapAssets(sourceEntities.assets || [], this.targetEntities.assets, referenceMapper, syncPlan);
        this.mapGalleries(sourceEntities.galleries || [], this.targetEntities.galleries, referenceMapper, syncPlan);

        // Calculate estimates
        this.calculateSyncEstimates(syncPlan);

        console.log(ansiColors.green(`✅ Mapping complete: ${syncPlan.willSkip} skip, ${syncPlan.willUpdate} update, ${syncPlan.willCreate} create`));

        return syncPlan;
    }

    /**
     * Get discovered target entities
     */
    getTargetEntities(): TargetEntities | undefined {
        return this.targetEntities;
    }

    // Private discovery methods for each entity type (simplified)

    private async discoverModels(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            // Get both content and page models
            const contentModels = await this.apiClient.modelMethods.getContentModules(true, this.targetGuid, false);
            const pageModels = await this.apiClient.modelMethods.getPageModules(true, this.targetGuid);
            return [...(contentModels || []), ...(pageModels || [])];
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover models: ${error.message}`));
            return [];
        }
    }

    private async discoverContainers(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            return await this.apiClient.containerMethods.getContainerList(this.targetGuid);
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover containers: ${error.message}`));
            return [];
        }
    }

    private async discoverTemplates(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            return await this.apiClient.pageMethods.getPageTemplates(this.targetGuid, 'en-us', false);
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover templates: ${error.message}`));
            return [];
        }
    }

    private async discoverContent(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            // Get all containers first to know what content to look for
            const containers = await this.apiClient.containerMethods.getContainerList(this.targetGuid);
            let allContent: any[] = [];

            // Get content from each container
            for (const container of containers) {
                try {
                    const containerContent = await this.apiClient.contentMethods.getContentList(
                        container.referenceName,
                        this.targetGuid,
                        'en-us',
                        null
                    );
                    if (containerContent && Array.isArray(containerContent)) {
                        allContent = allContent.concat(containerContent);
                    }
                } catch (containerError: any) {
                    // Continue with other containers if one fails
                    console.warn(ansiColors.yellow(`⚠️ Could not get content from container ${container.referenceName}: ${containerError.message}`));
                }
            }

            return allContent;
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover content: ${error.message}`));
            return [];
        }
    }

    private async discoverPages(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            // Get sitemap which contains all pages
            const sitemap = await this.apiClient.pageMethods.getSitemap(this.targetGuid, 'en-us');
            return sitemap || [];
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover pages: ${error.message}`));
            return [];
        }
    }

    private async discoverAssets(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            // Assets may require pagination
            const pageSize = 500;
            let allAssets: any[] = [];
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const result = await this.apiClient.assetMethods.getMediaList(
                    pageSize,
                    offset,
                    this.targetGuid
                );
                
                if (result && result.assetMedias && result.assetMedias.length > 0) {
                    allAssets = allAssets.concat(result.assetMedias);
                    offset += pageSize;
                    hasMore = result.assetMedias.length === pageSize;
                } else {
                    hasMore = false;
                }

                // Safety break to prevent infinite loops
                if (offset > 10000) {
                    console.warn(ansiColors.yellow(`⚠️ Asset discovery stopped at ${offset} for safety`));
                    break;
                }
            }

            return allAssets;
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover assets: ${error.message}`));
            return [];
        }
    }

    private async discoverGalleries(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            const result = await this.apiClient.assetMethods.getGalleries(this.targetGuid, '', 100, 0);
            // The result itself might be the galleries array or contain them
            return Array.isArray(result) ? result : (result as any)?.assetGalleries || [];
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover galleries: ${error.message}`));
            return [];
        }
    }

    private async discoverSitemap(): Promise<any[]> {
        if (!this.apiClient) return [];
        
        try {
            return await this.apiClient.pageMethods.getSitemap(this.targetGuid, 'en-us');
        } catch (error: any) {
            console.warn(ansiColors.yellow(`⚠️ Could not discover sitemap: ${error.message}`));
            return [];
        }
    }

    // Private mapping methods for each entity type (simplified)

    private mapModels(sourceModels: any[], targetModels: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'models');
        
        for (const sourceModel of sourceModels) {
            const targetModel = targetModels.find((t: any) => 
                t.referenceName === sourceModel.referenceName ||
                t.displayName === sourceModel.displayName
            );

            if (targetModel) {
                // Model exists - add mapping and skip
                mapper.addMapping('model', sourceModel, targetModel);
                // Explicitly add ID mapping for multi-level relationships
                const sourceId = sourceModel.id || sourceModel.definitionID;
                const targetId = targetModel.id || targetModel.definitionID;
                if (sourceId && targetId) {
                    mapper.addIdMapping('model', sourceId, targetId);
                }
                this.incrementPlan(plan, 'models', 'skip', 'Model exists with same reference name');
            } else {
                // Model doesn't exist - will create
                mapper.addMapping('model', sourceModel, null);
                this.incrementPlan(plan, 'models', 'create', 'New model');
            }
        }
    }

    private mapContainers(sourceContainers: any[], targetContainers: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'containers');
        
        for (const sourceContainer of sourceContainers) {
            const targetContainer = targetContainers.find((t: any) => 
                t.referenceName === sourceContainer.referenceName ||
                t.name === sourceContainer.name
            );

            if (targetContainer) {
                mapper.addMapping('container', sourceContainer, targetContainer);
                // Explicitly add ID mapping for multi-level relationships
                if (sourceContainer.contentViewID && targetContainer.contentViewID) {
                    mapper.addIdMapping('container', sourceContainer.contentViewID, targetContainer.contentViewID);
                }
                this.incrementPlan(plan, 'containers', 'skip', 'Container exists');
            } else {
                mapper.addMapping('container', sourceContainer, null);
                this.incrementPlan(plan, 'containers', 'create', 'New container');
            }
        }
    }

    private mapTemplates(sourceTemplates: any[], targetTemplates: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'templates');
        
        for (const sourceTemplate of sourceTemplates) {
            const targetTemplate = targetTemplates.find((t: any) => 
                t.name === sourceTemplate.name ||
                t.pageTemplateName === sourceTemplate.pageTemplateName
            );

            if (targetTemplate) {
                mapper.addMapping('template', sourceTemplate, targetTemplate);
                // Add ID mapping for multi-level relationships
                const sourceId = sourceTemplate.id || sourceTemplate.pageTemplateID;
                const targetId = targetTemplate.id || targetTemplate.pageTemplateID;
                if (sourceId && targetId) {
                    mapper.addIdMapping('template', sourceId, targetId);
                }
                this.incrementPlan(plan, 'templates', 'skip', 'Template exists');
            } else {
                mapper.addMapping('template', sourceTemplate, null);
                this.incrementPlan(plan, 'templates', 'create', 'New template');
            }
        }
    }

    private mapContent(sourceContent: any[], targetContent: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'content');
        
        for (const sourceItem of sourceContent) {
            const targetItem = targetContent.find((t: any) => 
                t.properties?.referenceName === sourceItem.properties?.referenceName ||
                (t.contentID && sourceItem.contentID && t.contentID === sourceItem.contentID)
            );

            if (targetItem) {
                mapper.addMapping('content', sourceItem, targetItem);
                // Add ID mapping for multi-level relationships
                if (sourceItem.contentID && targetItem.contentID) {
                    mapper.addIdMapping('content', sourceItem.contentID, targetItem.contentID);
                }
                
                // Check if update needed based on modification date
                const sourceDate = new Date(sourceItem.properties?.modified || 0);
                const targetDate = new Date(targetItem.properties?.modified || 0);
                
                if (sourceDate > targetDate) {
                    this.incrementPlan(plan, 'content', 'update', 'Content modified since last sync');
                } else {
                    this.incrementPlan(plan, 'content', 'skip', 'Content up to date');
                }
            } else {
                mapper.addMapping('content', sourceItem, null);
                this.incrementPlan(plan, 'content', 'create', 'New content item');
            }
        }
    }

    private mapPages(sourcePages: any[], targetPages: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'pages');
        
        for (const sourcePage of sourcePages) {
            const targetPage = targetPages.find((t: any) => 
                t.name === sourcePage.name ||
                t.path === sourcePage.path
            );

            if (targetPage) {
                mapper.addMapping('page', sourcePage, targetPage);
                // Add ID mapping for multi-level relationships
                if (sourcePage.pageID && targetPage.pageID) {
                    mapper.addIdMapping('page', sourcePage.pageID, targetPage.pageID);
                }
                this.incrementPlan(plan, 'pages', 'skip', 'Page exists');
            } else {
                mapper.addMapping('page', sourcePage, null);
                this.incrementPlan(plan, 'pages', 'create', 'New page');
            }
        }
    }

    private mapAssets(sourceAssets: any[], targetAssets: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'assets');
        
        for (const sourceAsset of sourceAssets) {
            const targetAsset = targetAssets.find((t: any) => 
                t.fileName === sourceAsset.fileName ||
                t.originUrl === sourceAsset.originUrl
            );

            if (targetAsset) {
                mapper.addMapping('asset', sourceAsset, targetAsset);
                // Add ID mapping for multi-level relationships
                if (sourceAsset.mediaID && targetAsset.mediaID) {
                    mapper.addIdMapping('asset', sourceAsset.mediaID, targetAsset.mediaID);
                }
                this.incrementPlan(plan, 'assets', 'skip', 'Asset exists');
            } else {
                mapper.addMapping('asset', sourceAsset, null);
                this.incrementPlan(plan, 'assets', 'create', 'New asset');
            }
        }
    }

    private mapGalleries(sourceGalleries: any[], targetGalleries: any[], mapper: ReferenceMapper, plan: SyncPlan): void {
        this.initEntityBreakdown(plan, 'galleries');
        
        for (const sourceGallery of sourceGalleries) {
            const targetGallery = targetGalleries.find((t: any) => 
                t.name === sourceGallery.name ||
                t.galleryName === sourceGallery.galleryName
            );

            if (targetGallery) {
                mapper.addMapping('gallery', sourceGallery, targetGallery);
                // Add ID mapping for multi-level relationships
                if (sourceGallery.galleryID && targetGallery.galleryID) {
                    mapper.addIdMapping('gallery', sourceGallery.galleryID, targetGallery.galleryID);
                }
                this.incrementPlan(plan, 'galleries', 'skip', 'Gallery exists');
            } else {
                mapper.addMapping('gallery', sourceGallery, null);
                this.incrementPlan(plan, 'galleries', 'create', 'New gallery');
            }
        }
    }

    // Private utility methods

    private initEntityBreakdown(plan: SyncPlan, entityType: string): void {
        if (!plan.entityBreakdown[entityType]) {
            plan.entityBreakdown[entityType] = {
                create: 0,
                update: 0,
                skip: 0,
                total: 0
            };
        }
    }

    private incrementPlan(plan: SyncPlan, entityType: string, action: 'create' | 'update' | 'skip', reason: string): void {
        plan.entityBreakdown[entityType][action]++;
        plan.entityBreakdown[entityType].total++;
        
        if (action === 'create') plan.willCreate++;
        else if (action === 'update') plan.willUpdate++;
        else if (action === 'skip') plan.willSkip++;
    }

    private calculateSyncEstimates(plan: SyncPlan): void {
        // Estimate time based on operation counts
        const createTime = plan.willCreate * 0.5; // 30 seconds per create
        const updateTime = plan.willUpdate * 0.2; // 12 seconds per update
        const skipTime = plan.willSkip * 0.01;    // 0.6 seconds per skip
        
        plan.estimatedTimeMinutes = createTime + updateTime + skipTime;
        
        // Calculate success probability based on entity complexity
        const totalOperations = plan.willCreate + plan.willUpdate;
        if (totalOperations === 0) {
            plan.successProbability = 100.0;
        } else {
            // Higher complexity (more creates) = slightly lower probability
            const complexity = plan.willCreate / totalOperations;
            plan.successProbability = Math.max(95.0, 99.5 - (complexity * 4.5));
        }
    }
} 