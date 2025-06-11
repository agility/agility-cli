/**
 * Asset Filesystem Scanner
 * 
 * Task 21.13.2.1: Create AssetFilesystemScanner to find assets not in JSON metadata
 * 
 * Scans the agility-files asset directories to find files that exist in the filesystem
 * but aren't referenced in the JSON metadata. This helps achieve true 100% reconciliation
 * by discovering orphaned assets that can still be uploaded.
 */

import fs from 'fs';
import path from 'path';
import ansiColors from 'ansi-colors';

export interface FilesystemAsset {
    fileName: string;           // Original filename from filesystem
    filePath: string;          // Relative path within assets directory
    fullPath: string;          // Full filesystem path
    directory: string;         // Asset subdirectory (posts, mobile, logos, etc.)
    fileSize: number;          // File size in bytes
    fileExtension: string;     // File extension (.jpg, .png, .svg, etc.)
    estimatedUrl: string;      // Estimated CDN URL based on directory structure
    discoveryMethod: 'filesystem'; // How this asset was discovered
}

export interface AssetDiscoveryResult {
    filesystemAssets: FilesystemAsset[];
    jsonAssets: any[];                    // Original JSON assets for comparison
    orphanedAssets: FilesystemAsset[];    // Assets in filesystem but not in JSON
    matchedAssets: {                      // Assets found in both places
        filesystem: FilesystemAsset;
        json: any;
    }[];
    summary: {
        totalFilesystemAssets: number;
        totalJsonAssets: number;
        totalOrphaned: number;
        totalMatched: number;
        coveragePercentage: number;
    };
}

export class AssetFilesystemScanner {
    private assetDirectories = [
        'posts',
        'mobile', 
        'MediaGroupings',
        'logos',
        'Attachments',
        'json',
        'galleries'
    ];

    /**
     * Main discovery method: Find all assets in filesystem and compare with JSON metadata
     */
    async discoverAssets(basePath: string, jsonAssets: any[] = []): Promise<AssetDiscoveryResult> {
        console.log(ansiColors.cyan('🔍 Starting filesystem asset discovery...'));
        
        const assetsPath = path.join(basePath, 'assets');
        
        if (!fs.existsSync(assetsPath)) {
            throw new Error(`Assets directory not found: ${assetsPath}`);
        }

        // Step 1: Scan filesystem for all asset files
        const filesystemAssets = await this.scanFilesystemAssets(assetsPath);
        console.log(ansiColors.blue(`📁 Found ${filesystemAssets.length} files in filesystem`));

        // Step 2: Compare with JSON metadata to find orphaned files
        const { orphanedAssets, matchedAssets } = this.compareWithJsonAssets(filesystemAssets, jsonAssets);
        
        // Step 3: Generate summary statistics
        const summary = this.generateDiscoverySummary(filesystemAssets, jsonAssets, orphanedAssets, matchedAssets);
        
        console.log(ansiColors.green(`✅ Asset discovery complete:`));
        console.log(`   📊 Filesystem Assets: ${summary.totalFilesystemAssets}`);
        console.log(`   📋 JSON Assets: ${summary.totalJsonAssets}`);
        console.log(`   🔍 Orphaned Assets: ${summary.totalOrphaned}`);
        console.log(`   ✅ Matched Assets: ${summary.totalMatched}`);
        console.log(`   📈 Coverage: ${summary.coveragePercentage.toFixed(1)}%`);

        return {
            filesystemAssets,
            jsonAssets,
            orphanedAssets,
            matchedAssets,
            summary
        };
    }

