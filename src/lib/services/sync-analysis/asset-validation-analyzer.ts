import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from '../../../types/syncAnalysis';

interface SourceData {
    models: any[];
    containers: any[];
    content: any[];
    assets: any[];
    galleries: any[];
    templates: any[];
    pages: any[];
}

export interface AssetValidationResult {
    validAssets: any[];
    problematicAssets: {
        corruptedMetadata: any[];      // Base64-embedded data URLs
        missingFiles: any[];           // Files that don't exist on CDN
        specialCharacterIssues: any[]; // Files with special characters like +
        urlEncodingIssues: any[];      // Files with URL encoding problems
    };
    totalAssets: number;
    validAssetCount: number;
    problematicAssetCount: number;
}

export class AssetValidationAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private assetValidationResult?: AssetValidationResult;

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
    }

    /**
     * Analyze assets as part of the chain analysis workflow
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        const sourceData: SourceData = {
            models: sourceEntities.models,
            containers: sourceEntities.containers,
            content: sourceEntities.content,
            assets: sourceEntities.assets,
            galleries: sourceEntities.galleries,
            templates: sourceEntities.templates,
            pages: sourceEntities.pages
        };

        this.assetValidationResult = this.analyzeAssetValidation(sourceData);
        
        // Display the report
        const report = this.generateAssetValidationReport(this.assetValidationResult);
        console.log(report);
    }

    /**
     * Get the latest asset validation result (for use by other services)
     */
    getAssetValidationResult(): AssetValidationResult | undefined {
        return this.assetValidationResult;
    }
    
    /**
     * Analyzes assets for various issues that would prevent successful sync
     */
    analyzeAssetValidation(sourceData: SourceData): AssetValidationResult {
        const { assets } = sourceData;
        
        const result: AssetValidationResult = {
            validAssets: [],
            problematicAssets: {
                corruptedMetadata: [],
                missingFiles: [],
                specialCharacterIssues: [],
                urlEncodingIssues: []
            },
            totalAssets: assets.length,
            validAssetCount: 0,
            problematicAssetCount: 0
        };

        console.log(`\n🔍 Analyzing ${assets.length} assets for sync compatibility...`);

        for (const asset of assets) {
            const fileName = asset.fileName || '';
            const originUrl = asset.originUrl || '';
            const edgeUrl = asset.edgeUrl || '';

            let isProblematic = false;

            // Check for corrupted metadata (base64 data embedded in filenames)
            if (this.isCorruptedMetadata(fileName, originUrl, edgeUrl)) {
                result.problematicAssets.corruptedMetadata.push(asset);
                isProblematic = true;
            }
            // Check for special character issues (like + signs)
            else if (this.hasSpecialCharacterIssues(fileName)) {
                result.problematicAssets.specialCharacterIssues.push(asset);
                isProblematic = true;
            }
            // Check for URL encoding issues
            else if (this.hasUrlEncodingIssues(fileName)) {
                result.problematicAssets.urlEncodingIssues.push(asset);
                isProblematic = true;
            }
            // Check for known missing files (SvelteKit assets with + signs)
            else if (this.isKnownMissingFile(fileName)) {
                result.problematicAssets.missingFiles.push(asset);
                isProblematic = true;
            }

            if (isProblematic) {
                result.problematicAssetCount++;
            } else {
                result.validAssets.push(asset);
                result.validAssetCount++;
            }
        }

        console.log(`📊 Asset Validation Results:`);
        console.log(`   ✅ Valid assets: ${result.validAssetCount}`);
        console.log(`   ❌ Problematic assets: ${result.problematicAssetCount}`);
        
        // Display specific problematic assets with details
        this.displayProblematicAssetDetails(result.problematicAssets);

        return result;
    }

    /**
     * Detects corrupted asset metadata where base64 data is embedded in filenames
     */
    private isCorruptedMetadata(fileName: string, originUrl: string, edgeUrl: string): boolean {
        // Base64-like patterns in filenames (long strings of base64 characters)
        const base64Pattern = /[A-Za-z0-9+/]{50,}/;
        const hasBase64InFilename = base64Pattern.test(fileName);

        // Filenames starting with weird patterns
        const weirdStartPattern = /^-\d{8}\d{6}\./;
        const hasWeirdStart = weirdStartPattern.test(fileName);

        // Extremely long filenames (likely corrupted)
        const isTooLong = fileName.length > 200;

        return hasBase64InFilename || hasWeirdStart || isTooLong;
    }

    /**
     * Detects special character issues that cause CDN problems
     */
    private hasSpecialCharacterIssues(fileName: string): boolean {
        // Plus signs in filenames (known CDN issue)
        const hasPlusSign = fileName.includes('+');
        
        // Other problematic characters
        const hasProblematicChars = /[<>:"|?*]/.test(fileName);

        return hasPlusSign || hasProblematicChars;
    }

    /**
     * Detects URL encoding issues
     */
    private hasUrlEncodingIssues(fileName: string): boolean {
        // Files with URL-encoded characters that should be decoded
        const hasUrlEncoding = fileName.includes('%20') || fileName.includes('%2B') || fileName.includes('%28') || fileName.includes('%29');
        
        return hasUrlEncoding;
    }

    /**
     * Detects known missing files that have been verified as non-existent
     */
    private isKnownMissingFile(fileName: string): boolean {
        // Known missing SvelteKit files with + signs (verified as 404 on both origin and edge CDN)
        const knownMissingFiles = [
            'SvelteKitLogo+AgilityLogo-02202025201509.png',
            'SvelteKitLogo+AgilityLogo-02202025210135.png',
            'SvelteKitLogo+AgilityLogo.png'
        ];
        
        return knownMissingFiles.includes(fileName);
    }

    /**
     * Displays specific details about problematic assets with truncated names and metadata
     */
    private displayProblematicAssetDetails(problematicAssets: {
        corruptedMetadata: any[];
        missingFiles: any[];
        specialCharacterIssues: any[];
        urlEncodingIssues: any[];
    }): void {
        
        // Helper function to truncate long asset names
        const truncateAssetName = (fileName: string, maxLength: number = 60): string => {
            if (fileName.length <= maxLength) return fileName;
            return fileName.substring(0, maxLength - 3) + '...';
        };

        // Helper function to extract useful metadata
        const getAssetInfo = (asset: any): string => {
            const parts: string[] = [];
            
            if (asset.mediaID) parts.push(`ID:${asset.mediaID}`);
            if (asset.id) parts.push(`ID:${asset.id}`);
            if (asset.size) parts.push(`${Math.round(asset.size / 1024)}KB`);
            if (asset.fileExtension) parts.push(asset.fileExtension.toUpperCase());
            
            return parts.length > 0 ? ` (${parts.join(', ')})` : '';
        };

        if (problematicAssets.corruptedMetadata.length > 0) {
            console.log(`\n      🔴 Corrupted metadata (${problematicAssets.corruptedMetadata.length} assets):`);
            problematicAssets.corruptedMetadata.slice(0, 5).forEach(asset => {
                const truncatedName = truncateAssetName(asset.fileName || 'unknown');
                const metaInfo = getAssetInfo(asset);
                console.log(`         ${truncatedName}${metaInfo}`);
            });
            if (problematicAssets.corruptedMetadata.length > 5) {
                console.log(`         ... and ${problematicAssets.corruptedMetadata.length - 5} more`);
            }
        }

        if (problematicAssets.specialCharacterIssues.length > 0) {
            console.log(`\n      🟡 Special character issues (${problematicAssets.specialCharacterIssues.length} assets):`);
            problematicAssets.specialCharacterIssues.slice(0, 5).forEach(asset => {
                const truncatedName = truncateAssetName(asset.fileName || 'unknown');
                const metaInfo = getAssetInfo(asset);
                console.log(`         ${truncatedName}${metaInfo}`);
            });
            if (problematicAssets.specialCharacterIssues.length > 5) {
                console.log(`         ... and ${problematicAssets.specialCharacterIssues.length - 5} more`);
            }
        }

        if (problematicAssets.urlEncodingIssues.length > 0) {
            console.log(`\n      🟠 URL encoding issues (${problematicAssets.urlEncodingIssues.length} assets):`);
            problematicAssets.urlEncodingIssues.slice(0, 5).forEach(asset => {
                const truncatedName = truncateAssetName(asset.fileName || 'unknown');
                const metaInfo = getAssetInfo(asset);
                console.log(`         ${truncatedName}${metaInfo}`);
            });
            if (problematicAssets.urlEncodingIssues.length > 5) {
                console.log(`         ... and ${problematicAssets.urlEncodingIssues.length - 5} more`);
            }
        }

        if (problematicAssets.missingFiles.length > 0) {
            console.log(`\n      🔴 Missing files (verified 404) (${problematicAssets.missingFiles.length} assets):`);
            problematicAssets.missingFiles.slice(0, 5).forEach(asset => {
                const truncatedName = truncateAssetName(asset.fileName || 'unknown');
                const metaInfo = getAssetInfo(asset);
                console.log(`         ${truncatedName}${metaInfo}`);
            });
            if (problematicAssets.missingFiles.length > 5) {
                console.log(`         ... and ${problematicAssets.missingFiles.length - 5} more`);
            }
        }
    }

    /**
     * Provides detailed information about problematic assets for user reporting
     */
    generateAssetValidationReport(result: AssetValidationResult): string {
        let report = '\n📋 **Asset Validation Report**\n\n';
        
        report += `**Summary:**\n`;
        report += `- Total Assets: ${result.totalAssets}\n`;
        report += `- Valid Assets: ${result.validAssetCount} (${((result.validAssetCount / result.totalAssets) * 100).toFixed(1)}%)\n`;
        report += `- Problematic Assets: ${result.problematicAssetCount} (${((result.problematicAssetCount / result.totalAssets) * 100).toFixed(1)}%)\n\n`;

        if (result.problematicAssets.corruptedMetadata.length > 0) {
            report += `**🔴 Corrupted Metadata (${result.problematicAssets.corruptedMetadata.length} assets):**\n`;
            report += `These assets have corrupted filenames with embedded base64 data and will be skipped:\n`;
            result.problematicAssets.corruptedMetadata.slice(0, 5).forEach(asset => {
                report += `- ${asset.fileName.substring(0, 50)}...\n`;
            });
            if (result.problematicAssets.corruptedMetadata.length > 5) {
                report += `- ... and ${result.problematicAssets.corruptedMetadata.length - 5} more\n`;
            }
            report += '\n';
        }

        if (result.problematicAssets.specialCharacterIssues.length > 0) {
            report += `**🟡 Special Character Issues (${result.problematicAssets.specialCharacterIssues.length} assets):**\n`;
            report += `These assets have filenames with special characters that cause CDN issues:\n`;
            result.problematicAssets.specialCharacterIssues.slice(0, 5).forEach(asset => {
                report += `- ${asset.fileName}\n`;
            });
            if (result.problematicAssets.specialCharacterIssues.length > 5) {
                report += `- ... and ${result.problematicAssets.specialCharacterIssues.length - 5} more\n`;
            }
            report += '\n';
        }

        if (result.problematicAssets.urlEncodingIssues.length > 0) {
            report += `**🟠 URL Encoding Issues (${result.problematicAssets.urlEncodingIssues.length} assets):**\n`;
            report += `These assets have URL-encoded characters in filenames:\n`;
            result.problematicAssets.urlEncodingIssues.slice(0, 5).forEach(asset => {
                report += `- ${asset.fileName}\n`;
            });
            if (result.problematicAssets.urlEncodingIssues.length > 5) {
                report += `- ... and ${result.problematicAssets.urlEncodingIssues.length - 5} more\n`;
            }
            report += '\n';
        }

        if (result.problematicAssets.missingFiles.length > 0) {
            report += `**🔴 Missing Files (${result.problematicAssets.missingFiles.length} assets):**\n`;
            report += `These assets are verified as non-existent on both origin and edge CDN:\n`;
            result.problematicAssets.missingFiles.slice(0, 5).forEach(asset => {
                report += `- ${asset.fileName}\n`;
            });
            if (result.problematicAssets.missingFiles.length > 5) {
                report += `- ... and ${result.problematicAssets.missingFiles.length - 5} more\n`;
            }
            report += '\n';
        }

        report += `**✅ Sync Impact:**\n`;
        report += `${result.validAssetCount} assets will be included in sync operations.\n`;
        report += `${result.problematicAssetCount} assets will be excluded due to validation issues.\n`;

        return report;
    }
} 