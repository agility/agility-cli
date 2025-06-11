/**
 * Upload Sequence Converter
 * 
 * Sub-task 21.9.1.2: Create chain-to-upload-sequence converter
 * 
 * Converts ChainBuilder analysis results into dependency-ordered upload sequences.
 * Transforms complex dependency chains into practical upload batches that respect 
 * inside-out dependency resolution.
 */

import ansiColors from 'ansi-colors';
import { ChainAnalysisResults, UploadSequence } from './chain-builder';

export interface DependencyOrderedBatch {
    level: number;           // Dependency depth (0 = no dependencies, 1 = depends on level 0, etc.)
    phase: string;           // Human readable phase name
    entities: BatchEntity[]; // Entities to upload in this batch
    dependencies: string[];  // What this batch depends on
    estimatedDuration: number; // Minutes to complete this batch
}

export interface BatchEntity {
    type: 'Model' | 'Template' | 'Container' | 'Content' | 'Page' | 'Asset' | 'Gallery';
    id: string | number;
    name: string;
    data: any; // The actual entity data for upload
    dependencies: string[]; // What this specific entity depends on
}

export interface SkippedEntity {
    type: 'Model' | 'Template' | 'Container' | 'Content' | 'Page' | 'Asset' | 'Gallery';
    index: number;           // Array index where this entity was found
    reason: string;          // Human-readable reason why it was skipped
    missingFields: string[]; // List of missing ID fields
    data: any;              // The original entity data for debugging
    suggestions?: string[];  // Optional suggestions for fixing the issue
}

export interface SkippedItemsReport {
    totalSkipped: number;
    byType: Map<string, SkippedEntity[]>;
    summary: string;
}

export interface OptimizedUploadSequence {
    batches: DependencyOrderedBatch[];
    metadata: {
        totalBatches: number;
        totalEntities: number;
        maxParallelism: number; // How many entities can be uploaded in parallel per batch
        estimatedTotalDuration: number;
        criticalPath: string[]; // Longest dependency chain
    };
    validation: {
        allDependenciesResolved: boolean;
        circularDependencies: string[];
        missingDependencies: string[];
    };
    skippedItems: SkippedItemsReport; // NEW: Detailed report of skipped entities
}

export class UploadSequenceConverter {
    
    /**
     * Main conversion method: Transform ChainBuilder results into upload batches
     */
    convertToUploadSequence(analysisResults: ChainAnalysisResults, sourceData: any, urlBasedAssets?: any[]): OptimizedUploadSequence {
        console.log(ansiColors.cyan('🔄 Converting chain analysis to upload sequence...'));

        // Step 1: Extract all entities and their dependencies
        const { entityMap, skippedItems } = this.buildEntityDependencyMap(analysisResults, sourceData);
        
        // Step 1.5: Add URL-based assets to entity map (NEW for Task 21.13.2.3)
        if (urlBasedAssets && urlBasedAssets.length > 0) {
            console.log(ansiColors.cyan(`🔗 Adding ${urlBasedAssets.length} URL-based assets to upload sequence...`));
            this.addUrlBasedAssetsToEntityMap(entityMap, urlBasedAssets);
        }
        
        // Step 2: Calculate dependency levels (topological sort)
        console.log(`🔧 [DEBUG] Starting dependency level calculation with ${entityMap.size} entities`);
        const dependencyLevels = this.calculateDependencyLevels(entityMap);
        
        // Debug: Check how many entities are in dependency levels
        let totalInLevels = 0;
        dependencyLevels.forEach((entities, level) => {
            console.log(`🔧 [DEBUG] Level ${level}: ${entities.length} entities`);
            totalInLevels += entities.length;
        });
        console.log(`🔧 [DEBUG] Total entities in dependency levels: ${totalInLevels}`);
        
        // Step 3: Group entities into upload batches by dependency level and type
        const batches = this.createUploadBatches(dependencyLevels, entityMap);
        
        // Step 4: Optimize batch ordering based on Agility CMS upload requirements
        const optimizedBatches = this.optimizeBatchOrdering(batches);
        
        // Step 5: Validate the sequence and calculate metadata
        const metadata = this.calculateSequenceMetadata(optimizedBatches);
        const validation = this.validateUploadSequence(optimizedBatches, entityMap);

        // Step 6: Process skipped items into detailed report
        const skippedItemsReport = this.createSkippedItemsReport(skippedItems);

        console.log(ansiColors.green(`✅ Generated ${optimizedBatches.length} upload batches for ${metadata.totalEntities} entities`));

        return {
            batches: optimizedBatches,
            metadata,
            validation,
            skippedItems: skippedItemsReport
        };
    }

