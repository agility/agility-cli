import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get galleries from filesystem without side effects
 * Includes flattening of assetMediaGroupings arrays (from ChainDataLoader logic)
 */
export function getGalleriesFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.assetMediaGrouping[] {
    const baseFolder = rootPath || 'agility-files';
    let galleriesPath: string;

    if (legacyFolders) {
        galleriesPath = `${baseFolder}/assets/galleries`;
    } else {
        galleriesPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/assets/galleries`;
    }

    try {
        if (!fs.existsSync(galleriesPath)) {
            return [];
        }

        const galleryFiles = fs.readdirSync(galleriesPath).filter(file => file.endsWith('.json'));
        const galleryLists = galleryFiles.map(file => {
            try {
                return JSON.parse(fs.readFileSync(path.join(galleriesPath, file), 'utf8'));
            } catch (error: any) {
                console.warn(`[Galleries] Error loading gallery file ${file}: ${error.message}`);
                return null;
            }
        }).filter(item => item !== null);

        // Flatten assetMediaGroupings arrays (exact logic from ChainDataLoader)
        return galleryLists.flatMap((galleryList: any) => 
            galleryList.assetMediaGroupings || []
        );
    } catch (error: any) {
        console.warn(`[Galleries] Error loading galleries from ${galleriesPath}: ${error.message}`);
        return [];
    }
}
