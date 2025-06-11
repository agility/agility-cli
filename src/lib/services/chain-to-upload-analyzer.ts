/**
 * Chain-to-Upload Order Analyzer
 * 
 * Task 21.9.1.1: Analyze existing chain structures for dependency ordering
 * 
 * This service analyzes the gap between current upload sequencing and 
 * dependency-aware chain analysis to design proper upload ordering.
 */

import ansiColors from 'ansi-colors';

export interface UploadOrderingAnalysis {
    currentSequence: {
        order: string[];
        reasoning: string[];
        dependencies: string[];
    };
    chainAnalysisResults: {
        modelChains: DependencyChain[];
        pageChains: DependencyChain[];
        containerChains: DependencyChain[];
        nonChainedItems: EntityBreakdown;
    };
    recommendedSequence: {
        order: string[];
        reasoning: string[];
        implementation: ImplementationStep[];
    };
    gapAnalysis: {
        missingDependencies: string[];
        improperOrderings: string[];
        optimizations: string[];
    };
}

export interface DependencyChain {
    id: string;
    type: 'model' | 'page' | 'container';
    entities: ChainEntity[];
    dependencies: string[];
    level: number; // Depth in dependency tree
}

export interface ChainEntity {
    type: 'Model' | 'Template' | 'Container' | 'Content' | 'Page' | 'Asset' | 'Gallery';
    id: string | number;
    name: string;
    dependencies: string[];
    dependents: string[];
}

export interface EntityBreakdown {
    pages: ChainEntity[];
    content: ChainEntity[];
    models: ChainEntity[];
    templates: ChainEntity[];
    assets: ChainEntity[];
    galleries: ChainEntity[];
}

export interface ImplementationStep {
    phase: string;
    description: string;
    entities: string[];
    rationale: string;
    prerequisites: string[];
}

export class ChainToUploadAnalyzer {
    
    /**
     * ANALYSIS RESULT: Current Upload Sequence (from push.ts)
     * 
     * ✅ CURRENT SEQUENCE (Line 114+):
     * 1. Galleries (getGalleriesFromFileSystem → pushGalleries)
     * 2. Assets (getAssetsFromFileSystem → pushAssets) 
     * 3. Models (getModelsFromFileSystem → pushModels)
     * 4. Containers (getContainersFromFileSystem → pushContainers)
     * 5. Content (getContentItemsFromFileSystem → pushContentItems)
     * 6. Templates (getTemplatesFromFileSystem → pushTemplates)
     * 7. Pages (getPagesFromFileSystem → pushPages)
     */
    getCurrentUploadSequence(): UploadOrderingAnalysis['currentSequence'] {
        return {
            order: [
                'Galleries',
                'Assets', 
                'Models',
                'Containers',
                'Content',
                'Templates',
                'Pages'
            ],
            reasoning: [
                '✅ Galleries first - Good (assets may reference galleries)',
                '✅ Assets second - Good (content may reference assets)',
                '✅ Models third - Good (containers depend on models)',
                '✅ Containers fourth - Good (content depends on containers)',
                '✅ Content fifth - Good (templates/pages may reference content)',
                '⚠️ Templates sixth - POTENTIAL ISSUE (pages depend on templates)',
                '⚠️ Pages last - POTENTIAL ISSUE (hierarchical dependencies not considered)'
            ],
            dependencies: [
                'Assets → Galleries (assets can be organized in galleries)',
                'Containers → Models (containers require content definitions)',
                'Content → Containers (content items belong to containers)',
                'Content → Assets (content fields may reference assets)',
                'Pages → Templates (pages require page templates)',
                'Pages → Content (pages may reference content via containers)',
                'Child Pages → Parent Pages (hierarchical page structure)'
            ]
        };
    }