    /**
     * Step 1: Scan all asset subdirectories for files
     */
    private async scanFilesystemAssets(assetsPath: string): Promise<FilesystemAsset[]> {
        const allAssets: FilesystemAsset[] = [];

        // Check each known asset directory
        for (const directory of this.assetDirectories) {
            const dirPath = path.join(assetsPath, directory);
            
            if (fs.existsSync(dirPath)) {
                const dirAssets = await this.scanDirectory(dirPath, directory);
                allAssets.push(...dirAssets);
                console.log(`   📂 ${directory}: ${dirAssets.length} files`);
            }
        }

        // Also check for any additional directories we might have missed
        const allDirectories = fs.readdirSync(assetsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
            
        for (const directory of allDirectories) {
            if (!this.assetDirectories.includes(directory)) {
                const dirPath = path.join(assetsPath, directory);
                const dirAssets = await this.scanDirectory(dirPath, directory);
                allAssets.push(...dirAssets);
                console.log(`   📂 ${directory} (discovered): ${dirAssets.length} files`);
            }
        }

        return allAssets;
    }

    /**
     * Scan a specific directory for asset files
     */
    private async scanDirectory(dirPath: string, directory: string): Promise<FilesystemAsset[]> {
        const assets: FilesystemAsset[] = [];
        
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const file of files) {
                if (file.isFile() && this.isAssetFile(file.name)) {
                    const fullPath = path.join(dirPath, file.name);
                    const stats = fs.statSync(fullPath);
                    
                    const asset: FilesystemAsset = {
                        fileName: file.name,
                        filePath: path.join(directory, file.name),
                        fullPath: fullPath,
                        directory: directory,
                        fileSize: stats.size,
                        fileExtension: path.extname(file.name).toLowerCase(),
                        estimatedUrl: this.generateEstimatedUrl(directory, file.name),
                        discoveryMethod: 'filesystem'
                    };
                    
                    assets.push(asset);
                }
            }
        } catch (error) {
            console.warn(ansiColors.yellow(`⚠️ Could not scan directory ${dirPath}: ${error.message}`));
        }

