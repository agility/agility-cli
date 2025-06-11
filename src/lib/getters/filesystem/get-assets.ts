import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import * as path from 'path';
import ansiColors from 'ansi-colors';

/**
 * Get assets from filesystem without side effects
 */
export function getAssetsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.Media[] {
    const baseFolder = rootPath || 'agility-files';
    let assetsPath: string;

    if (legacyFolders) {
        assetsPath = `${baseFolder}/assets`;
    } else {
        assetsPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/assets`;
    }

    try {
        // Load assets from JSON files
        const jsonPath = path.join(assetsPath, 'json');
        if (!fs.existsSync(jsonPath)) {
            return [];
        }

        const assetFiles = fs.readdirSync(jsonPath).filter(file => file.endsWith('.json'));
        const allAssets: mgmtApi.Media[] = [];
        
        assetFiles.forEach(file => {
            const assetData = JSON.parse(fs.readFileSync(path.join(jsonPath, file), 'utf8'));
            // Extract assetMedias array from each JSON file
            if (assetData.assetMedias && Array.isArray(assetData.assetMedias)) {
                allAssets.push(...assetData.assetMedias);
            }
        });
        
        return allAssets;
    } catch (error: any) {
        console.warn(`[Assets] Error loading assets from ${assetsPath}: ${error.message}`);
        return [];
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