    /**
     * ANALYSIS RESULT: Chain Analysis Patterns (from comprehensive-analysis-runner.ts)
     * 
     * 🔍 CHAIN ANALYSIS REVEALS:
     * 1. Model-to-Model Chains: Circular dependencies between models (Model A references Model B)
     * 2. Page Chains: Template → Container → Model → Content → Asset → Gallery hierarchies
     * 3. Container Chains: Independent containers not in page chains
     * 4. Non-Chained Items: Standalone entities not referenced by any chains
     * 
     * 📊 6-STEP ANALYSIS (from test results):
     * - Total entities: 6,076 (100% reconciliation)
     * - Page chains: 16 in chains, 9 out (hierarchical dependencies)
     * - Content: 5,700 in chains, 41 out (most content is dependency-linked)
     * - Models: 66 in chains, 6 out (most models have relationships)
     */
    getChainAnalysisPatterns(): UploadOrderingAnalysis['chainAnalysisResults'] {
        return {
            modelChains: [
                {
                    id: 'post-category-chain',
                    type: 'model',
                    entities: [
                        { type: 'Model', id: 'Post', name: 'Post', dependencies: ['Category'], dependents: [] },
                        { type: 'Model', id: 'Category', name: 'Category', dependencies: [], dependents: ['Post'] }
                    ],
                    dependencies: ['Category'],
                    level: 1
                },
                {
                    id: 'complex-portal-footer-chain',
                    type: 'model',
                    entities: [
                        { type: 'Model', id: 'PortalFooter', name: 'Portal - Footer', dependencies: ['PortalFooterUsefulLinks', 'PortalFooterLink'], dependents: [] },
                        { type: 'Model', id: 'PortalFooterUsefulLinks', name: 'Portal - Footer Useful Links', dependencies: ['PortalFooterLink'], dependents: ['PortalFooter'] },
                        { type: 'Model', id: 'PortalFooterLink', name: 'Portal - Footer Link', dependencies: [], dependents: ['PortalFooterUsefulLinks', 'PortalFooter'] }
                    ],
                    dependencies: ['PortalFooterLink', 'PortalFooterUsefulLinks'],
                    level: 3
                }
            ],
            pageChains: [
                {
                    id: 'home-page-chain',
                    type: 'page',
                    entities: [
                        { type: 'Page', id: 2, name: 'home', dependencies: ['Main Template'], dependents: [] },
                        { type: 'Template', id: 'Main Template', name: 'Main Template', dependencies: ['home_PromoBannerF9E8E3DA'], dependents: ['home'] },
                        { type: 'Container', id: 115, name: 'home_PromoBannerF9E8E3DA', dependencies: ['PromoBanner'], dependents: ['Main Template'] },
                        { type: 'Model', id: 'PromoBanner', name: 'PromoBanner', dependencies: [], dependents: ['home_PromoBannerF9E8E3DA'] },
                        { type: 'Content', id: 10086, name: 'home_promobannerf9e8e3da', dependencies: ['copy-of-907powerball.png'], dependents: ['home_PromoBannerF9E8E3DA'] },
                        { type: 'Asset', id: 'copy-of-907powerball.png', name: 'copy-of-907powerball.png', dependencies: [], dependents: ['home_promobannerf9e8e3da'] }
                    ],
                    dependencies: ['PromoBanner', 'copy-of-907powerball.png', 'Main Template'],
                    level: 6
                },
                {
                    id: 'hierarchical-page-chain',
                    type: 'page',
                    entities: [
                        { type: 'Page', id: 16, name: 'news (parent)', dependencies: ['Main Template'], dependents: ['news1'] },
                        { type: 'Page', id: 17, name: 'news1 (child)', dependencies: ['news', 'news Template'], dependents: [] },
                        { type: 'Template', id: 'news', name: 'news', dependencies: ['news1_Heading9CB7C0DC'], dependents: ['news1'] }
                    ],
                    dependencies: ['Main Template', 'news Template'],
                    level: 3
                }
            ],
            containerChains: [
                {
                    id: 'standalone-container-chain',
                    type: 'container',
                    entities: [
                        { type: 'Container', id: 72, name: 'i18', dependencies: ['i18Model'], dependents: [] },
                        { type: 'Model', id: 'i18Model', name: 'i18Model', dependencies: [], dependents: ['i18'] },
                        { type: 'Content', id: 1000, name: 'i18 content', dependencies: [], dependents: ['i18'] }
                    ],
                    dependencies: ['i18Model'],
                    level: 2
                }
            ],
            nonChainedItems: {
                pages: [
                    { type: 'Page', id: 33, name: 'helo (No template)', dependencies: [], dependents: [] },
                    { type: 'Page', id: 35, name: 'help (No template)', dependencies: [], dependents: [] }
                ],
                content: [], // 41 items not in chains  
                models: [], // 6 items not in chains
                templates: [], // 2 items not in chains
                assets: [], // 116 items not in chains
                galleries: [] // 4 items not in chains
            }
        };
    }