        return assets;
    }

    /**
     * Check if a file is an asset file (by extension)
     */
    private isAssetFile(fileName: string): boolean {
        const assetExtensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm',
            '.mp3', '.wav', '.aac', '.ogg',
            '.zip', '.rar', '.7z', '.tar', '.gz'
        ];
        
        const extension = path.extname(fileName).toLowerCase();
        return assetExtensions.includes(extension);
    }

    /**
     * Generate estimated CDN URL based on directory structure
     */
    private generateEstimatedUrl(directory: string, fileName: string): string {
        // This follows typical Agility CMS CDN URL patterns
        // Format: https://cdn.aglty.io/{guid}/media/{directory}/{fileName}
        return `https://cdn.aglty.io/{guid}/media/${directory}/${fileName}`;
    }

    /**
     * Step 2: Compare filesystem assets with JSON metadata
     */
    private compareWithJsonAssets(filesystemAssets: FilesystemAsset[], jsonAssets: any[]): {
        orphanedAssets: FilesystemAsset[];
        matchedAssets: { filesystem: FilesystemAsset; json: any; }[];
    } {
        const matchedAssets: { filesystem: FilesystemAsset; json: any; }[] = [];
        const orphanedAssets: FilesystemAsset[] = [];

        for (const fsAsset of filesystemAssets) {
            // Try to find matching JSON asset by filename, URL, or path
            const matchingJsonAsset = jsonAssets.find(jsonAsset => 
                this.assetsMatch(fsAsset, jsonAsset)
            );

            if (matchingJsonAsset) {
                matchedAssets.push({
                    filesystem: fsAsset,
                    json: matchingJsonAsset
                });
            } else {
                orphanedAssets.push(fsAsset);
            }
        }

        return { orphanedAssets, matchedAssets };
    }

    /**
     * Check if a filesystem asset matches a JSON asset
     */
    private assetsMatch(fsAsset: FilesystemAsset, jsonAsset: any): boolean {
        // Try multiple matching strategies
        
        // Strategy 1: Exact filename match
        if (jsonAsset.fileName === fsAsset.fileName) {
            return true;
        }
        
        // Strategy 2: URL contains the filename
        if (jsonAsset.url && jsonAsset.url.includes(fsAsset.fileName)) {
            return true;
        }
        
        if (jsonAsset.originUrl && jsonAsset.originUrl.includes(fsAsset.fileName)) {
            return true;
        }
        
        if (jsonAsset.edgeUrl && jsonAsset.edgeUrl.includes(fsAsset.fileName)) {
            return true;
        }

        // Strategy 3: Partial filename match (handles renamed files)
        const baseFileName = path.parse(fsAsset.fileName).name;
        if (jsonAsset.fileName && jsonAsset.fileName.includes(baseFileName)) {
            return true;
        }

        return false;
    }

    /**
     * Step 3: Generate summary statistics
     */
    private generateDiscoverySummary(
        filesystemAssets: FilesystemAsset[], 
        jsonAssets: any[], 
        orphanedAssets: FilesystemAsset[], 
        matchedAssets: { filesystem: FilesystemAsset; json: any; }[]
    ) {
        const totalFilesystemAssets = filesystemAssets.length;
        const totalJsonAssets = jsonAssets.length;
        const totalOrphaned = orphanedAssets.length;
        const totalMatched = matchedAssets.length;
        
        // Calculate coverage percentage (how many JSON assets have corresponding files)
        const coveragePercentage = totalJsonAssets > 0 ? (totalMatched / totalJsonAssets) * 100 : 100;

        return {
            totalFilesystemAssets,
            totalJsonAssets,
            totalOrphaned,
            totalMatched,
            coveragePercentage
        };
    }

    /**
     * Create upload-ready asset entries from orphaned filesystem assets
     */
    createUploadEntries(orphanedAssets: FilesystemAsset[], sourceGuid: string): any[] {
        return orphanedAssets.map(asset => ({
            // Generate temporary IDs for orphaned assets
            fileName: asset.fileName,
            mediaID: -1, // -1 indicates new asset to be created
            id: -1,
            assetId: -1,
            
            // URL information
            url: asset.estimatedUrl.replace('{guid}', sourceGuid),
            originUrl: asset.estimatedUrl.replace('{guid}', sourceGuid),
            edgeUrl: asset.estimatedUrl.replace('{guid}', sourceGuid),
            
            // File information
            fileSize: asset.fileSize,
            fileExtension: asset.fileExtension,
            directory: asset.directory,
            
            // Upload metadata
            uploadMethod: 'filesystem-discovery',
            discoveredPath: asset.fullPath,
            
            // Default metadata (since we don't have JSON data)
            description: `Asset discovered from filesystem: ${asset.filePath}`,
            altText: asset.fileName,
            title: asset.fileName,
            isFolder: false,
            state: 2 // Published state
        }));
    }

    /**
     * Print detailed discovery report
     */
    printDiscoveryReport(result: AssetDiscoveryResult): void {
        console.log(ansiColors.cyan('\n📊 ASSET DISCOVERY REPORT'));
        console.log('=' .repeat(50));
        
        console.log(`\n📁 Filesystem Assets: ${result.summary.totalFilesystemAssets}`);
        if (result.summary.totalFilesystemAssets > 0) {
            const byDirectory = this.groupAssetsByDirectory(result.filesystemAssets);
            byDirectory.forEach((count, directory) => {
                console.log(`   📂 ${directory}: ${count} files`);
            });
        }

        console.log(`\n📋 JSON Assets: ${result.summary.totalJsonAssets}`);
        console.log(`✅ Matched Assets: ${result.summary.totalMatched}`);
        console.log(`🔍 Orphaned Assets: ${result.summary.totalOrphaned}`);
        
        if (result.orphanedAssets.length > 0) {
            console.log(ansiColors.yellow(`\n⚠️ ORPHANED ASSETS (${result.orphanedAssets.length}):`));
            result.orphanedAssets.slice(0, 10).forEach(asset => {
                console.log(`   📄 ${asset.filePath} (${this.formatFileSize(asset.fileSize)})`);
            });
            
            if (result.orphanedAssets.length > 10) {
                console.log(`   ... and ${result.orphanedAssets.length - 10} more orphaned assets`);
            }
        }

        console.log(`\n📈 Coverage: ${result.summary.coveragePercentage.toFixed(1)}% of JSON assets have filesystem files`);
    }

    /**
     * Helper: Group assets by directory
     */
    private groupAssetsByDirectory(assets: FilesystemAsset[]): Map<string, number> {
        const groups = new Map<string, number>();
        
        assets.forEach(asset => {
            const count = groups.get(asset.directory) || 0;
            groups.set(asset.directory, count + 1);
        });

        return groups;
    }

    /**
     * Helper: Format file size for display
     */
    private formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
} 