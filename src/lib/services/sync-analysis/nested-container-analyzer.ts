/**
 * Nested Container Analyzer Service
 * 
 * Analyzes container→content→container chains that current analysis misses.
 * Implements Task 23.1 - Multi-Level Container Chain Detection.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from '../../../types/syncAnalysis';
import { ContainerReferenceExtractor, NestedContainerChain } from './container-reference-extractor';

export class NestedContainerAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private containerExtractor: ContainerReferenceExtractor;

    constructor() {
        this.containerExtractor = new ContainerReferenceExtractor();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.containerExtractor.initialize(context);
    }

    /**
     * Analyze and display nested container chains
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        console.log(ansiColors.cyan('\n🔗 NESTED CONTAINER CHAIN ANALYSIS'));
        console.log('==================================================');
        
        this.analyzeContainerRoles(sourceEntities);
        this.analyzeContentToContainerReferences(sourceEntities);
        this.analyzeNestedContainerChains(sourceEntities);
        
        // Add debug sample for user understanding
        this.showDebugSample(sourceEntities);
    }

    /**
     * Show a debug sample to help user understand field relationships
     */
    private showDebugSample(sourceEntities: SourceEntities): void {
        console.log(ansiColors.magenta('\n🔍 DEBUG SAMPLE - Field Structure Analysis'));
        console.log('==================================================');
        
        // Find a content item with multiple container references for demonstration
        const contentToContainerRefs = this.containerExtractor.findContentToContainerReferences(sourceEntities);
        const sampleContent = contentToContainerRefs.find(item => item.referencedContainers.length > 1);
        
        if (sampleContent) {
            const content = sampleContent.content;
            console.log(ansiColors.white(`\n📄 SAMPLE: ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
            console.log(ansiColors.gray('Raw field structure:'));
            
            // Show the actual fields structure (limited depth to avoid overwhelming output)
            this.showFieldStructure(content.fields, '  ', 0, 2);
            
            console.log(ansiColors.yellow('\n🔗 Container references found in these fields:'));
            sampleContent.referencedContainers.forEach((ref, index) => {
                const status = ref.targetContainer ? '✅ FOUND' : '❌ MISSING';
                const containerInfo = ref.targetContainer 
                    ? `ContainerID:${ref.targetContainer.contentViewID} (${ref.targetContainer.referenceName})`
                    : `${ref.containerRef.contentID > 0 ? `ID:${ref.containerRef.contentID}` : `Name:${ref.containerRef.referenceName}`}`;
                
                console.log(ansiColors.blue(`  ${index + 1}. Field: ${ref.containerRef.fieldPath} → ${containerInfo} ${status}`));
            });
            
            console.log(ansiColors.gray('\n💡 This shows how a single content item can reference multiple containers through different fields.'));
            console.log(ansiColors.gray('   Each field that contains a "contentid" or "contentID" creates a container dependency.'));
        } else {
            console.log(ansiColors.gray('No content items with multiple container references found for debugging.'));
        }
    }

    /**
     * Show field structure recursively with limited depth
     */
    private showFieldStructure(obj: any, indent: string, currentDepth: number, maxDepth: number): void {
        if (currentDepth >= maxDepth || !obj || typeof obj !== 'object') {
            if (currentDepth >= maxDepth) {
                console.log(ansiColors.gray(`${indent}... (max depth reached)`));
            }
            return;
        }

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    console.log(ansiColors.gray(`${indent}${key}: [array with ${value.length} items]`));
                    if (value.length > 0 && currentDepth < maxDepth - 1) {
                        this.showFieldStructure(value[0], `${indent}  [0] `, currentDepth + 1, maxDepth);
                        if (value.length > 1) {
                            console.log(ansiColors.gray(`${indent}  ... and ${value.length - 1} more items`));
                        }
                    }
                } else {
                    console.log(ansiColors.gray(`${indent}${key}:`));
                    this.showFieldStructure(value, `${indent}  `, currentDepth + 1, maxDepth);
                }
            } else {
                // Highlight container ID fields
                if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                    console.log(ansiColors.yellow(`${indent}${key}: ${value} 🔗 (CONTAINER REFERENCE)`));
                } else {
                    const displayValue = typeof value === 'string' && value.length > 50 
                        ? `"${value.substring(0, 50)}..."` 
                        : JSON.stringify(value);
                    console.log(ansiColors.gray(`${indent}${key}: ${displayValue}`));
                }
            }
        }
    }

    /**
     * Analyze container roles (LIST vs ITEM containers)
     */
    private analyzeContainerRoles(sourceEntities: SourceEntities): void {
        const categorization = this.containerExtractor.categorizeContainersByRole(sourceEntities);
        
        console.log(ansiColors.yellow('\n📊 CONTAINER ROLE CATEGORIZATION:'));
        console.log(`  📋 List Containers: ${categorization.listContainers.length}`);
        console.log(`  📄 Item Containers: ${categorization.itemContainers.length}`);
        console.log(`  📦 Standalone Containers: ${categorization.standaloneContainers.length}`);
        console.log(`  🔗 Nested Chain Roots: ${categorization.nestedChainRoots.length}`);

        // Examples removed to reduce output clutter

        if (categorization.nestedChainRoots.length > 0) {
            console.log(ansiColors.blue('\n  🔗 Containers with nested dependencies:'));
            categorization.nestedChainRoots.slice(0, 5).forEach((container: any) => {
                console.log(ansiColors.blue(`    - ContainerID:${container.contentViewID} (${container.referenceName})`));
            });
            if (categorization.nestedChainRoots.length > 5) {
                console.log(ansiColors.blue(`    ... and ${categorization.nestedChainRoots.length - 5} more`));
            }
        }
    }

    /**
     * Analyze content→container references (MUCH CLEANER VERSION)
     */
    private analyzeContentToContainerReferences(sourceEntities: SourceEntities): void {
        const contentToContainerRefs = this.containerExtractor.findContentToContainerReferences(sourceEntities);
        
        if (contentToContainerRefs.length === 0) {
            console.log(ansiColors.gray('\n📝 No content→container references found'));
            return;
        }

        let totalReferences = 0;
        let resolvedReferences = 0;
        
        // Calculate summary statistics
        contentToContainerRefs.forEach(item => {
            item.referencedContainers.forEach(ref => {
                totalReferences++;
                if (ref.targetContainer) {
                    resolvedReferences++;
                }
            });
        });

        const resolutionRate = totalReferences > 0 ? ((resolvedReferences / totalReferences) * 100).toFixed(1) : '0';
        
        console.log(ansiColors.cyan(`\n📝 CONTENT→CONTAINER REFERENCES (SOURCE DATA ONLY):`));
        console.log(ansiColors.cyan(`Found ${contentToContainerRefs.length} content items with container references`));
        console.log(ansiColors.cyan(`📊 Source Data Resolution: ${resolvedReferences}/${totalReferences} (${resolutionRate}%) found in downloaded data`));
        
        // Only show issues if there are significant problems
        if (resolvedReferences < totalReferences) {
            const missingCount = totalReferences - resolvedReferences;
            console.log(ansiColors.yellow(`⚠️  ${missingCount} container references need verification`));
        }
    }



    /**
     * Get source GUID from context
     */
    private getSourceGuid(): string {
        return this.context?.sourceGuid || 'unknown';
    }

    /**
     * Analyze complete nested container chains (CLEANED UP VERSION)
     */
    private analyzeNestedContainerChains(sourceEntities: SourceEntities): void {
        const nestedChains = this.containerExtractor.buildNestedContainerChains(sourceEntities, 3);
        
        if (nestedChains.length === 0) {
            console.log(ansiColors.gray('\n🔗 No nested container chains detected'));
            return;
        }

        console.log(ansiColors.yellow(`\n🔗 NESTED CONTAINER CHAINS (SOURCE DATA ONLY): ${nestedChains.length} chains detected`));
        
        nestedChains.slice(0, 5).forEach((chain, index) => {
            this.displayNestedChain(chain, sourceEntities);
        });

        if (nestedChains.length > 5) {
            console.log(ansiColors.gray(`\n  ... and ${nestedChains.length - 5} more nested chains`));
        }

        // Summary statistics
        const totalContentWithRefs = nestedChains.reduce((sum, chain) => sum + chain.contentItems.length, 0);
        const totalContainerRefs = nestedChains.reduce((sum, chain) => 
            sum + chain.contentItems.reduce((innerSum, item) => innerSum + item.referencedContainers.length, 0), 0
        );
        
        // Summary already displayed by container-chain-analyzer.ts to avoid duplication
    }

    /**
     * Display a single nested container chain (PURE SOURCE ANALYSIS ONLY)
     */
    private displayNestedChain(chain: NestedContainerChain, sourceEntities: SourceEntities): void {
        console.log(ansiColors.white(`\n  ContainerID:${chain.sourceContainer.contentViewID} (${chain.sourceContainer.referenceName || 'No Name'})`));
        console.log(ansiColors.gray(`    Path: ${chain.path.join(' → ')}`));
        
        chain.contentItems.forEach((item, itemIndex) => {
            const content = item.content;
            const isLastItem = itemIndex === chain.contentItems.length - 1;
            const itemPrefix = isLastItem ? '└─' : '├─';
            
            console.log(ansiColors.blue(`    ${itemPrefix} ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
            
            item.referencedContainers.forEach((ref, refIndex) => {
                const isLastRef = refIndex === item.referencedContainers.length - 1;
                const refPrefix = isLastItem ? (isLastRef ? '    └─' : '    ├─') : (isLastRef ? '│   └─' : '│   ├─');
                
                if (ref.contentID > 0) {
                    // Look up the referenced container IN SOURCE DATA ONLY
                    const targetContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === ref.contentID);
                    if (targetContainer) {
                        console.log(ansiColors.green(`${refPrefix} ✅ ContainerID:${targetContainer.contentViewID} (${targetContainer.referenceName}) [FOUND IN SOURCE]`));
                    } else {
                        console.log(ansiColors.red(`${refPrefix} ❌ ContainerID:${ref.contentID} [MISSING FROM SOURCE DATA]`));
                    }
                } else if (ref.referenceName) {
                    // Look up by reference name IN SOURCE DATA ONLY
                    const targetContainer = sourceEntities.containers?.find((c: any) => 
                        c.referenceName && c.referenceName.toLowerCase() === ref.referenceName.toLowerCase()
                    );
                    if (targetContainer) {
                        console.log(ansiColors.green(`${refPrefix} ✅ Container:${targetContainer.referenceName} (ID:${targetContainer.contentViewID}) [FOUND IN SOURCE]`));
                    } else {
                        console.log(ansiColors.red(`${refPrefix} ❌ Container:${ref.referenceName} [MISSING FROM SOURCE DATA]`));
                    }
                }
            });
        });
    }
} 