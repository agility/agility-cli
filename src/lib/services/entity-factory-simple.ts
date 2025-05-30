import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { 
    EntityKey, 
    EntityType,
    parseEntityKey,
    createEntityKey,
    RelationshipType
} from './dependency-analyzer';
import { 
    EntityFactory, 
    RelationshipLink
} from './two-pass-orchestrator';

/**
 * Simplified Entity Factory Implementation
 * 
 * This is a simplified version focusing on the architectural patterns
 * rather than complete API implementations.
 */

export interface EntityFactoryContext {
    apiClient: mgmtApi.ApiClient;
    targetGuid: string;
    locale?: string;
    debug?: boolean;
}

/**
 * Abstract Base Entity Factory
 */
export abstract class BaseSimpleEntityFactory implements EntityFactory {
    protected context: EntityFactoryContext;

    constructor(context: EntityFactoryContext) {
        this.context = context;
    }

    abstract createStub(entity: any, targetId?: number | string): Promise<any>;
    abstract createFull(entity: any, dependencyMappings: Map<EntityKey, number | string>): Promise<any>;
    abstract updateWithRelationships(
        targetId: number | string, 
        relationships: RelationshipLink[], 
        mappings: Map<EntityKey, number | string>
    ): Promise<any>;

    protected log(level: 'info' | 'warn' | 'error', message: string): void {
        if (!this.context.debug && level === 'info') return;
        
        const color = level === 'error' ? ansiColors.red : 
                     level === 'warn' ? ansiColors.yellow : 
                     ansiColors.cyan;
        
        console.log(color(`[${this.constructor.name}] ${message}`));
    }
}

/**
 * Gallery Factory - Simplified
 */
export class SimpleGalleryFactory extends BaseSimpleEntityFactory {
    async createStub(gallery: any): Promise<any> {
        this.log('info', `Creating gallery stub: ${gallery.name || 'Untitled'}`);
        return { id: Math.random(), mediaGroupingID: Math.random() };
    }

    async createFull(gallery: any, dependencyMappings: Map<EntityKey, number | string>): Promise<any> {
        this.log('info', `Creating gallery: ${gallery.name || 'Untitled'}`);
        
        // Simplified implementation - would use actual API calls
        try {
            // const response = await this.context.apiClient.assetMethods.saveGallery(this.context.targetGuid, payload);
            const mockResponse = { id: Math.random(), mediaGroupingID: Math.random() };
            return mockResponse;
        } catch (error) {
            this.log('error', `Failed to create gallery: ${(error as Error).message}`);
            throw error;
        }
    }

    async updateWithRelationships(
        targetId: number | string, 
        relationships: RelationshipLink[], 
        mappings: Map<EntityKey, number | string>
    ): Promise<any> {
        this.log('info', `Gallery ${targetId} - no relationship updates needed`);
        return { success: true };
    }
}

/**
 * Model Factory - Simplified  
 */
export class SimpleModelFactory extends BaseSimpleEntityFactory {
    async createStub(model: any): Promise<any> {
        this.log('info', `Creating model stub: ${model.referenceName}`);
        
        // Create minimal model without field references
        const stubData = {
            referenceName: model.referenceName,
            displayName: model.displayName,
            fields: []
        };
        
        try {
            // const response = await this.context.apiClient.modelMethods.saveModel(stubData, this.context.targetGuid);
            const mockResponse = { id: Math.random(), referenceName: model.referenceName };
            this.log('info', `Model stub created with ID: ${mockResponse.id}`);
            return mockResponse;
        } catch (error) {
            this.log('error', `Failed to create model stub: ${(error as Error).message}`);
            throw error;
        }
    }

    async createFull(model: any, dependencyMappings: Map<EntityKey, number | string>): Promise<any> {
        this.log('info', `Creating model: ${model.referenceName}`);
        
        // Process fields, updating content definition references
        const processedFields = this.processModelFields(model.fields || [], dependencyMappings);
        
        try {
            // const response = await this.context.apiClient.modelMethods.saveModel(modelData, this.context.targetGuid);
            const mockResponse = { id: Math.random(), referenceName: model.referenceName, fields: processedFields };
            this.log('info', `Model created with ID: ${mockResponse.id}`);
            return mockResponse;
        } catch (error) {
            this.log('error', `Failed to create model: ${(error as Error).message}`);
            throw error;
        }
    }

    async updateWithRelationships(
        targetId: number | string, 
        relationships: RelationshipLink[], 
        mappings: Map<EntityKey, number | string>
    ): Promise<any> {
        this.log('info', `Updating model ${targetId} with ${relationships.length} relationships`);
        
        try {
            // Get current model and update field references
            // const currentModel = await this.context.apiClient.modelMethods.getContentModel(targetId, this.context.targetGuid);
            
            // Update model→model field references
            const modelRelationships = relationships.filter(rel => rel.relationship === RelationshipType.MODEL_TO_MODEL);
            
            for (const rel of modelRelationships) {
                const targetModelId = mappings.get(rel.targetKey);
                if (targetModelId) {
                    this.log('info', `Linked model field to target model ${targetModelId}`);
                }
            }
            
            this.log('info', `Model ${targetId} updated with resolved field references`);
            
        } catch (error) {
            this.log('error', `Failed to update model ${targetId}: ${(error as Error).message}`);
            throw error;
        }
        
        return { success: true };
    }