    /**
     * Step 1.5: Add URL-based assets to entity map (FIXED: Replace, don't duplicate)
     */
    private addUrlBasedAssetsToEntityMap(entityMap: Map<string, BatchEntity>, urlBasedAssets: any[]): void {
        console.log(`   🔗 Processing ${urlBasedAssets.length} URL-based assets...`);
        
        let assetsReplaced = 0;
        let assetsAdded = 0;
        let assetsSkipped = 0;
        
        urlBasedAssets.forEach((asset: any) => {
            const assetId = asset.mediaID || asset.assetID || asset.id;
            if (!assetId) {
                console.warn(`   ⚠️ URL asset missing ID:`, asset);
                assetsSkipped++;
                return;
            }
            
            const assetKey = `Asset:${assetId}`;
            const existingAsset = entityMap.get(assetKey);
            
            if (existingAsset) {
                // Replace existing asset with URL-based version
                entityMap.set(assetKey, {
                    type: 'Asset',
                    id: assetId,
                    name: asset.fileName || existingAsset.name,
                    data: {
                        ...existingAsset.data,
                        ...asset,
                        uploadMethod: 'url-reference', // Mark as URL-based
                        hasFilesystemFile: false,
                        replacedMissingFile: true
                    },
                    dependencies: existingAsset.dependencies // Preserve existing dependencies
                });
                assetsReplaced++;
                console.log(`   🔄 Replaced Asset:${assetId} with URL version`);
            } else {
                // Only add if asset doesn't exist in entity map
                entityMap.set(assetKey, {
                    type: 'Asset',
                    id: assetId,
                    name: asset.fileName || `URL Asset ${assetId}`,
                    data: {
                        ...asset,
                        uploadMethod: 'url-reference',
                        hasFilesystemFile: false,
                        addedFromUrlDiscovery: true
                    },
                    dependencies: []
                });
                assetsAdded++;
                console.log(`   ➕ Added new Asset:${assetId} from URL discovery`);
            }
        });
        
        console.log(`   ✅ URL asset integration complete:`);
        console.log(`      🔄 Replaced: ${assetsReplaced} existing assets`);
        console.log(`      ➕ Added: ${assetsAdded} new assets`);
        console.log(`      ⚠️ Skipped: ${assetsSkipped} assets`);
        console.log(`      📊 Total processed: ${assetsReplaced + assetsAdded} assets`);
    }

