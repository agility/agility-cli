import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { ReferenceMapper } from "../../shared/reference-mapper";

/**
 * Get containers from Content Sync SDK /list directory
 * Each file in /list represents a container with its content items
 * This is the REAL source of container data (not the obsolete /containers directory)
 */
export function getContainersFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
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
        console.warn(`[Containers] List directory not found: ${listPath}`);
        return [];
    }

    const listFiles = fs.readdirSync(listPath).filter(file => file.endsWith('.json'));
    const containers: mgmtApi.Container[] = [];

    // Also load models to resolve definitionName to model ID (like chain-data-loader does)
    const modelsPath = legacyFolders 
        ? `${baseFolder}/models`
        : `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/models`;
    
    const models = loadModels(modelsPath);

    for (let index = 0; index < listFiles.length; index++) {
        const file = listFiles[index];
        const filePath = path.join(listPath, file);
        
        try {
            const contentList = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (Array.isArray(contentList) && contentList.length > 0) {
                // Get container metadata from the first content item's properties
                const firstItem = contentList[0];
                if (firstItem.properties) {
                    // Find the model ID by matching definitionName with model referenceName
                    const matchingModel = models.find((model: any) => 
                        model.referenceName === firstItem.properties.definitionName
                    );
                    
                    const container: mgmtApi.Container = {
                        // Use referenceName as the container identifier
                        referenceName: firstItem.properties.referenceName,
                        contentViewID: index + 1000, // Generate unique ID for consistency with chain-data-loader
                        contentDefinitionID: matchingModel ? matchingModel.id : null, // Proper model ID reference
                        contentCount: contentList.length,
                        // Standard container properties
                        displayName: firstItem.properties.referenceName,
                        isSystemContainer: false,
                        containerID: index + 1000,
                        containerType: 'content',
                        // Store additional metadata
                        _sourceFile: file,
                        _contentItems: contentList // Store the list contents for reference
                    } as any;
                    
                    // Add source container to reference mapper
                    referenceMapper.addRecord('container', container, null);
                    containers.push(container);
                }
            }
        } catch (error: any) {
            console.warn(`[Containers] Error processing list file ${file}: ${error.message}`);
        }
    }

    console.log(`[Containers] Loaded ${containers.length} containers from /list directory`);
    return containers;
}

/**
 * Load models to resolve definitionName to model ID
 */
function loadModels(modelsPath: string): any[] {
    if (!fs.existsSync(modelsPath)) {
        return [];
    }

    const modelFiles = fs.readdirSync(modelsPath).filter(file => file.endsWith('.json'));
    const models: any[] = [];

    for (const file of modelFiles) {
        try {
            const modelData = JSON.parse(fs.readFileSync(path.join(modelsPath, file), 'utf8'));
            models.push(modelData);
        } catch (error: any) {
            console.warn(`[Containers] Error loading model file ${file}: ${error.message}`);
        }
    }

    return models;
} 