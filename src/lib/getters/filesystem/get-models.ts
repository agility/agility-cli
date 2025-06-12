import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../services/fileOperations';

/**
 * Get models from filesystem without side effects
 * Includes transformation to structured era format (from ChainDataLoader logic)
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getModelsFromFileSystem(
    fileOps: fileOperations
): mgmtApi.Model[] {
    const rawModels = fileOps.readJsonFilesFromFolder('models');
    
    // Apply transformation to structured era format (from ChainDataLoader)
    return transformModelsToStructuredEra(rawModels);
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