    /**
     * Step 1: Build comprehensive entity dependency map
     */
    private buildEntityDependencyMap(analysisResults: ChainAnalysisResults, sourceData: any): { entityMap: Map<string, BatchEntity>, skippedItems: SkippedEntity[] } {
        const entityMap = new Map<string, BatchEntity>();
        const skippedItems: SkippedEntity[] = [];
        
        console.log(ansiColors.cyan(`🔧 [DEBUG] Building entity dependency map...`));
        console.log(`   Source data keys: ${Object.keys(sourceData).join(', ')}`);
        
        // Debug: Check source data entity counts
        console.log(`🔧 [DEBUG] Source data entity counts:`);
        console.log(`   Models: ${sourceData.models?.length || 0}`);
        console.log(`   Assets: ${sourceData.assets?.length || 0}`);
        console.log(`   Content: ${sourceData.content?.length || 0}`);
        console.log(`   Templates: ${sourceData.templates?.length || 0}`);
        console.log(`   Containers: ${sourceData.containers?.length || 0}`);
        console.log(`   Pages: ${sourceData.pages?.length || 0}`);
        console.log(`   Galleries: ${sourceData.galleries?.length || 0}`);

        // Add models with their dependencies (from model chains)
        if (sourceData.models) {
            console.log(`   Processing ${sourceData.models.length} models...`);
            let modelsAdded = 0;
            sourceData.models.forEach((model: any, index: number) => {
                // Handle different model ID fields
                const modelId = model.referenceName || model.id || model.modelId;
                
                if (!modelId) {
                    const missingFields = [];
                    if (!model.referenceName) missingFields.push('referenceName');
                    if (!model.id) missingFields.push('id');
                    if (!model.modelId) missingFields.push('modelId');
                    
                    const skippedEntity: SkippedEntity = {
                        type: 'Model',
                        index,
                        reason: `Missing required ID fields for model identification`,
                        missingFields,
                        data: model,
                        suggestions: [
                            'Check if the model JSON file is corrupted',
                            'Verify the model has a valid referenceName or id field',
                            'Consider manual data repair if this is a critical model'
                        ]
                    };
                    skippedItems.push(skippedEntity);
                    
                    console.warn(`   ⚠️ Model at index ${index} missing ID fields (referenceName, id, modelId):`, {
                        referenceName: model.referenceName,
                        id: model.id,
                        modelId: model.modelId,
                        displayName: model.displayName
                    });
                    return;
                }
                
                const modelKey = `Model:${modelId}`;
                entityMap.set(modelKey, {
                    type: 'Model',
                    id: modelId,
                    name: model.displayName || `Model ${modelId}`,
                    data: model,
                    dependencies: this.extractModelDependencies(model, analysisResults)
                });
                modelsAdded++;
            });
            console.log(`   ✅ Added ${modelsAdded}/${sourceData.models.length} models to entity map`);
        }

        // Add templates (pages may reference them)
        if (sourceData.templates) {
            console.log(`   Processing ${sourceData.templates.length} templates...`);
            sourceData.templates.forEach((template: any) => {
                const templateKey = `Template:${template.pageTemplateName}`;
                entityMap.set(templateKey, {
                    type: 'Template',
                    id: template.pageTemplateName,
                    name: template.pageTemplateName,
                    data: template,
                    dependencies: [] // Templates have no dependencies
                });
            });
            console.log(`   ✅ Added ${sourceData.templates.length} templates to entity map`);
        }

        // Add galleries (assets may reference them)
        if (sourceData.galleries) {
            console.log(`   Processing ${sourceData.galleries.length} galleries...`);
            let galleriesAdded = 0;
            sourceData.galleries.forEach((gallery: any, index: number) => {
                // Handle different gallery ID fields
                const galleryId = gallery.mediaGroupingID || gallery.id || gallery.galleryId;
                
                if (!galleryId) {
                    const missingFields = [];
                    if (!gallery.mediaGroupingID) missingFields.push('mediaGroupingID');
                    if (!gallery.id) missingFields.push('id');
                    if (!gallery.galleryId) missingFields.push('galleryId');
                    
                    const skippedEntity: SkippedEntity = {
                        type: 'Gallery',
                        index,
                        reason: `Missing required ID fields for gallery identification`,
                        missingFields,
                        data: gallery,
                        suggestions: [
                            'Check if the gallery JSON file is corrupted',
                            'Verify the gallery has a valid mediaGroupingID or id field',
                            'Consider orphaned gallery cleanup if not critical'
                        ]
                    };
                    skippedItems.push(skippedEntity);
                    
                    console.warn(`   ⚠️ Gallery at index ${index} missing ID:`, gallery);
                    return;
                }
                
                const galleryKey = `Gallery:${galleryId}`;
                entityMap.set(galleryKey, {
                    type: 'Gallery',
                    id: galleryId,
                    name: gallery.name || `Gallery ${galleryId}`,
                    data: gallery,
                    dependencies: [] // Galleries have no dependencies
                });
                galleriesAdded++;
            });
            console.log(`   ✅ Added ${galleriesAdded} galleries to entity map`);
        }

        // Add assets (content may reference them)
        if (sourceData.assets) {
            console.log(`   Processing ${sourceData.assets.length} assets...`);
            let assetsAdded = 0;
            sourceData.assets.forEach((asset: any, index: number) => {
                // Handle different asset ID fields  
                const assetId = asset.mediaID || asset.fileName || asset.id || asset.assetId;
                
                if (!assetId) {
                    const missingFields = [];
                    if (!asset.fileName) missingFields.push('fileName');
                    if (!asset.mediaID) missingFields.push('mediaID');
                    if (!asset.id) missingFields.push('id');
                    if (!asset.assetId) missingFields.push('assetId');
                    
                    const skippedEntity: SkippedEntity = {
                        type: 'Asset',
                        index,
                        reason: `Missing required ID fields for asset identification`,
                        missingFields,
                        data: asset,
                        suggestions: [
                            'Check if the asset file exists in the file system',
                            'Verify asset metadata is not corrupted',
                            'Consider asset can be uploaded by URL matching instead of metadata',
                            'May be an orphaned asset that can be safely skipped'
                        ]
                    };
                    skippedItems.push(skippedEntity);
                    
                    console.warn(`   ⚠️ Asset at index ${index} missing ID fields (fileName, mediaID, id, assetId):`, {
                        fileName: asset.fileName,
                        mediaID: asset.mediaID,
                        id: asset.id,
                        assetId: asset.assetId
                    });
                    return;
                }
                
                const assetKey = `Asset:${assetId}`;
                entityMap.set(assetKey, {
                    type: 'Asset',
                    id: assetId,
                    name: asset.fileName || `Asset ${assetId}`,
                    data: asset,
                    dependencies: this.extractAssetDependencies(asset)
                });
                assetsAdded++;
            });
            console.log(`   ✅ Added ${assetsAdded}/${sourceData.assets.length} assets to entity map`);
        }

        // REMOVED DUPLICATE PROCESSING BLOCKS:
        // Templates, galleries, and assets are already processed above

        // Add containers (depend on models)
        if (sourceData.containers) {
            console.log(`   Processing ${sourceData.containers.length} containers...`);
            sourceData.containers.forEach((container: any) => {
                // Handle different container ID fields
                const containerId = container.contentViewID || container.id || container.containerId;
                const containerKey = `Container:${containerId}`;
                entityMap.set(containerKey, {
                    type: 'Container',
                    id: containerId,
                    name: container.referenceName || `Container ${containerId}`,
                    data: container,
                    dependencies: this.extractContainerDependencies(container, sourceData)
                });
            });
            console.log(`   ✅ Added ${sourceData.containers.length} containers to entity map`);
        }

        // Add content (depends on containers, models, assets)
        if (sourceData.content) {
            console.log(`   Processing ${sourceData.content.length} content items...`);
            console.log(`   [DEBUG] First content sample:`, JSON.stringify(sourceData.content[0], null, 2));
            
            let contentAdded = 0;
            sourceData.content.forEach((content: any, index: number) => {
                // Handle different content ID fields - check multiple possible locations
                const contentId = content.contentID || content.contentId || content.id || 
                                 content.properties?.contentID || content.properties?.contentId;
                                 
                if (!contentId) {
                    const missingFields = [];
                    if (!content.contentID) missingFields.push('contentID');
                    if (!content.contentId) missingFields.push('contentId');
                    if (!content.id) missingFields.push('id');
                    if (!content.properties?.contentID) missingFields.push('properties.contentID');
                    if (!content.properties?.contentId) missingFields.push('properties.contentId');
                    
                    const skippedEntity: SkippedEntity = {
                        type: 'Content',
                        index,
                        reason: `Missing required ID fields for content identification`,
                        missingFields,
                        data: content,
                        suggestions: [
                            'Check if the content JSON file is corrupted',
                            'Verify content has a valid contentID or id field',
                            'This may be a draft or deleted content item',
                            'Consider manual content data repair if critical'
                        ]
                    };
                    skippedItems.push(skippedEntity);
                    
                    console.warn(`⚠️ Content item at index ${index} missing ID:`, content);
                    return; // Skip items without valid IDs
                }
                
                const contentKey = `Content:${contentId}`;
                entityMap.set(contentKey, {
                    type: 'Content',
                    id: contentId,
                    name: content.properties?.referenceName || content.referenceName || `Content ${contentId}`,
                    data: content,
                    dependencies: this.extractContentDependencies(content, sourceData, analysisResults)
                });
                contentAdded++;
            });
            console.log(`   ✅ Added ${contentAdded} content items to entity map`);
        }

        // Add pages (depend on templates, content)
        if (sourceData.pages) {
            console.log(`   Processing ${sourceData.pages.length} pages...`);
            sourceData.pages.forEach((page: any) => {
                // Handle different page ID fields
                const pageId = page.pageID || page.pageId || page.id;
                const pageKey = `Page:${pageId}`;
                entityMap.set(pageKey, {
                    type: 'Page',
                    id: pageId,
                    name: page.name || `Page ${pageId}`,
                    data: page,
                    dependencies: this.extractPageDependencies(page, sourceData, analysisResults)
                });
            });
            console.log(`   ✅ Added ${sourceData.pages.length} pages to entity map`);
        }

        console.log(ansiColors.green(`🔧 [DEBUG] Entity map completed with ${entityMap.size} entities`));
        console.log(`🔧 [DEBUG] Skipped items captured: ${skippedItems.length}`);
        if (skippedItems.length > 0) {
            console.log(`🔧 [DEBUG] Skipped items breakdown:`);
            skippedItems.forEach((item, index) => {
                console.log(`   ${index + 1}. ${item.type} at index ${item.index}: ${item.reason}`);
            });
        }
        
        // Debug: Show breakdown by type
        const typeBreakdown = new Map<string, number>();
        entityMap.forEach(entity => {
            const type = entity.type;
            typeBreakdown.set(type, (typeBreakdown.get(type) || 0) + 1);
        });
        
        console.log(`   Type breakdown:`);
        typeBreakdown.forEach((count, type) => {
            console.log(`     ${type}: ${count}`);
        });

        return { entityMap, skippedItems };
    }