    /**
     * RECOMMENDATION: Dependency-Aware Upload Sequence
     * 
     * 🎯 OPTIMAL UPLOAD ORDER (Inside-Out Dependency Resolution):
     * 1. **Foundation Phase**: Models (ordered by dependency depth)
     * 2. **Asset Phase**: Galleries → Assets (maintain current good ordering)
     * 3. **Structure Phase**: Templates → Containers (templates needed before containers reference them)
     * 4. **Content Phase**: Content (after models/containers/assets available)
     * 5. **Presentation Phase**: Pages (hierarchical order: parents before children)
     */
    getRecommendedUploadSequence(): UploadOrderingAnalysis['recommendedSequence'] {
        return {
            order: [
                '1. Foundation Models (leaf-level dependencies first)',
                '2. Dependent Models (models that reference other models)',
                '3. Galleries (asset organization)',
                '4. Assets (referenced by content)',
                '5. Templates (required by pages)',
                '6. Containers (require models and templates)',
                '7. Content (requires containers, models, assets)',
                '8. Parent Pages (hierarchical root pages first)',
                '9. Child Pages (hierarchical dependent pages)'
            ],
            reasoning: [
                '✅ Models first - Foundation entities that everything else depends on',
                '✅ Model chains resolved - Handle circular model dependencies properly',
                '✅ Galleries before Assets - Assets may be organized in galleries',
                '✅ Assets before Content - Content fields reference assets',
                '✅ Templates before Pages - Pages require page templates',
                '✅ Containers after Models - Containers require content definitions',
                '✅ Content after everything - Content depends on models, containers, assets',
                '✅ Hierarchical Pages - Parent pages must exist before child pages',
                '✅ Non-chained items - Upload standalone entities safely at end'
            ],
            implementation: [
                {
                    phase: '1. Model Foundation',
                    description: 'Upload models in dependency order (leaf dependencies first)',
                    entities: ['Category', 'PortalFooterLink', 'RichTextArea', '...other leaf models'],
                    rationale: 'Models with no dependencies must exist before dependent models',
                    prerequisites: []
                },
                {
                    phase: '2. Model Dependencies', 
                    description: 'Upload models that reference other models',
                    entities: ['Post (→ Category)', 'PortalFooterUsefulLinks (→ PortalFooterLink)', '...dependent models'],
                    rationale: 'Handle circular and hierarchical model relationships',
                    prerequisites: ['Model Foundation complete']
                },
                {
                    phase: '3. Asset Foundation',
                    description: 'Upload galleries and assets in current good order',
                    entities: ['Galleries', 'Assets'],
                    rationale: 'Maintain proven asset upload sequence',
                    prerequisites: ['Models complete']
                },
                {
                    phase: '4. Template Structure',
                    description: 'Upload page templates before containers/pages use them',
                    entities: ['Main Template', 'news Template', 'GamePage', '...all templates'],
                    rationale: 'Templates must exist before pages can reference them',
                    prerequisites: ['Models and Assets complete']
                },
                {
                    phase: '5. Container Network',
                    description: 'Upload containers that use models and templates',
                    entities: ['All containers in dependency-resolved order'],
                    rationale: 'Containers require models to exist first',
                    prerequisites: ['Models, Assets, Templates complete']
                },
                {
                    phase: '6. Content Population',
                    description: 'Upload content that uses containers, models, and assets',
                    entities: ['All content items in dependency-resolved order'],
                    rationale: 'Content depends on everything else being available',
                    prerequisites: ['All foundation phases complete']
                },
                {
                    phase: '7. Page Hierarchy',
                    description: 'Upload pages in hierarchical order (parents first)',
                    entities: ['Root pages', 'Level 1 children', 'Level 2 children', '...by depth'],
                    rationale: 'Child pages must reference existing parent pages',
                    prerequisites: ['Content phase complete']
                }
            ]
        };
    }

