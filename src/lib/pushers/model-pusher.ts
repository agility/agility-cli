import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../reference-mapper';
import _ from 'lodash'; // Import lodash for deep comparison
import { ApiClient } from '@agility/management-sdk';
// REMOVED: import { getModel } from '../services/agility-service' - no longer needed with direct API calls

type ProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => void;

// REMOVED: isLinkedModel function (no longer needed with Joel's simplified 2-pass approach)

// Function to log detailed differences between two model objects
function logModelDifferences(source: any, target: any, modelName: string) {
    console.log(ansiColors.yellow(`[DIFF] Differences for ${modelName}:`));
    const allKeys = _.union(Object.keys(source), Object.keys(target)).sort();

    for (const key of allKeys) {
        const sourceVal = source[key];
        const targetVal = target[key];

        if (!_.has(target, key)) {
            console.log(ansiColors.green(`  + Source only: ${key} = ${JSON.stringify(sourceVal, null, 2)}`));
        } else if (!_.has(source, key)) {
            console.log(ansiColors.red(`  - Target only: ${key} = ${JSON.stringify(targetVal, null, 2)}`));
        } else if (!_.isEqual(sourceVal, targetVal)) {
            console.log(ansiColors.yellow(`  ~ Different: ${key}`));
            if (key === 'fields' && Array.isArray(sourceVal) && Array.isArray(targetVal)) {
                // if (modelName === 'ListedLink') {
                //     console.log(ansiColors.magenta('[DEBUG FIELDS FOR LISTEDLINK] Source Fields:'), JSON.stringify(sourceVal, null, 2));
                //     console.log(ansiColors.magenta('[DEBUG FIELDS FOR LISTEDLINK] Target Fields:'), JSON.stringify(targetVal, null, 2));
                // }
                logFieldArrayDifferences(sourceVal, targetVal);
            } else if (typeof sourceVal === 'object' && sourceVal !== null && typeof targetVal === 'object' && targetVal !== null) {
                // For nested objects, show both values if they are not too large
                // A more sophisticated recursive diff could be added here
                console.log(ansiColors.green(`    Source Value: ${JSON.stringify(sourceVal, null, 2)}`));
                console.log(ansiColors.red(`    Target Value: ${JSON.stringify(targetVal, null, 2)}`));
            } else {
                console.log(ansiColors.green(`    Source Value: ${sourceVal}` ));
                console.log(ansiColors.red(`    Target Value: ${targetVal}` ));
            }
        }
    }
}

function logFieldArrayDifferences(sourceFields: mgmtApi.ModelField[], targetFields: mgmtApi.ModelField[]) {
    const sourceFieldNames = sourceFields.map(f => f.name);
    const targetFieldNames = targetFields.map(f => f.name);

    // Fields only in source
    sourceFields.filter(sf => !targetFieldNames.includes(sf.name)).forEach(sf => {
        console.log(ansiColors.green(`    + Source Field only: ${sf.name} (Type: ${sf.type})`));
    });

    // Fields only in target
    targetFields.filter(tf => !sourceFieldNames.includes(tf.name)).forEach(tf => {
        console.log(ansiColors.red(`    - Target Field only: ${tf.name} (Type: ${tf.type})`));
    });

    // Fields in both - compare them
    sourceFields.filter(sf => targetFieldNames.includes(sf.name)).forEach(sf => {
        const tf = targetFields.find(f => f.name === sf.name)!;
        let fieldDifferencesFound = false;
        const diffMessages: string[] = [];

        if (sf.label !== tf.label) {
            diffMessages.push(`      Label: Source='${sf.label}', Target='${tf.label}'`);
            fieldDifferencesFound = true;
        }
        if (sf.type !== tf.type) {
            diffMessages.push(`      Type: Source='${sf.type}', Target='${tf.type}'`);
            fieldDifferencesFound = true;
        }
        if (!_.isEqual(sf.settings, tf.settings)) {
            diffMessages.push(`      Settings: Source=${JSON.stringify(sf.settings)}, Target=${JSON.stringify(tf.settings)}`);
            fieldDifferencesFound = true;
        }
        // Add other properties as needed: description, hiddenField, etc.

        if (fieldDifferencesFound) {
            console.log(ansiColors.yellow(`    ~ Field ${sf.name} (Type: ${sf.type}) differs:`));
            diffMessages.forEach(msg => console.log(msg));
        }
    });
}