    /**
     * Step 2: Calculate dependency levels using topological sort
     */
    private calculateDependencyLevels(entityMap: Map<string, BatchEntity>): Map<number, string[]> {
        const levels = new Map<number, string[]>();
        const visited = new Set<string>();
        const inProgress = new Set<string>(); // For cycle detection

        // Calculate level for each entity
        const calculateLevel = (entityKey: string): number => {
            if (visited.has(entityKey)) {
                return 0; // Already processed
            }
            
            if (inProgress.has(entityKey)) {
                console.warn(ansiColors.yellow(`⚠️ Circular dependency detected involving ${entityKey}`));
                return 0; // Break cycle
            }

            const entity = entityMap.get(entityKey);
            if (!entity) return 0;

            inProgress.add(entityKey);
            
            // Calculate max dependency level + 1
            let maxDepLevel = -1;
            entity.dependencies.forEach(dep => {
                const depLevel = calculateLevel(dep);
                maxDepLevel = Math.max(maxDepLevel, depLevel);
            });

            const entityLevel = maxDepLevel + 1;
            visited.add(entityKey);
            inProgress.delete(entityKey);

            // Add to appropriate level
            if (!levels.has(entityLevel)) {
                levels.set(entityLevel, []);
            }
            levels.get(entityLevel)!.push(entityKey);

            return entityLevel;
        };

        // Process all entities
        entityMap.forEach((_, entityKey) => {
            if (!visited.has(entityKey)) {
                calculateLevel(entityKey);
            }
        });

        return levels;
    }

