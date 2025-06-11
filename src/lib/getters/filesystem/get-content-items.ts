import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import { ReferenceMapper } from '../../reference-mapper';

export async function getContentItemsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean 
): Promise<mgmtApi.ContentItem[]> {
    const baseFolder = rootPath || 'agility-files';
    let contentItemsPath: string; // Changed variable name for clarity from 'contentPath'

    if (legacyFolders) {
        contentItemsPath = `${baseFolder}/item`;
    } else {
        contentItemsPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/item`;
    }

    const contentFiles = fs.readdirSync(contentItemsPath);
    const contentItems: mgmtApi.ContentItem[] = [];

    for (const file of contentFiles) {
        const contentItemData = JSON.parse(fs.readFileSync(`${contentItemsPath}/${file}`, 'utf8'));
        const contentItem = contentItemData as mgmtApi.ContentItem; 
        referenceMapper.addRecord('content', contentItem, null);
        contentItems.push(contentItem);
    }

    return contentItems;
}