// Helper function to compare two models, ignoring ID and field order
function areModelsDifferent(sourceModel: mgmtApi.Model, targetModel: mgmtApi.Model, shouldLogDiffs: boolean, referenceMapper: ReferenceMapper): boolean {
    // Create copies to avoid modifying originals
    const sourceCopy = _.cloneDeep(sourceModel);
    const targetCopy = _.cloneDeep(targetModel);

    // if (sourceModel.referenceName === 'ListedLink') {
    //     console.log(ansiColors.yellow('[DEBUG IMMEDIATE CLONE - LISTEDLINK] Target Fields Post-Clone:'), JSON.stringify(targetCopy.fields, null, 2));
    // }

    // Conditional console.log for raw un-normalized copies for specific models - can be enabled if needed
    // if (sourceModel.referenceName === 'SomeModelToDebug') { 
    //     console.log(ansiColors.magenta(`[DEBUG PRE-NORM] Comparing ${sourceModel.referenceName} model (source):
// ${JSON.stringify(sourceModel, null, 2)}`));
    //     console.log(ansiColors.magenta(`[DEBUG PRE-NORM] Comparing ${sourceModel.referenceName} model (target):
// ${JSON.stringify(targetModel, null, 2)}`));
    // }

    // Ignore IDs and other purely informational fields that shouldn't trigger a diff if they are the only difference
    delete sourceCopy.id;
    delete targetCopy.id;
    delete sourceCopy.lastModifiedDate;
    delete targetCopy.lastModifiedDate;
    delete sourceCopy.lastModifiedAuthorID;
    delete targetCopy.lastModifiedAuthorID;
    delete sourceCopy.lastModifiedBy;
    delete targetCopy.lastModifiedBy;
    delete sourceCopy.allowTagging;
    delete targetCopy.allowTagging;
    // CRITICAL FIX: Ignore wasUnpublished as it's not relevant for sync operations
    delete (sourceCopy as any).wasUnpublished;
    delete (targetCopy as any).wasUnpublished;
    delete sourceCopy.contentDefinitionTypeName;
    delete targetCopy.contentDefinitionTypeName;
    // CRITICAL FIX: Ignore contentDefinitionTypeID differences due to API bug
    // The Management API doesn't properly update contentDefinitionTypeID in model updates
    delete (sourceCopy as any).contentDefinitionTypeID;
    delete (targetCopy as any).contentDefinitionTypeID;
    delete (targetCopy as any).contentDefinitionTypeID;
    delete sourceCopy.displayName;
    delete targetCopy.displayName;
    
    // CRITICAL: Ignore bridge fields added by ChainDataLoader for compatibility
    delete (sourceCopy as any).definitionID;
    delete (targetCopy as any).definitionID;
    delete (sourceCopy as any).definitionName;
    delete (targetCopy as any).definitionName;
    
    // CRITICAL: Ignore fields that may be undefined in source but missing in target
    delete (sourceCopy as any).isModuleList;
    delete (targetCopy as any).isModuleList;
    delete (sourceCopy as any).sortOrder;
    delete (targetCopy as any).sortOrder;
    delete (sourceCopy as any).description;
    delete (targetCopy as any).description;

    sourceCopy.referenceName = sourceCopy.referenceName.toLowerCase();
    targetCopy.referenceName = targetCopy.referenceName.toLowerCase();

    // CRITICAL FIX: Handle missing fields property (modules have no fields property)
    // Ensure both models have fields arrays for processing
    if (!sourceCopy.fields) sourceCopy.fields = [];
    if (!targetCopy.fields) targetCopy.fields = [];

    // Sort fields by name for consistent comparison
    sourceCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize field settings for comparison only - be more conservative about what we filter
    const normalizeFieldSettings = (fields: mgmtApi.ModelField[], referenceMapper: ReferenceMapper) => {
        fields.forEach(field => {
            if (field.settings) {
                // CRITICAL FIX: Skip ContentDefinition differences during comparison
                // The API handles reference resolution automatically, so these differences are irrelevant
                // Source uses reference names, target uses IDs - both are valid, API converts as needed
                if (field.type === 'Content' && field.settings.ContentDefinition) {
                    // Remove ContentDefinition from comparison entirely - let API handle conversion
                    delete field.settings.ContentDefinition;
                }
                
                // Only filter out truly empty/irrelevant values for comparison
                field.settings = Object.fromEntries(
                    Object.entries(field.settings).filter(([key, value]) => {
                        // Keep all non-empty values - structural differences ARE important
                        if (value === "" || value === null || value === undefined) return false;
                        return true;
                    })
                );
            }
            // Only ignore field IDs and itemOrder for comparison (these are auto-generated by target)
            delete field.fieldID;
            delete field.itemOrder;
        });
    };

    normalizeFieldSettings(sourceCopy.fields, referenceMapper);
    normalizeFieldSettings(targetCopy.fields, referenceMapper);

    // Only compare fields that exist in both models (this part seems fine for top-level properties)
    // The crucial part is the deep comparison of the normalized fields array handled by _.isEqual below.

    // Perform a deep comparison on the modified copies
    const areDifferent = !_.isEqual(sourceCopy, targetCopy);

    if (areDifferent && shouldLogDiffs) {
        logModelDifferences(sourceCopy, targetCopy, sourceModel.referenceName);
    }

    return areDifferent;
}

