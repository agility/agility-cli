import * as path from 'path';

// Helper to get base file path (relative to assets folder)
// Handles different URL structures:
// 1. https://cdn.agilitycms.com/guid/assets/folder/file.jpg -> folder/file.jpg
// 2. /instance-name/folder/file.jpg -> folder/file.jpg
// 3. /instance-name/file.jpg -> file.jpg
export function getAssetFilePath(originUrl: string): string {
    try {
        if (!originUrl) {
            console.warn('[Asset Utils] Empty originUrl provided to getAssetFilePath');
            return 'unknown-asset';
        }

        let pathname: string;
        try {
            // Try parsing as a full URL first
            const url = new URL(originUrl);
            pathname = url.pathname;
        } catch (e) {
            // If not a full URL, assume it's a path like /instance-name/folder/file.jpg
             if (typeof originUrl === 'string' && originUrl.startsWith('/')) {
                 pathname = originUrl.split('?')[0]; // Use the path directly, remove query params
             } else {
                 console.error(`[Asset Utils] Cannot parse originUrl: ${originUrl}. It is not a full URL and does not start with /.`);
                 return 'error-parsing-asset-path';
             }
        }
        
        const assetsMarker = '/assets/';
        const assetsIndex = pathname.indexOf(assetsMarker);

        let relativePath: string;

        if (assetsIndex !== -1) {
            // Case 1: Found "/assets/", extract path after it
            relativePath = pathname.substring(assetsIndex + assetsMarker.length);
        } else if (pathname.startsWith('/')) {
            // Case 2 & 3: Path starts with '/', assume /instance-name/... structure
            const pathParts = pathname.split('/').filter(part => part !== ''); // Split and remove empty parts
            if (pathParts.length > 1) {
                // Remove the first part (instance-name or guid) and join the rest
                // This assumes the first part is a segment NOT part of the asset's actual path in the container
                relativePath = pathParts.slice(1).join('/'); 
            } else if (pathParts.length === 1) {
                 // Only one part after splitting, likely just the filename at the root level of the implicit container
                 relativePath = pathParts[0];
            } else {
                 console.warn(`[Asset Utils] Could not determine relative path from pathname: ${pathname}`);
                 relativePath = 'unknown-asset';
            }
        } else {
             // This case should ideally not be reached if the initial try/catch for URL parsing and path check works
             console.warn(`[Asset Utils] Unexpected pathname format (not starting with '/' after URL parse failed): ${pathname}. Using it directly.`);
             relativePath = pathname; // Fallback
        }

        // Decode URI components and remove potential leading/trailing slashes
        return decodeURIComponent(relativePath.replace(/^\/+|\/+$/g, ''));

    } catch (e: any) {
        console.error(`[Asset Utils] Error parsing originUrl: ${originUrl}`, e);
        return 'error-parsing-asset-path';
    }
} 