    /**
     * GAP ANALYSIS: Current vs Optimal
     */
    getGapAnalysis(): UploadOrderingAnalysis['gapAnalysis'] {
        return {
            missingDependencies: [
                '❌ Model dependency ordering - Currently uploads all models together',
                '❌ Hierarchical page ordering - Currently uploads pages in file order',
                '❌ Template-before-container ordering - Templates uploaded after containers',
                '❌ Circular dependency resolution - No handling of model-to-model chains',
                '❌ Asset dependency resolution - Assets uploaded without dependency context'
            ],
            improperOrderings: [
                '⚠️ Templates (6th) should be before Containers (4th) - Pages need templates',
                '⚠️ All models uploaded together - Should be dependency-ordered',
                '⚠️ Pages uploaded flat - Should respect parent-child hierarchy',
                '⚠️ Content uploaded without container validation - Should verify containers exist'
            ],
            optimizations: [
                '🚀 Batch entities by dependency level - Process all Level 0 dependencies first',
                '🚀 Parallel processing within levels - Upload independent entities simultaneously',
                '🚀 Skip already-existing entities - Check target instance before upload',
                '🚀 2-pass approach for all entities - Analysis pass, then upload pass',
                '🚀 Progress tracking by dependency chain - Show chain completion status'
            ]
        };
    }

    /**
     * FULL ANALYSIS REPORT
     */
    generateAnalysisReport(): UploadOrderingAnalysis {
        return {
            currentSequence: this.getCurrentUploadSequence(),
            chainAnalysisResults: this.getChainAnalysisPatterns(),
            recommendedSequence: this.getRecommendedUploadSequence(),
            gapAnalysis: this.getGapAnalysis()
        };
    }

    /**
     * PRIORITY IMPLEMENTATION RECOMMENDATIONS
     */
    getPriorityRecommendations(): string[] {
        return [
            '🎯 HIGH PRIORITY: Implement model dependency ordering (prevents circular dependency failures)',
            '🎯 HIGH PRIORITY: Move templates before containers (prevents template reference failures)',
            '🎯 MEDIUM PRIORITY: Implement hierarchical page upload (prevents parent reference failures)', 
            '🎯 MEDIUM PRIORITY: Add 2-pass analysis for all entity types (improves reliability)',
            '🎯 LOW PRIORITY: Optimize with parallel processing within dependency levels (improves speed)'
        ];
    }

    /**
     * INTEGRATION WITH CHAINBUILDER
     */
    getChainBuilderIntegrationPlan(): string[] {
        return [
            '🔗 Use ChainBuilder.performChainAnalysis() results to drive upload ordering',
            '🔗 Extract modelChains, pageChains, containerChains from analysis results',
            '🔗 Convert chain hierarchy to upload batches (Level 0, Level 1, Level 2, etc.)',
            '🔗 Replace flat entity arrays with dependency-ordered sequences',
            '🔗 Maintain existing pusher/* services but call them in dependency order',
            '🔗 Integrate with existing BlessedUI progress tracking',
            '🔗 Preserve existing reference mapping and error handling patterns'
        ];
    }
} 