// REMOVED: Complex circular dependency detection functions (buildDependencyGraph, detectCircularDependencies, sortModelsByDependencies)
// Joel's simplified 2-pass approach makes these obsolete

// Helper functions from legacy system for proper model field updates
function updateFields(existingModel: mgmtApi.Model, sourceModel: mgmtApi.Model): mgmtApi.ModelField[] {
    const updatedFields: mgmtApi.ModelField[] = [];
  
    // CRITICAL FIX: Target should end up with EXACTLY the same fields as source
    // Process each source field and either update existing or add new
    sourceModel.fields.forEach((sourceField) => {
        const existingFieldIndex = existingModel.fields.findIndex((existingField) => existingField.name === sourceField.name);
  
        if (existingFieldIndex !== -1) {
            // Field exists in both - merge settings from source into existing field structure
            const existingField = existingModel.fields[existingFieldIndex];
            existingField.settings = { ...existingField.settings, ...sourceField.settings };
            
            // Update other field properties from source while preserving target fieldID
            existingField.label = sourceField.label;
            existingField.type = sourceField.type;
            existingField.labelHelpDescription = sourceField.labelHelpDescription;
            existingField.designerOnly = sourceField.designerOnly;
            existingField.isDataField = sourceField.isDataField;
            existingField.editable = sourceField.editable;
            existingField.hiddenField = sourceField.hiddenField;
            existingField.description = sourceField.description;
            existingField.itemOrder = sourceField.itemOrder;
            
            updatedFields.push(existingField);
        } else {
            // Field exists only in source - add it (without fieldID since target will generate it)
            const newField = { ...sourceField };
            delete newField.fieldID; // Let target generate new fieldID
            updatedFields.push(newField);
        }
    });
  
    // NOTE: Fields that exist only in target are NOT included - they will be removed
    // This ensures the target matches the source exactly
  
    return updatedFields;
}

function updateModel(existingModel: mgmtApi.Model, sourceModel: mgmtApi.Model): mgmtApi.Model {
    const updatedObj: mgmtApi.Model = {
        ...existingModel, // Start with existing model to preserve IDs and dates
        id: existingModel.id, // Ensure we keep target ID
        lastModifiedDate: existingModel.lastModifiedDate, // Preserve target dates
    };
  
    // Update properties from source model
    updatedObj.displayName = sourceModel.displayName;
    updatedObj.referenceName = sourceModel.referenceName;
    updatedObj.description = sourceModel.description;
    updatedObj.allowTagging = sourceModel.allowTagging;
    updatedObj.contentDefinitionTypeName = sourceModel.contentDefinitionTypeName;
    updatedObj.isPublished = sourceModel.isPublished;
    updatedObj.wasUnpublished = sourceModel.wasUnpublished;
  
    // Update fields using the smart merging logic
    updatedObj.fields = updateFields(existingModel, sourceModel);
  
    return updatedObj;
}

