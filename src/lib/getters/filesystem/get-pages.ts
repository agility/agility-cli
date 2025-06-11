import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';

/**
 * Get pages from filesystem without side effects
 */
export function getPagesFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.PageItem[] {
    const baseFolder = rootPath || 'agility-files';
    let pagesPath: string;

    if (legacyFolders) {
        pagesPath = `${baseFolder}/page`;
    } else {
        pagesPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/page`;
    }

    try {
        const pageFiles = fs.readdirSync(pagesPath).filter(file => file.endsWith('.json'));
        return pageFiles.map(file => {
            const pageData = JSON.parse(fs.readFileSync(`${pagesPath}/${file}`, 'utf8'));
            return pageData as mgmtApi.PageItem;
        });
    } catch (error: any) {
        console.warn(`[Pages] Error loading pages from ${pagesPath}: ${error.message}`);
        return [];
    }
}
