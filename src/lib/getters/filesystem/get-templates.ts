import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';

/**
 * Get templates from filesystem without side effects
 */
export function getTemplatesFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.PageModel[] {
    const baseFolder = rootPath || 'agility-files';
    let templatesPath: string;

    if (legacyFolders) {
        templatesPath = `${baseFolder}/templates`;
    } else {
        templatesPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/templates`;
    }

    try {
        const templateFiles = fs.readdirSync(templatesPath).filter(file => file.endsWith('.json'));
        return templateFiles.map(file => {
            const templateData = JSON.parse(fs.readFileSync(`${templatesPath}/${file}`, 'utf8'));
            return templateData as mgmtApi.PageModel;
        });
    } catch (error: any) {
        console.warn(`[Templates] Error loading templates from ${templatesPath}: ${error.message}`);
        return [];
    }
}