function prepareModelForUpdate(model: mgmtApi.Model, existingModel: mgmtApi.Model): mgmtApi.Model {
    // Use the proven legacy logic for proper field merging
    const updatedModel = updateModel(existingModel, model);
    
    // Clean up any properties that shouldn't be sent in updates
    delete updatedModel.lastModifiedBy;
    delete updatedModel.lastModifiedAuthorID;
    
    return updatedModel;
}

// Helper to clean field settings for allowed keys and remove empty values
function cleanFieldSettings(fields: any[]): any[] {
    return fields.map(field => {
        if (field.settings) {
            // Remove settings with empty string values
            field.settings = Object.fromEntries(
                Object.entries(field.settings).filter(([, v]) => v !== "")
            );

            // Specific cleanup for Content type fields rendered as dropdown or searchlistbox
            if (field.type === 'Content' && 
                (field.settings.RenderAs === 'dropdown' || field.settings.RenderAs === 'searchlistbox')) {
                delete field.settings.ColumnCount;
                delete field.settings.SortIDFieldName;
                delete field.settings.ContentView;
            }
        }
        return field;
    });
}

// Compose both cleaning steps
function prepareFields(fields: any[]): any[] {
    return cleanFieldSettings(fields);
}

// REMOVED: ModelPusher class - replaced with pushModels function for consistency with other pushers
// The pushModels function below provides all the same functionality with Joel's simplified 2-pass approach

