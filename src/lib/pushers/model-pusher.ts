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
function areModelsDifferent(sourceModel: mgmtApi.Model, targetModel: mgmtApi.Model, shouldLogDiffs: boolean): boolean {
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
    delete sourceCopy.contentDefinitionTypeName;
    delete targetCopy.contentDefinitionTypeName;
    // CRITICAL FIX: DO NOT delete contentDefinitionTypeID - it distinguishes pageModule vs contentModule
    // delete (sourceCopy as any).contentDefinitionTypeID;
    // delete (targetCopy as any).contentDefinitionTypeID;
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
    const normalizeFieldSettings = (fields: mgmtApi.ModelField[]) => {
        fields.forEach(field => {
            if (field.settings) {
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

    normalizeFieldSettings(sourceCopy.fields);
    normalizeFieldSettings(targetCopy.fields);

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
  
    // First, process existing target fields and update them with source settings
    existingModel.fields.forEach((existingField) => {
        const sourceFieldIndex = sourceModel.fields.findIndex((sourceField) => sourceField.name === existingField.name);
  
        if (sourceFieldIndex !== -1) {
            // Field exists in both - merge settings from source into existing field structure
            existingField.settings = { ...existingField.settings, ...sourceModel.fields[sourceFieldIndex].settings };
            
            // Update other field properties from source while preserving target fieldID
            existingField.label = sourceModel.fields[sourceFieldIndex].label;
            existingField.type = sourceModel.fields[sourceFieldIndex].type;
            existingField.labelHelpDescription = sourceModel.fields[sourceFieldIndex].labelHelpDescription;
            existingField.designerOnly = sourceModel.fields[sourceFieldIndex].designerOnly;
            existingField.isDataField = sourceModel.fields[sourceFieldIndex].isDataField;
            existingField.editable = sourceModel.fields[sourceFieldIndex].editable;
            existingField.hiddenField = sourceModel.fields[sourceFieldIndex].hiddenField;
            existingField.description = sourceModel.fields[sourceFieldIndex].description;
            existingField.itemOrder = sourceModel.fields[sourceFieldIndex].itemOrder;
            
            updatedFields.push(existingField);
        } else {
            // Field exists only in target - keep it as is
            updatedFields.push(existingField);
        }
    });
  
    // Second, add new fields from source that don't exist in target
    sourceModel.fields.forEach((sourceField) => {
        const existingFieldIndex = existingModel.fields.findIndex((existingField) => existingField.name === sourceField.name);
  
        if (existingFieldIndex === -1) {
            // Field exists only in source - add it (without fieldID since target will generate it)
            const newField = { ...sourceField };
            delete newField.fieldID; // Let target generate new fieldID
            updatedFields.push(newField);
        }
    });
  
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
    forceSync: boolean = false,
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
            // Always use the original reference name for fetching to ensure consistency
            existingModel = await apiClient.modelMethods.getModelByReferenceName(originalModelReferenceName, targetGuid);

            if (existingModel) {
                referenceMapper.addMapping('model', model, existingModel);
                
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

                if (forceSync || areModelsDifferent(fixedModel, fixedExistingModel, logModelDiffs)) {
                    try {
                        // Use the new legacy-based update logic that properly merges fields
                        const modelPayload = { ...fixedModel, id: existingModel.id };
                        
                        // If overrideFields are specified, replace the merged fields with them
                        if (overrideFields !== undefined) {
                            modelPayload.fields = overrideFields;
                        }
                        
                        modelPayload.referenceName = originalModelReferenceName; // Ensure original reference name in update payload
                        
                        const updatedModel = await apiClient.modelMethods.saveModel(modelPayload, targetGuid);
                        referenceMapper.addMapping('model', model, updatedModel); // Update mapping with newly updated model
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