    /**
     * Step 3: Create upload batches from dependency levels (FIXED: One batch per level)
     */
    private createUploadBatches(dependencyLevels: Map<number, string[]>, entityMap: Map<string, BatchEntity>): DependencyOrderedBatch[] {
        const batches: DependencyOrderedBatch[] = [];

        // Sort levels by dependency depth
        const sortedLevels = Array.from(dependencyLevels.keys()).sort((a, b) => a - b);

        sortedLevels.forEach(level => {
            const entityKeys = dependencyLevels.get(level) || [];
            
            if (entityKeys.length === 0) return;
            
            // Group entities by type within each level for ordering
            const entitiesByType = this.groupEntitiesByType(entityKeys, entityMap);

            // Collect all entities for this level in CORRECTED dependency order
            // FIXED: Models → Galleries → Assets → Content → Containers → Templates → Pages
            const typeOrder = ['Model', 'Gallery', 'Asset', 'Content', 'Container', 'Template', 'Page'];
            const allEntitiesForLevel: BatchEntity[] = [];
            
            typeOrder.forEach(type => {
                const entities = entitiesByType.get(type) || [];
                allEntitiesForLevel.push(...entities);
            });

            // Create ONE batch per dependency level containing all entity types
            if (allEntitiesForLevel.length > 0) {
                const entityTypeSummary = this.getEntityTypeSummary(entitiesByType);
                
                batches.push({
                    level,
                    phase: `Level ${level} (${entityTypeSummary})`,
                    entities: allEntitiesForLevel,
                    dependencies: this.getBatchDependencies(allEntitiesForLevel),
                    estimatedDuration: this.estimateBatchDuration(allEntitiesForLevel)
                });
            }
        });

        return batches;
    }

