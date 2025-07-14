/**
 * Entity Comparer Service
 * 
 * Compares current target instance data against target mappings (from last sync) 
 * using versionID and modifiedDate to detect changes that occurred on the target instance.
 * Lightweight comparison focused on actual change detection fields.
 */

import ansiColors from 'ansi-colors';
import { GuidDataLoader, GuidEntities } from './source-data-loader';

export interface EntityComparison {
    entityType: string;
    entityId: string;
    hasChanges: boolean;
    changeType: 'create' | 'update' | 'none';
    changeDetails?: string[];
}

export interface ComparisonResult {
    comparisons: EntityComparison[];
    totalChanges: number;
    createCount: number;
    updateCount: number;
    noChangeCount: number;
}

export class EntityComparer {
    private targetGuid: string;
    private targetLoader: GuidDataLoader;

    constructor(targetGuid: string) {
        this.targetGuid = targetGuid;
        this.targetLoader = new GuidDataLoader(targetGuid);
    }

    /**
     * Compare current target instance data against target mappings to detect changes since last sync
     */
    async compareEntities(targetMappings: GuidEntities, referenceMapper?: any): Promise<ComparisonResult> {
        console.log(ansiColors.cyan(`\n🔍 Loading current target instance data for comparison...`));
        
        // Load current target instance data
        const currentTargetData = await this.targetLoader.loadGuidEntities();
        
        const comparisons: EntityComparison[] = [];

        // Compare each entity type
        this.compareEntityType('pages', targetMappings.pages, currentTargetData.pages, comparisons);
        this.compareEntityType('templates', targetMappings.templates, currentTargetData.templates, comparisons);
        this.compareEntityType('containers', targetMappings.containers, currentTargetData.containers, comparisons);
        this.compareEntityType('models', targetMappings.models, currentTargetData.models, comparisons);
        this.compareEntityType('content', targetMappings.content, currentTargetData.content, comparisons);
        this.compareEntityType('assets', targetMappings.assets, currentTargetData.assets, comparisons);
        this.compareEntityType('galleries', targetMappings.galleries, currentTargetData.galleries, comparisons);

        // Calculate summary
        const result: ComparisonResult = {
            comparisons,
            totalChanges: comparisons.filter(c => c.hasChanges).length,
            createCount: comparisons.filter(c => c.changeType === 'create').length,
            updateCount: comparisons.filter(c => c.changeType === 'update').length,
            noChangeCount: comparisons.filter(c => c.changeType === 'none').length
        };

        this.logComparisonSummary(result);
        return result;
    }

    /**
     * Compare entities of a specific type using versionID and modifiedDate
     */
    private compareEntityType(
        entityType: string,
        mappingEntities: any[],
        currentTargetEntities: any[],
        comparisons: EntityComparison[]
    ): void {
        console.log(ansiColors.yellow(`📊 Comparing ${entityType}...`));
        
        // Create current target map for efficient lookups
        const currentTargetMap = new Map<string, any>();
        currentTargetEntities.forEach(entity => {
            const id = this.getEntityId(entity, entityType);
            if (id) {
                currentTargetMap.set(id, entity);
            }
        });

        // Compare mapping entities against current target
        for (const mappingEntity of mappingEntities) {
            const id = this.getEntityId(mappingEntity, entityType);
            if (!id) continue;

            const currentTargetEntity = currentTargetMap.get(id);
            
            if (!currentTargetEntity) {
                // Entity exists in mappings but not in current target - DELETED on target
                comparisons.push({
                    entityType,
                    entityId: id,
                    hasChanges: true,
                    changeType: 'create',
                    changeDetails: ['Entity was deleted from target instance']
                });
            } else {
                // Entity exists in both - check for changes using versionID/modifiedDate
                const hasChanges = this.detectEntityChanges(mappingEntity, currentTargetEntity, entityType);
                comparisons.push({
                    entityType,
                    entityId: id,
                    hasChanges,
                    changeType: hasChanges ? 'update' : 'none',
                    changeDetails: hasChanges ? ['Entity modified on target instance since last sync'] : []
                });
            }
        }

        console.log(ansiColors.gray(`${entityType}: ${mappingEntities.length} mappings, ${currentTargetEntities.length} current target`));
    }

    /**
     * Get appropriate ID field for different entity types
     */
    private getEntityId(entity: any, entityType: string): string | null {
        if (!entity) return null;

        switch (entityType) {
            case 'pages':
                return entity.pageID?.toString();
            // case 'templates':
            //     return entity.templateID?.toString();
            case 'containers':
                return entity.containerID?.toString();
            case 'models':
                return entity.id?.toString();
            case 'content':
                return entity.contentID?.toString();
            case 'assets':
                return entity.mediaID?.toString();
            case 'galleries':
                return entity.galleryID?.toString();
            default:
                return entity.id?.toString();
        }
    }

    /**
     * Detect changes using versionID and modifiedDate comparison
     */
    private detectEntityChanges(mappingEntity: any, currentTargetEntity: any, entityType: string): boolean {
        try {
            switch (entityType) {
                case 'pages':
                case 'content':
                    // Pages and content items use properties.versionID and properties.modified
                    const mappingVersion = mappingEntity.properties?.versionID;
                    const currentVersion = currentTargetEntity.properties?.versionID;
                    const mappingModified = mappingEntity.properties?.modified;
                    const currentModified = currentTargetEntity.properties?.modified;
                    
                    return mappingVersion !== currentVersion || mappingModified !== currentModified;

                case 'models':
                    // Models use lastModifiedDate
                    const mappingLastModified = mappingEntity.lastModifiedDate;
                    const currentLastModified = currentTargetEntity.lastModifiedDate;
                    return mappingLastModified !== currentLastModified;

                case 'assets':
                    // Assets use dateModified
                    const mappingDateModified = mappingEntity.dateModified;
                    const currentDateModified = currentTargetEntity.dateModified;
                    return mappingDateModified !== currentDateModified;

                case 'templates':
                case 'containers':
                case 'galleries':
                    // TODO: Determine comparison fields for these entity types
                    // For now, fall back to basic comparison
                    const mappingJson = JSON.stringify(mappingEntity);
                    const currentJson = JSON.stringify(currentTargetEntity);
                    return mappingJson !== currentJson;

                default:
                    return false;
            }
        } catch (error) {
            console.warn(ansiColors.yellow(`⚠️ Error comparing ${entityType} entities: ${error}`));
            return true; // Assume changes if comparison fails
        }
    }

    /**
     * Log comparison summary
     */
    private logComparisonSummary(result: ComparisonResult): void {
        console.log(ansiColors.cyan(`\n📋 Target Instance Change Detection Summary:`));
        console.log(ansiColors.green(`✓ Total entities compared: ${result.comparisons.length}`));
        console.log(ansiColors.yellow(`⚡ Changes detected on target instance: ${result.totalChanges}`));
        console.log(ansiColors.blue(`  • Entities deleted from target: ${result.createCount}`));
        console.log(ansiColors.blue(`  • Entities modified on target: ${result.updateCount}`));
        console.log(ansiColors.gray(`  • No changes detected: ${result.noChangeCount}`));
    }

    /**
     * Filter entities that have changes on target instance
     */
    getChangedEntities(result: ComparisonResult, entityType: string): EntityComparison[] {
        return result.comparisons.filter(c => 
            c.entityType === entityType && 
            c.hasChanges && 
            (c.changeType === 'create' || c.changeType === 'update')
        );
    }

    /**
     * Check if current target instance data exists
     */
    async targetDataExists(): Promise<boolean> {
        return this.targetLoader.validateDataStructure();
    }
} 