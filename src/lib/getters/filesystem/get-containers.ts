import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get containers from filesystem without side effects
 * Uses Joel's container downloader data from /containers directory
 */
export function getContainersFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.Container[] {
    const baseFolder = rootPath || 'agility-files';
    let containersPath: string;
    let listPath: string;

    if (legacyFolders) {
        containersPath = `${baseFolder}/containers`;
        listPath = `${baseFolder}/list`;
    } else {
        containersPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/containers`;
        listPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/list`;
    }

    if (!fs.existsSync(containersPath)) {
        console.warn(`[Containers] Container directory not found: ${containersPath}`);
        console.warn(`[Containers] Make sure to run 'pull --elements Containers' first to download container data`);
        return [];
    }

    try {
        // Load container metadata from Joel's downloader
        const containerFiles = fs.readdirSync(containersPath).filter(file => file.endsWith('.json'));
        const containers = containerFiles.map(file => {
            try {
                const containerData = JSON.parse(fs.readFileSync(path.join(containersPath, file), 'utf8'));
                
                // Load content items for this container from /list directory
                let contentItems: any[] = [];
                if (fs.existsSync(listPath)) {
                    const listFile = path.join(listPath, `${containerData.referenceName}.json`);
                    if (fs.existsSync(listFile)) {
                        contentItems = JSON.parse(fs.readFileSync(listFile, 'utf8')) || [];
                    }
                }

                return {
                    ...containerData,
                    contentCount: contentItems.length,
                    _contentItems: contentItems // Store for reference
                };
            } catch (error) {
                console.warn(`[Containers] Error loading container from ${file}: ${error}`);
                return null;
            }
        }).filter(container => container !== null);

        return containers;
    } catch (error: any) {
        console.warn(`[Containers] Error loading containers from ${containersPath}: ${error.message}`);
        return [];
    }
} 