    private processModelFields(fields: any[], dependencyMappings: Map<EntityKey, number | string>): any[] {
        return fields.map(field => {
            if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                const referencedModelKey = createEntityKey('model', field.settings['ContentDefinition']);
                const mappedModelId = dependencyMappings.get(referencedModelKey);
                
                if (mappedModelId) {
                    return {
                        ...field,
                        settings: {
                            ...field.settings,
                            ContentDefinition: mappedModelId.toString()
                        }
                    };
                }
            }
            return field;
        });
    }
}

/**
 * Content Factory - Simplified
 */
export class SimpleContentFactory extends BaseSimpleEntityFactory {
    async createStub(content: any): Promise<any> {
        this.log('info', `Creating content stub: ${content.properties?.referenceName || 'Untitled'}`);
        
        const stubData = {
            contentID: -1,
            properties: {
                definitionName: content.properties?.definitionName,
                referenceName: content.properties?.referenceName,
                state: 2 // Published
            },
            fields: {}
        };
        
        try {
            // const response = await this.context.apiClient.contentMethods.saveContentItem(stubData, this.context.targetGuid, this.context.locale);
            const mockResponse = { contentID: Math.random(), properties: stubData.properties };
            this.log('info', `Content stub created with ID: ${mockResponse.contentID}`);
            return mockResponse;
        } catch (error) {
            this.log('error', `Failed to create content stub: ${(error as Error).message}`);
            throw error;
        }
    }

    async createFull(content: any, dependencyMappings: Map<EntityKey, number | string>): Promise<any> {
        this.log('info', `Creating content: ${content.properties?.referenceName || 'Untitled'}`);
        
        // Process fields, updating references
        const processedFields = this.processContentFields(content.fields || {}, dependencyMappings);
        
        const contentData = {
            contentID: -1,
            properties: content.properties,
            fields: processedFields
        };
        
        try {
            // const response = await this.context.apiClient.contentMethods.saveContentItem(contentData, this.context.targetGuid, this.context.locale);
            const mockResponse = { contentID: Math.random(), properties: content.properties, fields: processedFields };
            this.log('info', `Content created with ID: ${mockResponse.contentID}`);
            return mockResponse;
        } catch (error) {
            this.log('error', `Failed to create content: ${(error as Error).message}`);
            throw error;
        }
    }

    async updateWithRelationships(
        targetId: number | string, 
        relationships: RelationshipLink[], 
        mappings: Map<EntityKey, number | string>
    ): Promise<any> {
        this.log('info', `Updating content ${targetId} with ${relationships.length} relationships`);
        
        try {
            // Update content references
            const contentRelationships = relationships.filter(rel => 
                rel.relationship === RelationshipType.CONTENT_TO_CONTENT ||
                rel.relationship === RelationshipType.ASSET_TO_CONTENT
            );
            
            for (const rel of contentRelationships) {
                const targetEntityId = mappings.get(rel.targetKey);
                if (targetEntityId) {
                    this.log('info', `Linked content field to ${rel.relationship} ${targetEntityId}`);
                }
            }
            
            this.log('info', `Content ${targetId} updated with resolved references`);
            
        } catch (error) {
            this.log('error', `Failed to update content ${targetId}: ${(error as Error).message}`);
            throw error;
        }
        
        return { success: true };
    }

    private processContentFields(fields: Record<string, any>, mappings: Map<EntityKey, number | string>): Record<string, any> {
        const processValue = (value: any): any => {
            if (typeof value !== 'object' || value === null) {
                return value;
            }
            
            if (Array.isArray(value)) {
                return value.map(item => processValue(item));
            }
            
            const processed = { ...value };
            
            // Update content references
            if (processed.contentID && typeof processed.contentID === 'number' && processed.contentID > 0) {
                const contentKey = createEntityKey('content', processed.contentID);
                const mappedId = mappings.get(contentKey);
                if (mappedId) {
                    processed.contentID = mappedId as number;
                }
            }
            
            // Recursively process nested objects
            for (const [key, val] of Object.entries(processed)) {
                processed[key] = processValue(val);
            }
            
            return processed;
        };
        
        const processedFields: Record<string, any> = {};
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            processedFields[fieldName] = processValue(fieldValue);
        }
        
        return processedFields;
    }
}

/**
 * Simple Entity Factory Registry
 */
export class SimpleEntityFactoryRegistry {
    private factories: Map<EntityType, EntityFactory> = new Map();

    registerStandardFactories(context: EntityFactoryContext): void {
        this.factories.set('gallery', new SimpleGalleryFactory(context));
        this.factories.set('model', new SimpleModelFactory(context));
        this.factories.set('content', new SimpleContentFactory(context));
        // TODO: Add other entity types
    }

    register(entityType: EntityType, factory: EntityFactory): void {
        this.factories.set(entityType, factory);
    }

    get(entityType: EntityType): EntityFactory | undefined {
        return this.factories.get(entityType);
    }

    getRegisteredTypes(): EntityType[] {
        return Array.from(this.factories.keys());
    }
} 