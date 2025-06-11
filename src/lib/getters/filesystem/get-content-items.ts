import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get content items from filesystem without side effects
 * Includes complex deduplication logic combining item/ and list/ content (from ChainDataLoader logic)
 */
export function getContentItemsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.ContentItem[] {
    const baseFolder = rootPath || 'agility-files';
    let itemPath: string;
    let listPath: string;

    if (legacyFolders) {
        itemPath = `${baseFolder}/item`;
        listPath = `${baseFolder}/list`;
    } else {
        itemPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/item`;
        listPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/list`;
    }

    try {
        const allContent: any[] = [];
        const processedContentIds = new Set<number>();

        // Load content from /item directory (individual content items)
        if (fs.existsSync(itemPath)) {
            const itemFiles = fs.readdirSync(itemPath).filter(file => file.endsWith('.json'));
            for (const file of itemFiles) {
                try {
                    const contentData = JSON.parse(fs.readFileSync(path.join(itemPath, file), 'utf8'));
                    if (contentData.contentID && !processedContentIds.has(contentData.contentID)) {
                        allContent.push(contentData);
                        processedContentIds.add(contentData.contentID);
                    }
                } catch (error: any) {
                    console.warn(`[Content] Error loading item file ${file}: ${error.message}`);
                }
            }
        }

        // Load content from /list directory (container content lists) - exact logic from ChainDataLoader
        if (fs.existsSync(listPath)) {
            const listFiles = fs.readdirSync(listPath).filter(file => file.endsWith('.json'));
            for (const file of listFiles) {
                try {
                    const contentList = JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
                    if (Array.isArray(contentList)) {
                        for (const contentItem of contentList) {
                            if (contentItem.contentID && !processedContentIds.has(contentItem.contentID)) {
                                allContent.push(contentItem);
                                processedContentIds.add(contentItem.contentID);
                            }
                        }
                    }
                } catch (error: any) {
                    console.warn(`[Content] Error loading list file ${file}: ${error.message}`);
                }
            }
        }

        return allContent;
    } catch (error: any) {
        console.warn(`[Content] Error loading content items: ${error.message}`);
        return [];
    }
}