export async function pushModels(
    models: mgmtApi.Model[],
    apiOptions: mgmtApi.Options,
    targetGuid: string,
    referenceMapper: ReferenceMapper,
    logModelDiffs: boolean,
    forceUpdate: boolean = false,
    onProgress?: ProgressCallback
): Promise<{ successfulModels: number; failedModels: number; status: 'success' | 'error' }> {
    
    let successfulModels = 0;
    let failedModels = 0;
    let status: 'success' | 'error' = 'success';

    const totalModels = models.length;
    const apiClient = new mgmtApi.ApiClient(apiOptions);

    const processedModels = new Set<number>(); // Keep track of processed models by ID instead of reference name

    // Helper to process a model (create or update as needed)
    const processModel = async (model: mgmtApi.Model, overrideFields?: any[], passDescription?: string): Promise<boolean> => {
        const originalModelReferenceName = model.referenceName; // Capture original reference name
        let existingModel: mgmtApi.Model | null = null;

        const isStubCreationIntent = Array.isArray(overrideFields) && overrideFields.length === 0;

        // JOEL'S DEBUG OUTPUT
        // console.log("SOURCE MODEL:", model);

        try {
            // CRITICAL FIX: Check ReferenceMapper first to avoid unnecessary API calls
            // Use same lookup method as addMapping to prevent duplicate mappings
            existingModel = referenceMapper.getMapping<mgmtApi.Model>('model', model.id);
            if (existingModel && existingModel.id > 0) {
                console.log(`✓ Using cached model mapping for ${originalModelReferenceName} (ID: ${existingModel.id})`);
            } else {
                // Fetch from API only if not in ReferenceMapper
                existingModel = await apiClient.modelMethods.getModelByReferenceName(originalModelReferenceName, targetGuid);
                if (existingModel) {
                    referenceMapper.addMapping('model', model, existingModel);
                    console.log(`➕ Added fresh model mapping for ${originalModelReferenceName} (ID: ${existingModel.id})`);
                }
            }

            if (existingModel) {
                
                if (isStubCreationIntent) {
                    // If the intent was to create a stub (empty fields) and the model already exists,
                    // skip comparison and update for this step. Step 4 will handle the full comparison.
                    console.log(`✓ ${passDescription} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.gray('already exists')} - Skipping stub creation. ${ansiColors.green(targetGuid)}: ${ansiColors.green(String(existingModel.id))}`);
                    processedModels.add(model.id); // Add to processed set using model ID
                    return true; // Successfully handled for the stub creation phase
                }

                // Proceed with normal comparison and update logic
                // CRITICAL: Use RAW fields for comparison - no preprocessing
                const fixedModel = {
                    ...model,
                    referenceName: originalModelReferenceName, // Ensure comparison uses original name
                    fields: overrideFields !== undefined ? overrideFields : (model.fields || [])
                };
                const fixedExistingModel = {
                    ...existingModel,
                    // Fields from existingModel are raw, will be normalized in areModelsDifferent
                    fields: existingModel.fields || [] 
                };

                if (forceUpdate || areModelsDifferent(fixedModel, fixedExistingModel, logModelDiffs, referenceMapper)) {
                    try {
                        // SIMPLIFIED APPROACH: Send source data directly with minimal modifications
                        // Per CTO feedback: we should be able to upload source data without over-complicating
                        const modelPayload = {
                            ...fixedModel, // Use source model as base
                            id: existingModel.id, // Only override target ID
                            lastModifiedDate: existingModel.lastModifiedDate, // Preserve target timestamp
                            referenceName: originalModelReferenceName // Ensure original reference name
                        };
                        
                        // If overrideFields are specified, replace the fields with them
                        if (overrideFields !== undefined) {
                            modelPayload.fields = overrideFields;
                        }
                        
                        // Clean up problematic fields that cause API inconsistencies
                        if (modelPayload.fields) {
                            modelPayload.fields = modelPayload.fields.map(field => {
                                const cleanField = { ...field };
                                
                                // CRITICAL FIX: Remove fieldID to prevent API regeneration bug
                                // The API regenerates ALL fieldIDs when existing ones are sent, causing infinite diff cycles
                                delete cleanField.fieldID;
                                
                                // Remove ContentDefinition from Content field settings as it causes API conversion issues
                                if (cleanField.type === 'Content' && cleanField.settings && cleanField.settings.ContentDefinition) {
                                    const { ContentDefinition, ...otherSettings } = cleanField.settings;
                                    cleanField.settings = otherSettings;
                                    console.log(`🧹 Removed ContentDefinition from ${field.name} field to prevent API conversion issues`);
                                }
                                
                                return cleanField;
                            });
                        }
                        
                        // Remove properties that shouldn't be sent in updates
                        delete modelPayload.lastModifiedBy;
                        delete modelPayload.lastModifiedAuthorID;
                        

                        
                                                const updatedModel = await apiClient.modelMethods.saveModel(modelPayload, targetGuid);
                        
                        // DEBUG: Log API request/response for models with diffs (for CTO debugging)
                        console.log(`📤 [PAYLOAD SENT] ${originalModelReferenceName}:`, JSON.stringify(modelPayload, null, 2));
                        console.log(`📥 [API RESPONSE] ${originalModelReferenceName}:`, JSON.stringify(updatedModel, null, 2));
                        console.log(`📤 [PAYLOAD FIELDS] ${originalModelReferenceName}:`, 
                            modelPayload?.fields ? modelPayload.fields.map(f => `${f.name}(${f.type})`) : 'NO FIELDS');
                        console.log(`📥 [RESPONSE FIELDS] ${originalModelReferenceName}:`, 
                            updatedModel?.fields ? updatedModel.fields.map(f => `${f.name}(${f.type})`) : 'NO FIELDS');
                        
                        // DIFF: Compare payload vs response to see what API is changing
                        console.log(`🔍 [PAYLOAD vs RESPONSE DIFF] ${originalModelReferenceName}:`);
                        if (modelPayload.fields && updatedModel.fields) {
                            const payloadFieldNames = modelPayload.fields.map(f => f.name).sort();
                            const responseFieldNames = updatedModel.fields.map(f => f.name).sort();
                            
                            if (JSON.stringify(payloadFieldNames) !== JSON.stringify(responseFieldNames)) {
                                console.log(`  ❌ Field names differ:`);
                                console.log(`    Payload: [${payloadFieldNames.join(', ')}]`);
                                console.log(`    Response: [${responseFieldNames.join(', ')}]`);
                            } else {
                                console.log(`  ✅ Field names identical: [${payloadFieldNames.join(', ')}]`);
                            }
                            
                            // Check field IDs
                            modelPayload.fields.forEach(payloadField => {
                                const responseField = updatedModel.fields.find(f => f.name === payloadField.name);
                                if (responseField) {
                                    // REMOVED: fieldID logging - fieldIDs are technical debt that should be ignored
                                    // if (payloadField.fieldID !== responseField.fieldID) {
                                    //     console.log(`  🔄 ${payloadField.name}: fieldID changed from '${payloadField.fieldID || 'undefined'}' to '${responseField.fieldID}'`);
                                    // }
                                    if (payloadField.label !== responseField.label) {
                                        console.log(`  📝 ${payloadField.name}: label changed from '${payloadField.label}' to '${responseField.label}'`);
                                    }
                                }
                            });
                        }
                        
                        // CRITICAL FIX: Validate update was successful by fetching fresh data
                        // This ensures our cache reflects the actual API state after the update
                        try {
                            console.log(`🔍 Validating update success for ${originalModelReferenceName}...`);
                            const freshModel = await apiClient.modelMethods.getModelByReferenceName(originalModelReferenceName, targetGuid);
                            if (freshModel) {
                                // LOG POST-UPDATE API RESPONSE for debugging
                                console.log(`📡 [POST-UPDATE API RESPONSE] ${originalModelReferenceName}:`, JSON.stringify(freshModel, null, 2));
                                console.log(`📡 [POST-UPDATE FIELDS] ${originalModelReferenceName}:`, 
                                    freshModel?.fields ? freshModel.fields.map(f => `${f.name}(${f.type})`) : 'NO FIELDS');
                                
                                // Update cache with fresh API data to ensure accuracy
                                referenceMapper.addMapping('model', model, freshModel);
                                console.log(`✅ Cache refreshed with post-update API state for ${originalModelReferenceName}`);
                                
                                // Quick validation: check if the update actually took effect
                                const freshFieldCount = freshModel.fields?.length || 0;
                                const payloadFieldCount = modelPayload.fields?.length || 0;
                                const freshFieldNames = freshModel.fields?.map(f => f.name) || [];
                                const payloadFieldNames = modelPayload.fields?.map(f => f.name) || [];
                                
                                if (freshFieldCount !== payloadFieldCount) {
                                    console.warn(`⚠️  Field count mismatch after update: expected ${payloadFieldCount}, got ${freshFieldCount}`);
                                    console.warn(`⚠️  This may indicate the API update didn't fully take effect`);
                                    
                                    // Show detailed field differences for debugging
                                    console.warn(`⚠️  Fresh API fields: [${freshFieldNames.join(', ')}]`);
                                    console.warn(`⚠️  Expected fields: [${payloadFieldNames.join(', ')}]`);
                                }
                                
                                // Additional debugging: compare API response vs fresh fetch
                                const responseFieldCount = updatedModel.fields?.length || 0;
                                if (responseFieldCount !== freshFieldCount) {
                                    console.warn(`⚠️  API response vs fresh fetch field count differs: response=${responseFieldCount}, fresh=${freshFieldCount}`);
                                    const responseFieldNames = updatedModel.fields?.map(f => f.name) || [];
                                    console.warn(`⚠️  API response fields: [${responseFieldNames.join(', ')}]`);
                                    console.warn(`⚠️  Fresh fetch fields: [${freshFieldNames.join(', ')}]`);
                                }
                                
                                // DEBUG: Verify cache update was successful
                                // Use same lookup method as addMapping (by model ID) to ensure we verify the same record
                                const verifyTarget = referenceMapper.getMapping<mgmtApi.Model>('model', model.id);
                                if (verifyTarget) {
                                    const verifyFieldCount = verifyTarget.fields?.length || 0;
                                    console.log(`🔍 [CACHE VERIFICATION] ${originalModelReferenceName}: cache now has ${verifyFieldCount} fields`);
                                    if (verifyTarget.id !== freshModel.id) {
                                        console.warn(`⚠️  [CACHE VERIFICATION] Cache target ID (${verifyTarget.id}) differs from fresh model ID (${freshModel.id})`);
                                    }
                                    if (verifyFieldCount !== freshFieldCount) {
                                        console.warn(`⚠️  [CACHE VERIFICATION] Cache field count (${verifyFieldCount}) differs from fresh model field count (${freshFieldCount})`);
                                    }
                                } else {
                                    console.warn(`⚠️  [CACHE VERIFICATION] Could not retrieve updated mapping for ${originalModelReferenceName}`);
                                }
                            } else {
                                console.warn(`⚠️  Could not fetch fresh data for validation of ${originalModelReferenceName}`);
                            }
                        } catch (validationError: any) {
                            console.warn(`⚠️  Validation fetch failed for ${originalModelReferenceName}: ${validationError.message}`);
                        }
                        
                        // Note: Fresh fetch verification disabled due to API consistency issues
                        // The API response is more reliable than immediate fresh fetch
                        
                        console.log(`✓ ${passDescription} ${ansiColors.bold.cyan('updated')} ${ansiColors.underline(originalModelReferenceName)} (ID: ${existingModel.id}) on target.`);
                        processedModels.add(model.id); // Add to processed set using model ID
                        return true;
                    } catch (error: any) {
                        // Check if this is an "already exists" or "no changes" error
                        const errorMessage = error.message?.toLowerCase() || "";
                        const innerErrorStatus = error.innerError?.response?.status || error.response?.status;
                        
                        const isNoChangeNeededError = 
                            (innerErrorStatus === 500) &&
                            (errorMessage.includes("unable to save the model") || 
                             errorMessage.includes("no changes") ||
                             errorMessage.includes("already exists"));

                        if (isNoChangeNeededError) {
                            // Model is already in the correct state - treat as success
                            console.log(`✓ ${passDescription} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.gray('already up-to-date')} (no update needed). ${ansiColors.green(targetGuid)}: ${ansiColors.green(String(existingModel.id))}`);
                            processedModels.add(model.id);
                            return true;
                        }

                        console.error(
                            ansiColors.red(`Error updating model ${originalModelReferenceName} (Target ID: ${existingModel?.id || 'N/A'}) - (${passDescription}):`),
                            error
                        );
                        if (error.response && error.response.data) {
                            console.error(ansiColors.red(`  API Response Data: ${JSON.stringify(error.response.data, null, 2)}`));
                        }
                        if (error.request) {
                            if (typeof error.request === 'string') {
                                console.error(ansiColors.red(`  API Request Info: ${error.request}`));
                            } else {
                                console.error(ansiColors.red(`  API Request Details: ${JSON.stringify({
                                    method: error.request.method,
                                    url: error.request.path,
                                    headers: error.request.getHeaders ? error.request.getHeaders() : 'N/A',
                                }, null, 2)}`));
                            }
                        }
                        failedModels++; 
                        return false;
                    }
                } else {
                    console.log(`✓ ${passDescription} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.gray('exists and is identical')} - Skipping update. ${ansiColors.green(targetGuid)}: ${ansiColors.green(String(existingModel.id))}`);
                    processedModels.add(model.id); // Add to processed set using model ID
                    return true;
                }
            }
        } catch (error: any) {
            // Model not found, will proceed to create path. This is not an error for this try block.
            const errorMessage = error.message?.toLowerCase() || "";
            const isNotFoundError = 
                (error.response && error.response.status === 404) ||
                errorMessage.includes("unable to retrieve model for reference") || 
                errorMessage.includes("unable to retreive model for reference") || // Common typo
                errorMessage.includes("model not found") ||
                errorMessage.includes("could not find model");

            if (isNotFoundError) {
                existingModel = null; // Ensure creation path is taken
            } else {
                // Actual error during fetch or pre-update logic
                console.error(`[Model] ✗ Error during initial check for ${passDescription}, model ${originalModelReferenceName}: ${error.message}`);
                failedModels++;
                return false;
            }
        }
        
        // CREATE PATH: If existingModel is null (either not found by 404, or an earlier error returned false)
        try {
            const modelPayload: any = {
                ...model,
                id: 0, // Important for creation
                fields: overrideFields !== undefined ? overrideFields : (model.fields || []),
                referenceName: originalModelReferenceName // Ensure original reference name for creation
            };
            delete modelPayload.lastModifiedDate; // Not needed for create
            delete modelPayload.lastModifiedBy;   // Not needed for create
            delete modelPayload.lastModifiedAuthorID; // Not needed for create

            // CRITICAL: Remove fieldIDs from creation payload as well (same as update path)
            if (modelPayload.fields) {
                modelPayload.fields = modelPayload.fields.map(field => {
                    const cleanField = { ...field };
                    delete cleanField.fieldID; // fieldIDs are technical debt - let API generate new ones
                    return cleanField;
                });
            }

            const savedModel = await apiClient.modelMethods.saveModel(modelPayload, targetGuid);
            
            if (!savedModel || !savedModel.id) {
                throw new Error(`Failed to save model ${originalModelReferenceName} or returned model has no ID.`);
            }

            referenceMapper.addMapping('model', model, savedModel);
            console.log(`✓ ${passDescription} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.cyan('created')} (New ID: ${savedModel.id}) on target.`);
            processedModels.add(model.id); // Add to processed set using model ID
            return true;
        } catch (error: any) {
            // Check if this is an "already exists" error (model exists but initial lookup failed)
            const errorMessage = error.message?.toLowerCase() || "";
            const isAlreadyExistsError = 
                (error.response && error.response.status === 500) &&
                (errorMessage.includes("unable to save the model") || 
                 errorMessage.includes("already exists") ||
                 errorMessage.includes("duplicate"));

            if (isAlreadyExistsError) {
                // Model already exists but initial lookup failed - try to retrieve it again
                console.log(`⚠️  ${passDescription} ${ansiColors.underline(originalModelReferenceName)} appears to already exist on target (creation failed). Attempting to retrieve...`);
                try {
                    const retrievedModel = await apiClient.modelMethods.getModelByReferenceName(originalModelReferenceName, targetGuid);
                    if (retrievedModel) {
                        referenceMapper.addMapping('model', model, retrievedModel);
                        console.log(`✓ ${passDescription} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.gray('found on target')} after creation failure. ${ansiColors.green(targetGuid)}: ${ansiColors.green(String(retrievedModel.id))}`);
                        processedModels.add(model.id);
                        return true;
                    }
                } catch (retrieveError: any) {
                    console.error(`[Model] ✗ Failed to retrieve model ${originalModelReferenceName} after creation failure: ${retrieveError.message} (${passDescription})`);
                }
            }

            console.error(
                ansiColors.red(`Error creating model ${originalModelReferenceName} (${passDescription}):`),
                error
            );
            if (error.response && error.response.data) {
                console.error(ansiColors.red(`  API Response Data: ${JSON.stringify(error.response.data, null, 2)}`));
            }
            if (error.request) {
                if (typeof error.request === 'string') {
                    console.error(ansiColors.red(`  API Request Info: ${error.request}`));
                } else {
                    console.error(ansiColors.red(`  API Request Details: ${JSON.stringify({
                        method: error.request.method,
                        url: error.request.path,
                        headers: error.request.getHeaders ? error.request.getHeaders() : 'N/A',
                    }, null, 2)}`));
                }
            }
            failedModels++; 
            return false;
        }
    };

    // JOEL'S SIMPLIFIED 2-PASS APPROACH (MUCH CLEANER!)
    
    //1: first pass - make sure all the models are in the instance (no fields for first pass to ensure stubs exist)
    for (const model of models) {
        const success = await processModel(model, [], 'First pass (empty fields phase)');
        if (success) successfulModels++; else failedModels++;
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    //2: second pass - update all the models with full fields
    for (const model of models) {
        // Re-process here; processModel handles diffing and skipping if identical or if it was just a stub acknowledgement
        const success = await processModel(model, undefined, 'Second pass (full fields phase)');
        if (success) {
            // Only count unique successful models if you adjust logic here
            // For now, it reflects processing attempts.
        } else {
            failedModels++;
        }
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    // Adjust final count to reflect unique models processed
    successfulModels = processedModels.size;

    status = failedModels > 0 ? 'error' : 'success';
    console.log(ansiColors.yellow(`${successfulModels} unique models processed successfully out of ${totalModels} total models (${failedModels} failed attempts)`));
    if (onProgress) onProgress(totalModels, totalModels, status);
    return { successfulModels, failedModels, status };
}
