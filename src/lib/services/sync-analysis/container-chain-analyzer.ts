/**
 * Container Chain Analyzer Service
 * 
 * Handles analysis and display of container dependency chains.
 * Shows containers not in page chains and their dependencies.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from '../../../types/syncAnalysis';
import { AssetReferenceExtractor } from './asset-reference-extractor';
import { ContainerReferenceExtractor } from './container-reference-extractor';
import { DependencyFinder } from './dependency-finder';

export class ContainerChainAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private assetExtractor: AssetReferenceExtractor;
    private containerExtractor: ContainerReferenceExtractor;
    private dependencyFinder: DependencyFinder;

    constructor() {
        this.assetExtractor = new AssetReferenceExtractor();
        this.containerExtractor = new ContainerReferenceExtractor();
        this.dependencyFinder = new DependencyFinder();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.assetExtractor.initialize(context);
        this.containerExtractor.initialize(context);
        this.dependencyFinder.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showContainerChains(sourceEntities);
    }

    /**
     * Show containers not in page chains with their dependencies
     */
    showContainerChains(sourceEntities: SourceEntities): void {
        if (!sourceEntities.containers || sourceEntities.containers.length === 0) {
            console.log(ansiColors.gray('  No containers found in source data'));
            return;
        }

        // First, identify all containers that were processed in page chains
        const containersInPageChains = new Set<number>();
        
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.containerExtractor.collectContainerIdsFromPageZones(page.zones, sourceEntities, containersInPageChains);
            });
        }

        // Find containers NOT in page chains
        const containersNotInPages = sourceEntities.containers.filter((container: any) => 
            !containersInPageChains.has(container.contentViewID)
        );

        if (containersNotInPages.length === 0) {
            console.log(ansiColors.green('  All containers are already included in page chains'));
            return;
        }

        console.log(ansiColors.yellow(`Found ${containersNotInPages.length} containers not in page chains:`));
        
        // Separate containers with content from those without
        const containersWithContent: any[] = [];
        const containersWithoutContent: any[] = [];
        
        containersNotInPages.forEach((container: any) => {
            const containerContent = sourceEntities.content?.filter((content: any) => 
                content.properties?.referenceName === container.referenceName
            ) || [];
            
            if (containerContent.length > 0) {
                containersWithContent.push({ container, contentCount: containerContent.length });
            } else {
                containersWithoutContent.push(container);
            }
        });
        
        // TRUNCATED: Show summary only to improve console readability
        if (containersWithoutContent.length > 0) {
            console.log(ansiColors.gray(`\n   🏗️  ${containersWithoutContent.length} empty containers (component templates, system containers, and orphaned items)`));
        }
        
        // 📄 Display containers WITH content (limited for readability)
        if (containersWithContent.length > 0) {
            console.log(ansiColors.cyan(`\n📋 CONTAINERS WITH CONTENT (${containersWithContent.length} containers):`));
            
            // Categorize containers with content
            const contentCategories = {
                instance: [] as any[],
                store: [] as any[],
                other: [] as any[]
            };
            
            containersWithContent.forEach(({ container, contentCount }) => {
                const analysis = this.analyzeContainerPattern(container, sourceEntities);
                if (analysis.category === 'instance') {
                    contentCategories.instance.push({ container, contentCount, analysis });
                } else if (analysis.category === 'store') {
                    contentCategories.store.push({ container, contentCount, analysis });
                } else {
                    contentCategories.other.push({ container, contentCount, analysis });
                }
            });
            
            // 📄 PAGE COMPONENT INSTANCES (limited display)
            if (contentCategories.instance.length > 0) {
                console.log(ansiColors.cyan(`\n   📄 PAGE COMPONENT INSTANCES (${contentCategories.instance.length} containers):`));
                console.log(ansiColors.cyan('      User-created component instances with content'));
                const displayLimit = 3;
                contentCategories.instance.slice(0, displayLimit).forEach(({ container, contentCount, analysis }) => {
                    console.log(ansiColors.white(`\n      ContainerID:${container.contentViewID} (${container.referenceName}) - ${contentCount} items`));
                    console.log(ansiColors.gray(`        ${analysis.reason}`));
                    this.showContainerDependencyHierarchy(container, sourceEntities, '        ');
                });
                if (contentCategories.instance.length > displayLimit) {
                    const remaining = contentCategories.instance.length - displayLimit;
                    console.log(ansiColors.gray(`      ... and ${remaining} more component instances`));
                }
            }
            
            // 📦 CONTENT STORES (limited display)
            if (contentCategories.store.length > 0) {
                console.log(ansiColors.cyan(`\n   📦 CONTENT STORES (${contentCategories.store.length} containers):`));
                console.log(ansiColors.cyan('      Data repositories with content'));
                const displayLimit = 5;
                contentCategories.store.slice(0, displayLimit).forEach(({ container, contentCount, analysis }) => {
                    console.log(ansiColors.white(`\n      ContainerID:${container.contentViewID} (${container.referenceName}) - ${contentCount} items`));
                    console.log(ansiColors.gray(`        ${analysis.reason}`));
                    this.showContainerDependencyHierarchy(container, sourceEntities, '        ');
                });
                if (contentCategories.store.length > displayLimit) {
                    const remaining = contentCategories.store.length - displayLimit;
                    console.log(ansiColors.gray(`      ... and ${remaining} more content stores`));
                }
            }
            
            // 📂 OTHER CONTAINERS (limited display)
            if (contentCategories.other.length > 0) {
                console.log(ansiColors.cyan(`\n   📂 OTHER CONTAINERS (${contentCategories.other.length} containers):`));
                const displayLimit = 10;
                contentCategories.other.slice(0, displayLimit).forEach(({ container, contentCount, analysis }) => {
                    console.log(ansiColors.white(`\n      ContainerID:${container.contentViewID} (${container.referenceName}) - ${contentCount} items`));
                    console.log(ansiColors.gray(`        ${analysis.pattern}: ${analysis.reason}`));
                    this.showContainerDependencyHierarchy(container, sourceEntities, '        ');
                });
                if (contentCategories.other.length > displayLimit) {
                    const remaining = contentCategories.other.length - displayLimit;
                    console.log(ansiColors.gray(`      ... and ${remaining} more containers`));
                }
            }
        }
    }

    /**
     * Show nested container chain analysis with cleaner output
     */
    showNestedContainerChains(sourceEntities: SourceEntities): void {
        const nestedChains = this.containerExtractor.buildNestedContainerChains(sourceEntities);
        
        if (nestedChains.length === 0) {
            console.log(ansiColors.gray('  No nested container chains detected'));
            return;
        }

        // Only show the most important nested chains
        const importantChains = nestedChains.filter(chain => 
            chain.contentItems.length > 0 && chain.depth <= 2
        );

        if (importantChains.length === 0) {
            console.log(ansiColors.gray('  No significant nested container chains detected'));
            return;
        }

        console.log(ansiColors.cyan(`\n📋 IMPORTANT NESTED CHAINS: ${importantChains.length} chains detected\n`));

        importantChains.slice(0, 5).forEach((chain: any) => {
            console.log(ansiColors.white(`  ContainerID:${chain.sourceContainer.contentViewID} (${chain.sourceContainer.referenceName})`));
            console.log(ansiColors.gray(`    Path: ${chain.path.join(' → ')}`));
            
            chain.contentItems.forEach((item: any) => {
                const contentInfo = `ContentID:${item.content.contentID} (${item.content.properties?.referenceName || 'Unknown'})`;
                const state = this.getPublicationState(item.content);
                console.log(ansiColors.blue(`    ├─ ${contentInfo}${state}`));
                
                item.referencedContainers.forEach((ref: any) => {
                    const targetContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === ref.contentID);
                    if (targetContainer) {
                        console.log(ansiColors.green(`    │   └─ ✅ ContainerID:${targetContainer.contentViewID} (${targetContainer.referenceName}) [FOUND IN SOURCE]`));
                    } else {
                        console.log(ansiColors.red(`    │   └─ ❌ ContainerID:${ref.contentID} [MISSING IN SOURCE]`));
                    }
                });
            });
            console.log('');
        });

        if (importantChains.length > 5) {
            console.log(ansiColors.gray(`... and ${importantChains.length - 5} more nested chains`));
        }

        // Summary
        const totalContainers = new Set(importantChains.map(c => c.sourceContainer.contentViewID)).size;
        const totalContentItems = importantChains.reduce((sum, chain) => sum + chain.contentItems.length, 0);
        const totalReferences = importantChains.reduce((sum, chain) => 
            sum + chain.contentItems.reduce((itemSum: number, item: any) => 
                itemSum + item.referencedContainers.length, 0), 0);

        console.log(ansiColors.cyan(`📊 Nested Chain Summary (Source Data Only):`));
        console.log(ansiColors.cyan(`   ${totalContainers} containers have nested dependencies`));
        console.log(ansiColors.cyan(`   ${totalContentItems} content items contain container references`));
        console.log(ansiColors.cyan(`   ${totalReferences} total container references in nested chains`));
    }

    /**
     * 🧠 COMPLEX RELATIONSHIP PATTERNS DISCOVERED:
     * 
     * 1. **Naming Convention Patterns**:
     *    - `about_RichTextArea51` = RichTextArea container for "about" page/section
     *    - `home_PromoBanner123` = PromoBanner container for "home" page  
     *    - `news1_Footer` = Footer container for "news1" page
     *    - Pattern: {page/section}_{componentType}{optional_id}
     * 
     * 2. **Bidirectional Relationships**:
     *    - Model → Container (model defines container structure)
     *    - Container ← Content (content is stored in container) 
     *    - Content → Assets (content references assets)
     *    - Content → Galleries (content references galleries)
     *    - Content → Content (content-to-content relationships)
     *    - Container → Container (nested container references)
     * 
     * 3. **Orphaned Container Root Causes**:
     *    - Page deleted but containers remain (`about_*` containers with no "about" page)
     *    - System containers (`AgilityCSSFiles`, `AgilityJavascriptFiles`) 
     *    - Empty containers defined but never populated
     *    - Unused templates/components
     * 
     * 4. **List vs Item Container Patterns**:
     *    - `FooterDownloadOptions` = List container (holds multiple items)
     *    - `FooterDownloadButtons` = Item container (individual button config)
     *    - `Categories` = List container for category items
     *    - Pattern detection: Plural names often indicate list containers
     */

    /**
     * Get publication state for content item
     */
    private getPublicationState(content: any): string {
        if (!content?.properties?.state) return '';
        
        const state = content.properties.state;
        switch (state) {
            case 0: return ansiColors.gray(' [DRAFT]');
            case 1: return ansiColors.yellow(' [AWAITING APPROVAL]'); 
            case 2: return ansiColors.green(' [PUBLISHED]');
            case 3: return ansiColors.red(' [UNPUBLISHED]');
            default: return ansiColors.gray(` [STATE:${state}]`);
        }
    }

    /**
     * 🔍 Analyze container naming patterns and orphaned reasons
     * 🎯 ENHANCED: Template vs Instance Architecture Understanding
     */
    private analyzeContainerPattern(container: any, sourceEntities: SourceEntities): {
        pattern: string;
        reason: string;
        isLikelyList: boolean;
        category: 'template' | 'instance' | 'store' | 'system' | 'orphaned';
        sequentialInfo?: string;
    } {
        const refName = container.referenceName || '';
        const containerID = container.contentViewID || container.id;
        
        // ⚙️ SYSTEM CONTAINER DETECTION (FIRST - highest priority)
        // CMS infrastructure: AgilityCSSFiles, etc.
        if (refName.startsWith('Agility')) {
            return {
                pattern: '⚙️ System Container',
                reason: 'Built-in Agility CMS system container',
                isLikelyList: false,
                category: 'system'
            };
        }
        
        // 📦 CONTENT STORE DETECTION (SECOND - check for data repositories)
        // Data repositories: Categories, Posts, i18, etc.
        if (this.isContentStore(container, sourceEntities)) {
            const contentCount = this.getContainerContentCount(container, sourceEntities);
            return {
                pattern: '📦 Content Store',
                reason: `Data repository with ${contentCount} content items`,
                isLikelyList: true,
                category: 'store'
            };
        }
        
        // 🎨 COMPONENT TEMPLATE DETECTION (THIRD - architectural templates)
        // Template containers: Low IDs, empty by design, match model names
        if (this.isComponentTemplate(container, sourceEntities)) {
            return {
                pattern: '🎨 Component Template',
                reason: 'Empty by design - architectural foundation for component instances',
                isLikelyList: false,
                category: 'template'
            };
        }
        
        // 📄 PAGE COMPONENT INSTANCE DETECTION (FOURTH - user instances)
        // Instance containers: High sequential IDs, page-scoped, with content
        const instancePattern = this.detectInstancePattern(container, sourceEntities);
        if (instancePattern) {
            return {
                pattern: `📄 Page Component Instance (${instancePattern.pagePrefix}_*)`,
                reason: `User-created instance of ${instancePattern.componentType} component`,
                isLikelyList: false,
                category: 'instance',
                sequentialInfo: instancePattern.sequentialInfo
            };
        }
        
        // 🚫 ORPHANED DETECTION (LAST - fallback for unmatched)
        const underscoreIndex = refName.indexOf('_');
        const pagePrefix = underscoreIndex > 0 ? refName.substring(0, underscoreIndex) : '';
        
        // Check if page exists
        const hasMatchingPage = sourceEntities.pages?.some((page: any) => 
            page.name?.toLowerCase().includes(pagePrefix.toLowerCase()) ||
            page.path?.toLowerCase().includes(pagePrefix.toLowerCase())
        );
        
        // Detect list vs item patterns
        const isLikelyList = refName.endsWith('s') || 
                            refName.includes('Options') || 
                            refName.includes('Categories') ||
                            refName.includes('Items');
        
        if (pagePrefix && !hasMatchingPage) {
            return {
                pattern: `🚫 Orphaned (${pagePrefix}_*)`,
                reason: `Created for "${pagePrefix}" page/section that may no longer exist`,
                isLikelyList,
                category: 'orphaned'
            };
        } else if (isLikelyList) {
            return {
                pattern: '📦 List Container',
                reason: 'Designed to hold multiple content items',
                isLikelyList: true,
                category: 'store'
            };
        } else {
            return {
                pattern: '❓ Unknown Component',
                reason: 'Standalone component or unclassified pattern',
                isLikelyList: false,
                category: 'orphaned'
            };
        }
    }

    /**
     * 🎨 Detect Component Template Containers
     * Template containers: Low IDs, empty by design, match model names, NOT system containers
     */
    private isComponentTemplate(container: any, sourceEntities: SourceEntities): boolean {
        const refName = container.referenceName || '';
        const containerID = container.contentViewID || container.id;
        const contentCount = this.getContainerContentCount(container, sourceEntities);
        
        // Exclude system containers first
        if (refName.startsWith('Agility')) {
            return false;
        }
        
        // Template indicators:
        // 1. Low container IDs (typically < 100 for templates) OR 
        // 2. Empty (no content items) AND matches component naming pattern
        // 3. Not page-scoped (no underscore prefix pattern for pages)
        
        const hasUnderscore = refName.includes('_');
        const isLowID = containerID && containerID < 100;
        const isEmpty = contentCount === 0;
        
        // Simple component names without page prefixes are likely templates
        if (!hasUnderscore && isEmpty && (isLowID || this.looksLikeComponentName(refName, sourceEntities))) {
            return true;
        }
        
        // Page-scoped empty containers might also be templates if they have very low IDs
        if (hasUnderscore && isEmpty && isLowID && containerID < 50) {
            return true;
        }
        
        return false;
    }

    /**
     * 🔍 Check if name looks like a component name
     */
    private looksLikeComponentName(refName: string, sourceEntities: SourceEntities): boolean {
        // Check if container name closely matches a model name
        const model = sourceEntities.models?.find((m: any) => {
            const modelName = m.referenceName || m.displayName || '';
            return modelName.toLowerCase().includes(refName.toLowerCase()) ||
                   refName.toLowerCase().includes(modelName.toLowerCase());
        });
        
        return !!model;
    }

    /**
     * 📄 Detect Page Component Instance Pattern
     * Instance containers: High sequential IDs, page-scoped, with content
     */
    private detectInstancePattern(container: any, sourceEntities: SourceEntities): {
        pagePrefix: string;
        componentType: string;
        sequentialInfo: string;
    } | null {
        const refName = container.referenceName || '';
        const containerID = container.contentViewID || container.id;
        
        // Instance pattern: {page}_{ComponentType}{hash} or {page}_{ComponentType}
        const underscoreIndex = refName.indexOf('_');
        if (underscoreIndex <= 0) return null;
        
        const pagePrefix = refName.substring(0, underscoreIndex);
        const componentPart = refName.substring(underscoreIndex + 1);
        
        // Extract component type and hash
        const hashMatch = componentPart.match(/^([A-Za-z]+)([A-F0-9]+)$/);
        const componentType = hashMatch ? hashMatch[1] : componentPart;
        const hash = hashMatch ? hashMatch[2] : '';
        
        // Check if this looks like an instance (page exists + has content)
        const hasMatchingPage = sourceEntities.pages?.some((page: any) => 
            page.name?.toLowerCase().includes(pagePrefix.toLowerCase()) ||
            page.path?.toLowerCase().includes(pagePrefix.toLowerCase())
        );
        
        const contentCount = this.getContainerContentCount(container, sourceEntities);
        
        if (hasMatchingPage && contentCount > 0 && containerID && containerID > 100) {
            // Look for sequential patterns (123→124→125)
            const sequentialInfo = this.detectSequentialPattern(containerID, componentType, sourceEntities);
            
            return {
                pagePrefix,
                componentType,
                sequentialInfo
            };
        }
        
        return null;
    }

    /**
     * 📦 Detect Content Store Containers
     * Data repositories: Categories, Posts, i18, etc.
     */
    private isContentStore(container: any, sourceEntities: SourceEntities): boolean {
        const refName = container.referenceName || '';
        const contentCount = this.getContainerContentCount(container, sourceEntities);
        
        // Exclude system containers first
        if (refName.startsWith('Agility')) {
            return false;
        }
        
        // Content store indicators:
        // 1. Known data type names (Categories, Posts, i18, etc.)
        // 2. Plural names indicating lists (not page-scoped)
        // 3. High content count (> 5 items typically)
        // 4. Model names that suggest data storage
        
        const isKnownDataType = refName.match(/^(Categories|Posts|i18|Items|Options|Lists?|employees|player\s+details|Translation|Translations)$/i);
        const isPluralName = refName.endsWith('s') && !refName.includes('_');
        const hasHighContentCount = contentCount > 5;
        const isNotPageScoped = !refName.includes('_');
        
        // Check if model suggests data storage
        const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
        const modelSuggestsStorage = model && (
            model.referenceName?.match(/^(Category|Post|Employee|Player|Translation|i18)/i) ||
            model.displayName?.match(/^(Category|Post|Employee|Player|Translation|i18)/i)
        );
        
        // Data stores can be empty (newly created) or have content
        return isNotPageScoped && (
            isKnownDataType || 
            (isPluralName && !refName.match(/^(Posts|Items)$/)) ||  // Exclude generic "Posts" unless it has content
            hasHighContentCount ||
            modelSuggestsStorage
        );
    }

    /**
     * 🔍 Detect Sequential Container Pattern
     * Shows user activity timeline: 123→124→125
     */
    private detectSequentialPattern(containerID: number, componentType: string, sourceEntities: SourceEntities): string {
        if (!sourceEntities.containers) return '';
        
        // Find other containers with same component type
        const sameTypeContainers = sourceEntities.containers
            .filter((c: any) => {
                const refName = c.referenceName || '';
                return refName.includes(componentType) && c.contentViewID !== containerID;
            })
            .map((c: any) => c.contentViewID || c.id)
            .filter((id: number) => id && Math.abs(id - containerID) < 10) // Within 10 IDs
            .sort((a: number, b: number) => a - b);
        
        if (sameTypeContainers.length > 0) {
            const allIds = [...sameTypeContainers, containerID].sort((a, b) => a - b);
            const position = allIds.indexOf(containerID) + 1;
            return `Sequential ${position}/${allIds.length}: ${allIds.join('→')}`;
        }
        
        return '';
    }

    /**
     * 📊 Get Content Count for Container
     */
    private getContainerContentCount(container: any, sourceEntities: SourceEntities): number {
        if (!sourceEntities.content) return 0;
        
        return sourceEntities.content.filter((content: any) => 
            content.properties?.referenceName === container.referenceName
        ).length;
    }

    /**
     * Show complete dependency hierarchy for a single container
     * 🚨 FIXED: Proper Model→Container→Content hierarchy display
     */
    showContainerDependencyHierarchy(container: any, sourceEntities: SourceEntities, indent: string): void {
        // Show the model that DEFINES this container (Model → Container)
        if (container.contentDefinitionID) {
            const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
            if (model) {
                // Check if this model was already displayed
                const isAlreadyDisplayed = this.context?.modelTracker?.isModelDisplayed(model.referenceName) ?? false;
                
                if (isAlreadyDisplayed) {
                    console.log(ansiColors.gray(`${indent}├─ 🏗️  DEFINED BY Model:${model.referenceName} (${model.displayName || 'No Name'}) [DUPLICATE]`));
                } else {
                    console.log(ansiColors.green(`${indent}├─ 🏗️  DEFINED BY Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                    // Mark as displayed if we have a tracker
                    this.context?.modelTracker?.markModelDisplayed(model.referenceName);
                }
            } else {
                console.log(ansiColors.red(`${indent}├─ 🏗️  DEFINED BY Model:ID_${container.contentDefinitionID} - MISSING IN SOURCE DATA`));
            }
        }

        // Show content items STORED IN this container (Container → Content)
        if (sourceEntities.content) {
            const containerContent = sourceEntities.content.filter((content: any) => 
                content.properties?.referenceName === container.referenceName
            );
            
            if (containerContent.length > 0) {
                console.log(ansiColors.blue(`${indent}├─ 📦 CONTAINS: ${containerContent.length} content items`));
                
                // Show first 3 content items
                const itemsToShow = Math.min(3, containerContent.length);
                containerContent.slice(0, itemsToShow).forEach((content: any, index: number) => {
                    const isLast = index === itemsToShow - 1 && containerContent.length <= 3;
                    const prefix = isLast ? '└─' : '├─';
                    const state = this.getPublicationState(content);
                    console.log(ansiColors.blue(`${indent}│  ${prefix} ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})${state}`));
                    
                    // Show content's assets
                    this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                });
                
                // Show truncation message if needed
                if (containerContent.length > 3) {
                    console.log(ansiColors.gray(`${indent}│  └─ ... and ${containerContent.length - 3} more content items`));
                }
            } else {
                console.log(ansiColors.gray(`${indent}├─ 📦 CONTAINS: No content items (empty container)`));
            }
        }

        // Show nested container dependencies (container → container)
        if (container.fields) {
            const nestedContainers = this.containerExtractor.extractNestedContainerReferences(container.fields);
            nestedContainers.forEach((nestedRef: any) => {
                const nestedContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === nestedRef.contentID);
                if (nestedContainer) {
                    console.log(ansiColors.blue(`${indent}├─ ContainerID:${nestedContainer.contentViewID} (${nestedContainer.referenceName || 'No Name'})`));
                    
                    // Show nested container's model
                    if (nestedContainer.contentDefinitionID) {
                        const nestedModel = sourceEntities.models?.find((m: any) => m.referenceName === nestedContainer.contentDefinitionID);
                        if (nestedModel) {
                            // Check if this model was already displayed
                            const isAlreadyDisplayed = this.context?.modelTracker?.isModelDisplayed(nestedModel.referenceName) ?? false;
                            
                            if (isAlreadyDisplayed) {
                                console.log(ansiColors.gray(`${indent}│  ├─ Model:${nestedModel.referenceName} (${nestedModel.displayName || 'No Name'}) [DUPLICATE]`));
                            } else {
                                console.log(ansiColors.green(`${indent}│  ├─ Model:${nestedModel.referenceName} (${nestedModel.displayName || 'No Name'})`));
                                // Mark as displayed if we have a tracker
                                this.context?.modelTracker?.markModelDisplayed(nestedModel.referenceName);
                            }
                        } else {
                            console.log(ansiColors.red(`${indent}│  ├─ Model:${nestedContainer.contentDefinitionID} - MISSING IN SOURCE DATA`));
                        }
                    }
                } else {
                    console.log(ansiColors.red(`${indent}├─ ContainerID:${nestedRef.contentID} - MISSING IN SOURCE DATA`));
                }
            });
        }

        // Show container's asset dependencies
        this.showContainerAssetDependencies(container, sourceEntities, `${indent}`);
    }

    /**
     * Show container asset dependencies
     */
    showContainerAssetDependencies(container: any, sourceEntities: SourceEntities, indent: string): void {
        if (!sourceEntities.content) return;

        // Find content items that reference this container's contentDefinitionID
        const containerContent = sourceEntities.content.filter((c: any) => 
            c.contentDefinitionID === container.contentDefinitionID
        );

        containerContent.forEach((content: any) => {
            if (!content.fields) return;

            const assetRefs = this.assetExtractor.extractAssetReferences(content.fields);
            assetRefs.forEach((assetRef: any) => {
                const asset = sourceEntities.assets?.find((a: any) => 
                    a.originUrl === assetRef.url || 
                    a.url === assetRef.url ||
                    a.edgeUrl === assetRef.url
                );
                if (asset) {
                    console.log(`${indent}├─ ${ansiColors.yellow(`Asset:${asset.fileName || assetRef.url}`)}`);
                    // Check gallery dependency if asset has one  
                    if (asset.mediaGroupingID) {
                        const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                        if (gallery) {
                            console.log(`${indent}│  ├─ ${ansiColors.magenta(`Gallery:${gallery.name || gallery.mediaGroupingID}`)}`);
                        }
                    }
                } else {
                    console.log(`${indent}├─ ${ansiColors.red(`Asset:${assetRef.url} - MISSING IN SOURCE DATA`)}`);
                }
            });
        });
    }

    /**
     * Show content asset dependencies (delegated to asset extractor)
     */
    private showContentAssetDependencies(content: any, sourceEntities: SourceEntities, indent: string): void {
        this.assetExtractor.showContentAssetDependencies(content, sourceEntities, indent);
    }
} 