    /**
     * Step 4: Optimize batch ordering (SIMPLIFIED: Already optimized within levels)
     */
    private optimizeBatchOrdering(batches: DependencyOrderedBatch[]): DependencyOrderedBatch[] {
        // Optimization is now handled within each dependency level batch
        // Entity types are ordered correctly: Model → Gallery → Asset → Content → Container → Template → Page
        // Dependency levels ensure proper cross-level dependencies are respected
        
        // Simply ensure batches are sorted by level (should already be the case)
        return batches.sort((a, b) => a.level - b.level);
    }

    /**
     * Helper: Group entities by type
     */
    private groupEntitiesByType(entityKeys: string[], entityMap: Map<string, BatchEntity>): Map<string, BatchEntity[]> {
        const groups = new Map<string, BatchEntity[]>();
        
        entityKeys.forEach(key => {
            const entity = entityMap.get(key);
            if (entity) {
                if (!groups.has(entity.type)) {
                    groups.set(entity.type, []);
                }
                groups.get(entity.type)!.push(entity);
            }
        });

        return groups;
    }

    /**
     * Helper: Create summary of entity types in a batch
     */
    private getEntityTypeSummary(entitiesByType: Map<string, BatchEntity[]>): string {
        const typeCounts: string[] = [];
        
        // Order types for consistent display (CORRECTED dependency order)
        const typeOrder = ['Model', 'Gallery', 'Asset', 'Content', 'Container', 'Template', 'Page'];
        
        typeOrder.forEach(type => {
            const entities = entitiesByType.get(type) || [];
            if (entities.length > 0) {
                typeCounts.push(`${entities.length} ${type}${entities.length > 1 ? 's' : ''}`);
            }
        });

        return typeCounts.join(', ');
    }

    /**
     * Extract model dependencies from chain analysis
     */
    private extractModelDependencies(model: any, analysisResults: ChainAnalysisResults): string[] {
        const dependencies: string[] = [];
        
        // Check model fields for Content Definition references (model-to-model relationships)
        if (model.fields) {
            model.fields.forEach((field: any) => {
                if (field.type === 'Content Definition' && field.settings?.contentDefinitionReferenceName) {
                    dependencies.push(`Model:${field.settings.contentDefinitionReferenceName}`);
                }
            });
        }

        return dependencies;
    }

    /**
     * Extract asset dependencies (primarily gallery references)
     */
    private extractAssetDependencies(asset: any): string[] {
        const dependencies: string[] = [];
        
        // Assets may reference galleries
        if (asset.galleryID || asset.mediaGroupingID) {
            dependencies.push(`Gallery:${asset.galleryID || asset.mediaGroupingID}`);
        }

        return dependencies;
    }

