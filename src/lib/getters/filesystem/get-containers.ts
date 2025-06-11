import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getModelsFromFileSystem } from './get-models';

/**
 * Get containers from filesystem without side effects
 * Derives container metadata from /list directory (from ChainDataLoader logic)
 */
export function getContainersFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.Container[] {
    const baseFolder = rootPath || 'agility-files';
    let listPath: string;

    if (legacyFolders) {
        listPath = `${baseFolder}/list`;
    } else {
        listPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/list`;
    }

    if (!fs.existsSync(listPath)) {
        return [];
    }

    try {
        const listFiles = fs.readdirSync(listPath).filter(file => file.endsWith('.json'));
        const containerLists = listFiles.map(file => {
            try {
                return JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
            } catch {
                return null;
            }
        }).filter(item => item !== null);

        // Load models for container matching (from ChainDataLoader logic)
        const models = getModelsFromFileSystem(guid, locale, isPreview, rootPath, legacyFolders);
        
        // Derive container metadata from list files and their contents (exact logic from original ChainDataLoader)
        const containerMetadata: any[] = [];
        containerLists.forEach((contentList: any, index: number) => {
            if (Array.isArray(contentList) && contentList.length > 0) {
                // Get container metadata from the first content item's properties
                const firstItem = contentList[0];
                if (firstItem.properties) {
                    // Find the model ID by matching definitionName with model referenceName
                    const matchingModel = models.find((model: any) => 
                        model.referenceName === firstItem.properties.definitionName
                    );

                    const container = {
                        // Use referenceName as the container identifier
                        referenceName: firstItem.properties.referenceName,
                        contentViewID: index + 1000, // Generate unique ID for analysis
                        contentDefinitionID: matchingModel ? matchingModel.id : null, // Proper model ID reference
                        contentCount: contentList.length,
                        // Store the list contents for reference
                        _contentItems: contentList
                    };
                    containerMetadata.push(container);
                }
            }
        });
        
        return containerMetadata;
    } catch (error: any) {
        console.warn(`[Containers] Error loading containers from ${listPath}: ${error.message}`);
        return [];
    }
}

/**
 * Transform models to structured era format (exact logic from original ChainDataLoader)
 */
function transformModelsToStructuredEra(models: any[]): any[] {
    return models.map(model => {
        // Extract old field values for transformation
        const oldId = model.id;
        const oldDisplayName = model.displayName;
        
        // Create new model with transformed fields, preserving BOTH old and new field names for compatibility
        const transformedModel = {
            // Preserve non-conflicting original fields
            referenceName: model.referenceName,
            contentDefinitionTypeID: model.contentDefinitionTypeID,
            sortOrder: model.sortOrder,
            allowTagging: model.allowTagging,
            isModuleList: model.isModuleList,
            lastModifiedDate: model.lastModifiedDate,
            lastModifiedBy: model.lastModifiedBy,
            
            // CRITICAL: Preserve original field names for existing model pusher and container mapper compatibility
            id: oldId || model.id,                                       // Keep original id field
            displayName: oldDisplayName || model.displayName,            // Keep original displayName field
            
            // NEW: Structured-era field names (ADD alongside old ones for dual compatibility)
            definitionID: oldId || model.definitionID,                    // id → definitionID (additional)
            definitionName: oldDisplayName || model.definitionName,       // displayName → definitionName (additional)
            
            // Ensure required structured-era fields exist
            fields: model.fields || [],
            
            // Preserve any other fields that don't conflict with transformation
            ...Object.keys(model).reduce((acc, key) => {
                // Skip fields we've already handled explicitly above
                if (!['id', 'displayName', 'referenceName', 'contentDefinitionTypeID', 
                      'sortOrder', 'allowTagging', 'isModuleList', 'lastModifiedDate', 
                      'lastModifiedBy', 'fields', 'definitionID', 'definitionName'].includes(key)) {
                    acc[key] = model[key];
                }
                return acc;
            }, {} as any)
        };
        
        // Add debug info if needed (only in verbose mode)
        if (process.env.DEBUG) {
            transformedModel.__transformedFrom = {
                originalId: oldId,
                originalDisplayName: oldDisplayName
            };
        }
        
        return transformedModel;
    });
}

function loadModelsForContainers(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean
): any[] {
    const baseFolder = rootPath || 'agility-files';
    let modelsPath: string;

    if (legacyFolders) {
        modelsPath = `${baseFolder}/models`;
    } else {
        modelsPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/models`;
    }

    try {
        const modelFiles = fs.readdirSync(modelsPath).filter(file => file.endsWith('.json'));
        return modelFiles.map(file => {
            const modelData = JSON.parse(fs.readFileSync(`${modelsPath}/${file}`, 'utf8'));
            return modelData as mgmtApi.Model;
        });
    } catch (error: any) {
        console.warn(`[Models] Error loading models for containers from ${modelsPath}: ${error.message}`);
        return [];
    }
}

/**
 * LEGACY: Get containers from Content Sync SDK /list directory with ReferenceMapper side effects
 * This is the REAL source of container data (not the obsolete /containers directory)
 */
export function getContainersFromFileSystemLegacy(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: any,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.Container[] {
    const baseFolder = rootPath || 'agility-files';
    let listPath: string;

    if (legacyFolders) {
        listPath = `${baseFolder}/list`;
    } else {
        listPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/list`;
    }

    if (!fs.existsSync(listPath)) {
        return [];
    }

    const listFiles = fs.readdirSync(listPath).filter(file => file.endsWith('.json'));
    const containerLists = listFiles.map(file => {
        try {
            return JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
        } catch {
            return null;
        }
    }).filter(item => item !== null);

    // Load models first to resolve definitionName to model ID
    const rawModels = loadModelsForContainers(guid, locale, isPreview, rootPath, legacyFolders);
    const models = transformModelsToStructuredEra(rawModels);
    
    // Derive container metadata from list files and their contents
    const containerMetadata: any[] = [];
    containerLists.forEach((contentList: any, index: number) => {
        if (Array.isArray(contentList) && contentList.length > 0) {
            // Get container metadata from the first content item's properties
            const firstItem = contentList[0];
            if (firstItem.properties) {
                // Find the model ID by matching definitionName with model referenceName
                const matchingModel = models.find((model: any) => 
                    model.referenceName === firstItem.properties.definitionName
                );

                const container = {
                    // Use referenceName as the container identifier
                    referenceName: firstItem.properties.referenceName,
                    contentViewID: index + 1000, // Generate unique ID for analysis
                    contentDefinitionID: matchingModel ? matchingModel.id : null, // Proper model ID reference
                    contentCount: contentList.length,
                    // Store the list contents for reference
                    _contentItems: contentList
                };
                
                // Add to reference mapper
                referenceMapper.addRecord('container', container, null);
                containerMetadata.push(container);
            }
        }
    });
    
    return containerMetadata;
} 