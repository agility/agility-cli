import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../mapper'; // Corrected path
import _ from 'lodash'; // Import lodash for deep comparison

type ProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => void;

// Helper function to check if a model is linked (based on push_new.ts logic)
function isLinkedModel(model: mgmtApi.Model): boolean {
    return model.fields?.some(field => field.type === 'Content' && field.settings?.['ContentDefinition']) ?? false;
}

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
    delete (sourceCopy as any).contentDefinitionTypeID;
    delete (targetCopy as any).contentDefinitionTypeID;
    delete sourceCopy.displayName;
    delete targetCopy.displayName;

    sourceCopy.referenceName = sourceCopy.referenceName.toLowerCase();
    targetCopy.referenceName = targetCopy.referenceName.toLowerCase();

    // Sort fields by name for consistent comparison
    sourceCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize field settings: remove empty string values from settings
    const normalizeFieldSettings = (fields: mgmtApi.ModelField[]) => {
        fields.forEach(field => {
            if (field.settings) {
                field.settings = Object.fromEntries(
                    Object.entries(field.settings).filter(([, value]) => value !== "")
                );
            }
            // Also ignore field IDs and itemOrder within each field object after settings normalization
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

// Helper function to build dependency graph for nested models
function buildDependencyGraph(models: mgmtApi.Model[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    models.forEach(model => {
        if (!isLinkedModel(model)) return;
        
        const dependencies = new Set<string>();
        model.fields?.forEach(field => {
            if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                dependencies.add(field.settings['ContentDefinition']);
            }
        });
        
        if (dependencies.size > 0) {
            graph.set(model.referenceName, dependencies);
        }
    });
    
    return graph;
}

// Helper function to detect circular dependencies
function detectCircularDependencies(graph: Map<string, Set<string>>): Set<string> {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const circularModels = new Set<string>();

    function dfs(node: string) {
        visited.add(node);
        recursionStack.add(node);

        const dependencies = graph.get(node) || new Set();
        Array.from(dependencies).forEach(dep => {
            if (!visited.has(dep)) {
                if (dfs(dep)) {
                    circularModels.add(node);
                }
            } else if (recursionStack.has(dep)) {
                circularModels.add(node);
            }
        });

        recursionStack.delete(node);
        return circularModels.has(node);
    }

    Array.from(graph.keys()).forEach(node => {
        if (!visited.has(node)) {
            dfs(node);
        }
    });

    return circularModels;
}

// Helper function to sort models by dependencies
function sortModelsByDependencies(models: mgmtApi.Model[]): mgmtApi.Model[] {
    const graph = buildDependencyGraph(models);
    const circularModels = detectCircularDependencies(graph);
    
    // Log circular dependencies
    if (circularModels.size > 0) {
        console.log(ansiColors.yellow('Circular dependencies detected in models:'));
        circularModels.forEach(model => {
            console.log(ansiColors.yellow(`- ${model}`));
        });
    }

    const visited = new Set<string>();
    const temp = new Set<string>();
    const sorted: string[] = [];
    
    function visit(node: string) {
        if (temp.has(node)) {
            // Skip circular dependencies
            return;
        }
        if (visited.has(node)) return;
        
        temp.add(node);
        const dependencies = graph.get(node) || new Set();
        dependencies.forEach(dep => visit(dep));
        temp.delete(node);
        visited.add(node);
        sorted.push(node);
    }
    
    // Start with non-linked models
    const normalModels = models.filter(m => !isLinkedModel(m));
    const linkedModels = models.filter(m => isLinkedModel(m));
    
    // Process normal models first
    normalModels.forEach(model => {
        if (!visited.has(model.referenceName)) {
            visit(model.referenceName);
        }
    });
    
    // Then process linked models
    linkedModels.forEach(model => {
        if (!visited.has(model.referenceName)) {
            visit(model.referenceName);
        }
    });
    
    // Return models in sorted order
    return sorted.map(refName => models.find(m => m.referenceName === refName)!);
}

// Helper function to prepare model for update
function prepareModelForUpdate(model: mgmtApi.Model, existingModel: mgmtApi.Model): mgmtApi.Model {
    // Create a clean copy of the model
    const modelCopy = _.cloneDeep(model);
    
    // Remove fields that might cause issues
    delete modelCopy.lastModifiedDate;
    delete modelCopy.lastModifiedBy;
    delete modelCopy.lastModifiedAuthorID;
    
    // Ensure we have the correct ID
    modelCopy.id = existingModel.id;
    
    // Ensure fields is an array
    modelCopy.fields = modelCopy.fields || [];
    
    // Clean up field properties and remove auto-generated hidden fields
    modelCopy.fields = modelCopy.fields.filter(field => {
        const isHiddenHelperField = field.hiddenField && 
                                    (field.name.endsWith('_TextField') || 
                                     field.name.endsWith('_ValueField') || 
                                     field.name.endsWith('_SortIdField'));
        return !isHiddenHelperField;
    }).map(field => {
        delete field.fieldID;
        delete field.itemOrder;
        return field;
    });
    
    return modelCopy;
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

export async function pushModels(
    models: mgmtApi.Model[],
    apiOptions: mgmtApi.Options,
    targetGuid: string,
    referenceMapper: ReferenceMapper,
    logModelDiffs: boolean,
    onProgress?: ProgressCallback
): Promise<{ successfulModels: number; failedModels: number; status: 'success' | 'error' }> {
    let successfulModels = 0;
    let failedModels = 0;
    let status: 'success' | 'error' = 'success';

    if (!models || models.length === 0) {
        console.log('No models found to push');
        return { successfulModels, failedModels, status };
    }

    const totalModels = models.length;
    const apiClient = new mgmtApi.ApiClient(apiOptions);

    // Detect circular dependencies
    const graph = buildDependencyGraph(models);
    const circularModelsSet = detectCircularDependencies(graph);
    
    const circularModels = models.filter(m => circularModelsSet.has(m.referenceName));
    const nonCircularModels = models.filter(m => !circularModelsSet.has(m.referenceName));

    const nonCircularNotLinkedModels = nonCircularModels.filter(m => !isLinkedModel(m));
    const nonCircularLinkedModels = nonCircularModels.filter(m => isLinkedModel(m)).reverse();
    // I reversed the order of this because of logical creation order by the user

    const processedModels = new Set<number>(); // Keep track of processed models by ID instead of reference name

    // Helper to process a model (create or update as needed)
    const processModel = async (model: mgmtApi.Model, isNormal: boolean, overrideFields?: any[], passDescription?: string): Promise<boolean> => {
        const originalModelReferenceName = model.referenceName; // Capture original reference name
        let existingModel: mgmtApi.Model | null = null;
        const modelType = passDescription || (isNormal ? 'Normal' : 'Nested'); // Use passDescription if available

        const isStubCreationIntent = Array.isArray(overrideFields) && overrideFields.length === 0;

        try {
            // Always use the original reference name for fetching to ensure consistency
            existingModel = await apiClient.modelMethods.getModelByReferenceName(originalModelReferenceName, targetGuid);

            if (existingModel) {
                referenceMapper.addRecord('model', model, existingModel); // model is source, existingModel is target
                
                if (isStubCreationIntent) {
                    // If the intent was to create a stub (empty fields) and the model already exists,
                    // skip comparison and update for this step. Step 4 will handle the full comparison.
                    // console.log(ansiColors.gray(`  [INFO] ${modelType} ${ansiColors.underline(originalModelReferenceName)} already exists. Full field comparison will occur in the next phase.`));
                    processedModels.add(model.id); // Add to processed set using model ID
                    return true; // Successfully handled for the stub creation phase
                }

                // Proceed with normal comparison and update logic
                const fixedModel = {
                    ...model,
                    referenceName: originalModelReferenceName, // Ensure comparison uses original name
                    fields: prepareFields(overrideFields !== undefined ? overrideFields : (model.fields || []))
                };
                const fixedExistingModel = {
                    ...existingModel,
                    // Fields from existingModel are raw, will be normalized in areModelsDifferent
                    fields: existingModel.fields || [] 
                };

                if (areModelsDifferent(fixedModel, fixedExistingModel, logModelDiffs)) {
                    try {
                        const modelPayload = prepareModelForUpdate(model, existingModel);
                        // ensure overrideFields are applied if present, else model's fields
                        if (overrideFields !== undefined) modelPayload.fields = prepareFields(overrideFields); 
                        else modelPayload.fields = prepareFields(modelPayload.fields || []);
                        
                        modelPayload.referenceName = originalModelReferenceName; // Ensure original reference name in update payload
                        
                        const updatedModel = await apiClient.modelMethods.saveModel(modelPayload, targetGuid);
                        referenceMapper.addRecord('model', model, updatedModel); // Update mapping with newly updated model
                        console.log(`✓ ${modelType} ${ansiColors.bold.cyan('updated')} ${ansiColors.underline(originalModelReferenceName)} (ID: ${existingModel.id}) on target.`);
                        processedModels.add(model.id); // Add to processed set using model ID
                        return true;
                    } catch (error: any) {
                        console.error(
                            ansiColors.red(`Error updating ${modelType.toLowerCase()} ${originalModelReferenceName} (Target ID: ${existingModel?.id || 'N/A'}):`),
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
                    console.log(`✓ ${modelType} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.gray('exists and is identical')} - Skipping update. ${ansiColors.green(targetGuid)}: ${ansiColors.green(String(existingModel.id))}`);
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
                // console.log(ansiColors.blue(`  [INFO] Model ${originalModelReferenceName} not found on target (Error: ${error.message}). Will attempt to create.`));
                existingModel = null; // Ensure creation path is taken
            } else {
                // Actual error during fetch or pre-update logic
                console.error(`[Model] ✗ Error during initial check for ${modelType.toLowerCase()} model ${originalModelReferenceName}: ${error.message}`);
                failedModels++;
                return false;
            }
        }
        
        // CREATE PATH: If existingModel is null (either not found by 404, or an earlier error returned false)
        try {
            const modelPayload: any = {
                ...model,
                id: 0, // Important for creation
                fields: prepareFields(overrideFields !== undefined ? overrideFields : (model.fields || [])),
                referenceName: originalModelReferenceName // Ensure original reference name for creation
            };
            delete modelPayload.lastModifiedDate; // Not needed for create
            delete modelPayload.lastModifiedBy;   // Not needed for create
            delete modelPayload.lastModifiedAuthorID; // Not needed for create

            const savedModel = await apiClient.modelMethods.saveModel(modelPayload, targetGuid);
            referenceMapper.addRecord('model', model, savedModel);
            console.log(`✓ ${modelType} ${ansiColors.underline(originalModelReferenceName)} ${ansiColors.bold.cyan('created')} (New ID: ${savedModel.id}) on target.`);
            processedModels.add(model.id); // Add to processed set using model ID
            return true;
        } catch (error: any) {
            console.error(
                ansiColors.red(`Error creating ${modelType.toLowerCase()} ${originalModelReferenceName}:`),
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

    // 1. Process non-circular, non-linked models
    for (const model of nonCircularNotLinkedModels) {
        if (processedModels.has(model.id)) continue; // Skip if already processed
        const isNormal = !isLinkedModel(model);
        const success = await processModel(model, isNormal, undefined, 'Normal Model');
        if (success) successfulModels++; else failedModels++;
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    // 2. Create circular models with empty fields first (ensures all stubs exist for linking)
    for (const model of circularModels) {
        if (processedModels.has(model.id)) continue; // Skip if already processed
        const isNormal = !isLinkedModel(model); // isLinkedModel is true for circular
        // Pass undefined for overrideFields to let processModel determine if it needs to be a stub
        const success = await processModel(model, isNormal, [], 'Circular Linked Model (empty fields phase)');
        if (success) successfulModels++; else failedModels++;
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    // 3. Update circular models with full fields (now that all stubs exist)
    for (const model of circularModels) {
        // We re-process here; processModel handles diffing and skipping if identical or if it was just a stub acknowledgement
        const isNormal = !isLinkedModel(model); // isLinkedModel is true for circular
        const success = await processModel(model, isNormal, model.fields || [], 'Circular Linked Model (update fields)');
        if (success) successfulModels++; else failedModels++; // Note: successfulModels might be incremented twice for the same circular model (stub then full), consider adjusting if only unique model count is desired.
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    // 4. Process non-circular, linked models (these can now safely link to fully defined circular models)
    for (const model of nonCircularLinkedModels) {
        if (processedModels.has(model.id)) continue; // Skip if already processed
        const isNormal = !isLinkedModel(model); // This will be true if it wasn't in circularModels
        const success = await processModel(model, isNormal, undefined, 'Linked Model');
        if (success) successfulModels++; else failedModels++;
        if (onProgress) onProgress(successfulModels + failedModels, totalModels, failedModels > 0 ? 'error' : 'success');
    }

    status = failedModels > 0 ? 'error' : 'success';
    console.log(ansiColors.yellow(`${successfulModels + failedModels} model processing attempts completed for ${totalModels} unique models (${failedModels} failed attempts)`));
    if (onProgress) onProgress(totalModels, totalModels, status);
    return { successfulModels, failedModels, status };
}