    /**
     * Extract container dependencies (model references)
     */
    private extractContainerDependencies(container: any, sourceData: any): string[] {
        const dependencies: string[] = [];
        
        // Containers depend on their content definition (model)
        if (container.contentDefinitionID) {
            const model = sourceData.models?.find((m: any) => m.id === container.contentDefinitionID);
            if (model) {
                dependencies.push(`Model:${model.referenceName}`);
            }
        }

        return dependencies;
    }

    /**
     * Extract content dependencies (model and asset references - CORRECTED)
     * Content depends on models for structure and assets for media, but NOT containers
     * Containers are just organizational placeholders, not direct dependencies
     */
    private extractContentDependencies(content: any, sourceData: any, analysisResults: ChainAnalysisResults): string[] {
        const dependencies: string[] = [];
        
        // Content depends on its model (for structure definition)
        const modelRef = content.properties?.definitionName;
        if (modelRef) {
            const model = sourceData.models?.find((m: any) => 
                m.referenceName?.toLowerCase() === modelRef.toLowerCase()
            );
            if (model) {
                dependencies.push(`Model:${model.referenceName}`);
            }
        }

        // TODO: Add asset dependencies if content fields reference assets
        // This would scan content.fields for asset URLs and add Asset: dependencies

        return dependencies;
    }

    /**
     * Extract page dependencies (template, content, parent page references)
     */
    private extractPageDependencies(page: any, sourceData: any, analysisResults: ChainAnalysisResults): string[] {
        const dependencies: string[] = [];
        
        // Pages depend on their template
        if (page.templateName) {
            dependencies.push(`Template:${page.templateName}`);
        }

        // Pages depend on parent pages (hierarchical)
        if (page.parentID && page.parentID > 0) {
            dependencies.push(`Page:${page.parentID}`);
        }

        return dependencies;
    }

    /**
     * Calculate batch dependencies
     */
    private getBatchDependencies(entities: BatchEntity[]): string[] {
        const allDeps = new Set<string>();
        entities.forEach(entity => {
            entity.dependencies.forEach(dep => allDeps.add(dep));
        });
        return Array.from(allDeps);
    }

    /**
     * Estimate batch duration (rough calculation)
     */
    private estimateBatchDuration(entities: BatchEntity[]): number {
        // Rough estimates per entity type (in seconds)
        const durations = {
            Model: 2,
            Template: 1,
            Gallery: 0.5,
            Asset: 1,
            Container: 1,
            Content: 0.5,
            Page: 1
        };

        const totalSeconds = entities.reduce((sum, entity) => {
            return sum + (durations[entity.type] || 1);
        }, 0);

        return Math.ceil(totalSeconds / 60); // Return in minutes
    }

    /**
     * Calculate sequence metadata
     */
    private calculateSequenceMetadata(batches: DependencyOrderedBatch[]): OptimizedUploadSequence['metadata'] {
        const totalEntities = batches.reduce((sum, batch) => sum + batch.entities.length, 0);
        const totalDuration = batches.reduce((sum, batch) => sum + batch.estimatedDuration, 0);
        
        // Max parallelism is the largest batch size (entities that can be uploaded simultaneously)
        const maxParallelism = Math.max(...batches.map(batch => batch.entities.length));
        
        // Critical path is the sequence of batch phases
        const criticalPath = batches.map(batch => batch.phase);

        return {
            totalBatches: batches.length,
            totalEntities,
            maxParallelism,
            estimatedTotalDuration: totalDuration,
            criticalPath
        };
    }

    /**
     * Validate upload sequence for correctness
     */
    private validateUploadSequence(batches: DependencyOrderedBatch[], entityMap: Map<string, BatchEntity>): OptimizedUploadSequence['validation'] {
        const processedEntities = new Set<string>();
        const circularDependencies: string[] = [];
        const missingDependencies: string[] = [];

        // Check each batch in order
        batches.forEach(batch => {
            batch.entities.forEach(entity => {
                const entityKey = `${entity.type}:${entity.id}`;
                
                // Check if all dependencies have been processed in earlier batches
                entity.dependencies.forEach(dep => {
                    if (!processedEntities.has(dep) && entityMap.has(dep)) {
                        missingDependencies.push(`${entityKey} depends on ${dep} but ${dep} comes later`);
                    }
                });

                processedEntities.add(entityKey);
            });
        });

        return {
            allDependenciesResolved: missingDependencies.length === 0,
            circularDependencies,
            missingDependencies
        };
    }

