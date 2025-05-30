import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../../mapper';
import { fileOperations } from '../../services/fileOperations';
import * as fs from 'fs';
import * as path from 'path';
import ansiColors from 'ansi-colors';

export function getAssetsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean
): mgmtApi.AssetMediaList[] | null {
    let fileOperation = new fileOperations(rootPath, guid, locale, isPreview);
  
    try{
      
        const baseFolder = rootPath || 'agility-files'; 
        let dirPath = `${guid}/${locale}/${isPreview ? 'preview':'live'}/assets/json`;

        if(legacyFolders){
            dirPath = `assets/json`;
        }

        let assets: mgmtApi.AssetMediaList[] = [];
        let processedMediaIds = new Set<number>(); // Track processed media IDs to avoid duplicates

        // First, load assets from JSON metadata files (original logic)
        try {
            let files = fileOperation.readDirectory(dirPath, baseFolder);
            
            for(let i = 0; i < files.length; i++){
                let file = JSON.parse(files[i]) as mgmtApi.AssetMediaList;
                // Add each media item individually to the reference mapper
                for (const media of file.assetMedias) {
                    referenceMapper.addRecord('asset', media, null);
                    processedMediaIds.add(media.mediaID);
                }
                assets.push(file);
            }
            console.log(ansiColors.green(`[Assets] Loaded ${processedMediaIds.size} assets from JSON metadata`));
        } catch (jsonError) {
            console.log(ansiColors.yellow(`[Assets] No JSON metadata found, scanning filesystem directly`));
        }

        // Second, scan the filesystem for additional assets not in JSON metadata
        const assetsBasePath = legacyFolders 
            ? path.join(baseFolder, 'assets')
            : path.join(baseFolder, guid, locale, isPreview ? 'preview' : 'live', 'assets');

        const filesystemAssets = scanFilesystemForAssets(assetsBasePath, guid);
        
        if (filesystemAssets.length > 0) {
            // Create a new AssetMediaList for filesystem-discovered assets
            const filesystemAssetList: mgmtApi.AssetMediaList = {
                assetMedias: filesystemAssets.filter(media => !processedMediaIds.has(media.mediaID)),
                totalCount: 0 // Will be set correctly below
            };
            
            if (filesystemAssetList.assetMedias.length > 0) {
                filesystemAssetList.totalCount = filesystemAssetList.assetMedias.length;
                
                // Add to reference mapper and assets list
                for (const media of filesystemAssetList.assetMedias) {
                    referenceMapper.addRecord('asset', media, null);
                }
                
                assets.push(filesystemAssetList);
                console.log(ansiColors.green(`[Assets] Discovered ${filesystemAssetList.assetMedias.length} additional assets from filesystem`));
            }
        }

        const totalAssets = assets.reduce((sum, list) => sum + list.assetMedias.length, 0);
        console.log(ansiColors.cyan(`[Assets] Total assets available for upload: ${totalAssets}`));
        
        return assets.length > 0 ? assets : null;
    } catch (e){
        console.error(`Error in getAssetsFromFileSystem: ${e.message}`);
        fileOperation.appendLogFile(`\n No Assets were found in the source Instance to process.`);
        return null;
    }
}

/**
 * Scan filesystem for asset files and create media objects
 */
function scanFilesystemForAssets(assetsBasePath: string, sourceGuid: string): mgmtApi.Media[] {
    const assets: mgmtApi.Media[] = [];
    
    if (!fs.existsSync(assetsBasePath)) {
        return assets;
    }
    
    // Skip certain directories that aren't actual asset folders
    const skipDirectories = ['json', 'galleries'];
    
    function scanDirectory(dirPath: string, relativePath: string = '') {
        try {
            const items = fs.readdirSync(dirPath);
            
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const itemRelativePath = relativePath ? `${relativePath}/${item}` : item;
                
                if (fs.statSync(fullPath).isDirectory()) {
                    // Skip certain system directories
                    if (!skipDirectories.includes(item)) {
                        scanDirectory(fullPath, itemRelativePath);
                    }
                } else {
                    // It's a file - create a media object
                    const stats = fs.statSync(fullPath);
                    const fileExtension = path.extname(item).toLowerCase();
                    
                    // Only process actual asset files (images, videos, documents, etc.)
                    if (isAssetFile(fileExtension)) {
                        const media: mgmtApi.Media = {
                            hasChildren: false,
                            mediaID: generateTempMediaId(itemRelativePath),
                            fileName: item,
                            containerID: 1, // Default container
                            containerOriginUrl: `https://origin.agilitycms.com/${sourceGuid}`,
                            containerEdgeUrl: `https://cdn.aglty.io/${sourceGuid}`,
                            originKey: itemRelativePath,
                            modifiedBy: 0,
                            modifiedByName: 'Filesystem Scan',
                            dateModified: stats.mtime.toISOString(),
                            size: stats.size,
                            isFolder: false,
                            isDeleted: false,
                            mediaGroupingID: extractMediaGroupingId(itemRelativePath),
                            mediaGroupingSortOrder: 0,
                            contentType: getMimeType(fileExtension),
                            rowNumber: 0,
                            originUrl: `https://origin.agilitycms.com/${sourceGuid}/${itemRelativePath}`,
                            edgeUrl: `https://cdn.aglty.io/${sourceGuid}/${itemRelativePath}`,
                            isImage: isImageExtension(fileExtension),
                            isSvg: fileExtension === '.svg',
                            mediaGroupingName: extractMediaGroupingName(itemRelativePath),
                            gridThumbnailID: 0,
                            gridThumbnailSuffix: ''
                        };
                        
                        assets.push(media);
                    }
                }
            }
        } catch (error) {
            console.warn(`[Assets] Error scanning directory ${dirPath}:`, error.message);
        }
    }
    
    scanDirectory(assetsBasePath);
    return assets;
}

/**
 * Check if file extension indicates it's an asset file
 */
function isAssetFile(extension: string): boolean {
    const assetExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', // Images
        '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', // Videos
        '.mp3', '.wav', '.flac', '.aac', '.ogg', // Audio
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', // Documents
        '.zip', '.rar', '.7z', '.tar', '.gz', // Archives
        '.txt', '.rtf', '.csv', '.json' // Text files
    ];
    
    return assetExtensions.includes(extension);
}

/**
 * Check if file extension indicates it's an image file
 */
function isImageExtension(extension: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    return imageExtensions.includes(extension);
}

/**
 * Generate a temporary media ID for filesystem-discovered assets
 * This will be overridden when the asset is uploaded
 */
function generateTempMediaId(relativePath: string): number {
    // Generate a consistent temporary ID based on the path
    // Use negative numbers to avoid conflicts with real media IDs
    let hash = 0;
    for (let i = 0; i < relativePath.length; i++) {
        const char = relativePath.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return -Math.abs(hash);
}

/**
 * Extract media grouping ID from path if it's a MediaGroupings path
 */
function extractMediaGroupingId(relativePath: string): number {
    const mediaGroupingsMatch = relativePath.match(/^MediaGroupings\/(\d+)\//);
    return mediaGroupingsMatch ? parseInt(mediaGroupingsMatch[1]) : 0;
}

/**
 * Extract media grouping name from path
 */
function extractMediaGroupingName(relativePath: string): string {
    const parts = relativePath.split('/');
    if (parts.length > 1 && parts[0] === 'MediaGroupings') {
        return ''; // MediaGroupings don't have names in path, will need gallery lookup
    }
    if (parts.length > 1) {
        return parts[0]; // Use folder name as grouping name
    }
    return '';
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain',
        '.csv': 'text/csv'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
}
