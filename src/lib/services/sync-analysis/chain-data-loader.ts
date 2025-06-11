import { SourceEntities } from './types';
import { getModelsFromFileSystem } from '../../getters/filesystem/get-models';
import { getContainersFromFileSystem } from '../../getters/filesystem/get-containers';
import { getContentItemsFromFileSystem } from '../../getters/filesystem/get-content-items';
import { getTemplatesFromFileSystem } from '../../getters/filesystem/get-templates';
import { getPagesFromFileSystem } from '../../getters/filesystem/get-pages';
import { getAssetsFromFileSystem } from '../../getters/filesystem/get-assets';
import { getGalleriesFromFileSystem } from '../../getters/filesystem/get-galleries';

/**
 * Loads all source data for sync analysis using pure getters
 * This is the centralized data loading service used by sync analysis
 */
export class ChainDataLoader {
    
    /**
     * Load all source entities from filesystem using pure getters
     */
    static loadSourceEntities(
        sourceGuid: string,
        locale: string,
        isPreview: boolean,
        rootPath?: string
    ): SourceEntities {
        console.log(`📂 Loading source data from filesystem...`);
        
        // Use pure getters for consistent data loading
        const models = getModelsFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const containers = getContainersFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const content = getContentItemsFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const templates = getTemplatesFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const pages = getPagesFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const assets = getAssetsFromFileSystem(sourceGuid, locale, isPreview, rootPath);
        const galleries = getGalleriesFromFileSystem(sourceGuid, locale, isPreview, rootPath);

        console.log(`📊 Loaded: ${models.length} models, ${containers.length} containers, ${content.length} content, ${templates.length} templates, ${pages.length} pages, ${assets.length} assets, ${galleries.length} galleries`);

        return {
            models,
            containers,
            content,
            templates,
            pages,
            assets,
            galleries
        };
    }
} 