    /**
     * Create detailed report of skipped items with suggestions
     */
    private createSkippedItemsReport(skippedItems: SkippedEntity[]): SkippedItemsReport {
        const byType = new Map<string, SkippedEntity[]>();
        
        // Group skipped items by type
        skippedItems.forEach(item => {
            if (!byType.has(item.type)) {
                byType.set(item.type, []);
            }
            byType.get(item.type)!.push(item);
        });

        // Generate summary
        const totalSkipped = skippedItems.length;
        let summary = '';
        
        if (totalSkipped === 0) {
            summary = '✅ No entities skipped - 100% inclusion achieved!';
        } else {
            const typeSummaries: string[] = [];
            byType.forEach((items, type) => {
                typeSummaries.push(`${items.length} ${type}${items.length > 1 ? 's' : ''}`);
            });
            summary = `⚠️ ${totalSkipped} entities skipped: ${typeSummaries.join(', ')}`;
        }

        return {
            totalSkipped,
            byType,
            summary
        };
    }

    /**
     * Debug method: Print upload sequence for analysis
     */
    printUploadSequence(sequence: OptimizedUploadSequence): void {
        console.log(ansiColors.cyan('\n📋 OPTIMIZED UPLOAD SEQUENCE'));
        console.log('===============================================');
        
        sequence.batches.forEach((batch, index) => {
            console.log(ansiColors.blue(`\n${index + 1}. ${batch.phase} (Level ${batch.level})`));
            console.log(`   Entities: ${batch.entities.length}`);
            console.log(`   Duration: ~${batch.estimatedDuration} min`);
            console.log(`   Dependencies: ${batch.dependencies.join(', ') || 'None'}`);
            
            if (batch.entities.length <= 5) {
                batch.entities.forEach(entity => {
                    console.log(`   - ${entity.type}:${entity.name}`);
                });
            } else {
                batch.entities.slice(0, 3).forEach(entity => {
                    console.log(`   - ${entity.type}:${entity.name}`);
                });
                console.log(`   - ... and ${batch.entities.length - 3} more`);
            }
        });

        console.log(ansiColors.cyan('\n📊 SEQUENCE METADATA'));
        console.log(`Total Batches: ${sequence.metadata.totalBatches}`);
        console.log(`Total Entities: ${sequence.metadata.totalEntities}`);
        console.log(`Estimated Duration: ${sequence.metadata.estimatedTotalDuration} minutes`);
        console.log(`Max Parallelism: ${sequence.metadata.maxParallelism} entities`);

        if (!sequence.validation.allDependenciesResolved) {
            console.log(ansiColors.red('\n❌ VALIDATION ISSUES:'));
            sequence.validation.missingDependencies.forEach(issue => {
                console.log(`   ${issue}`);
            });
        } else {
            console.log(ansiColors.green('\n✅ All dependencies resolved correctly'));
        }

        // NEW: Display skipped items report
        console.log(ansiColors.cyan('\n📊 SKIPPED ITEMS REPORT'));
        console.log(`${sequence.skippedItems.summary}`);
        
        if (sequence.skippedItems.totalSkipped > 0) {
            sequence.skippedItems.byType.forEach((items, type) => {
                console.log(ansiColors.yellow(`\n${type} (${items.length} skipped):`));
                items.forEach((item, idx) => {
                    console.log(`   ${idx + 1}. Index ${item.index}: ${item.reason}`);
                    console.log(`      Missing fields: ${item.missingFields.join(', ')}`);
                    if (item.suggestions && item.suggestions.length > 0) {
                        console.log(`      Suggestions:`);
                        item.suggestions.forEach(suggestion => {
                            console.log(`        • ${suggestion}`);
                        });
                    }
                });
            });
        }
    }
}