/**
 * Two-Pass Analysis Service
 * 
 * Sub-task 21.9.3.1: Analyze current 2-pass model implementation
 * 
 * This service analyzes the proven 2-pass pattern from model-pusher.ts
 * and designs universal 2-pass patterns for all entity types.
 */

import ansiColors from 'ansi-colors';

export interface TwoPassPattern {
    entityType: string;
    pass1Description: string;  // What Pass 1 accomplishes
    pass2Description: string;  // What Pass 2 accomplishes
    circularHandling: boolean; // Whether this entity type can have circular dependencies
    dependencies: string[];    // What other entity types this depends on
    apiMethods: {
        fetch: string;         // Method to fetch existing entity
        create: string;        // Method to create new entity
        update: string;        // Method to update existing entity
    };
    payloadPreparation: {
        stubFields: string[];  // Fields needed for Pass 1 stub creation
        fullFields: string[];  // Fields needed for Pass 2 full creation
    };
}

export class TwoPassAnalysisService {

    /**
     * Analyze the current 2-pass model implementation
     */
    analyzeCurrentModelPattern(): TwoPassPattern {
        return {
            entityType: 'Model',
            pass1Description: 'Create model stubs with empty fields for circular dependencies',
            pass2Description: 'Update models with full field definitions after all stubs exist',
            circularHandling: true,
            dependencies: [], // Models are foundational - no dependencies
            apiMethods: {
                fetch: 'apiClient.modelMethods.getModelByReferenceName',
                create: 'apiClient.modelMethods.saveModel (with id: 0)',
                update: 'apiClient.modelMethods.saveModel (with existing id)'
            },
            payloadPreparation: {
                stubFields: ['referenceName', 'displayName', 'description'],
                fullFields: ['fields', 'lastModifiedDate', 'lastModifiedBy']
            }
        };
    }

    /**
     * Design 2-pass pattern for Templates
     */
    designTemplatePattern(): TwoPassPattern {
        return {
            entityType: 'Template',
            pass1Description: 'Create template shells with basic metadata (name, description)',
            pass2Description: 'Update templates with full definitions and zones after models exist',
            circularHandling: false, // Templates rarely have circular dependencies
            dependencies: ['Model'], // Templates may reference models in zones
            apiMethods: {
                fetch: 'apiClient.templateMethods.getTemplate',
                create: 'apiClient.templateMethods.saveTemplate',
                update: 'apiClient.templateMethods.saveTemplate'
            },
            payloadPreparation: {
                stubFields: ['pageTemplateName', 'description'],
                fullFields: ['zones', 'customWidgets', 'previewUrl']
            }
        };
    }

    /**
     * Design 2-pass pattern for Containers  
     */
    designContainerPattern(): TwoPassPattern {
        return {
            entityType: 'Container',
            pass1Description: 'Create container shells with basic metadata and model reference',
            pass2Description: 'Update containers with full definitions after all models exist',
            circularHandling: false, // Containers don\'t typically have circular dependencies
            dependencies: ['Model'], // Containers depend on models for content definitions
            apiMethods: {
                fetch: 'apiClient.containerMethods.getContainer',
                create: 'apiClient.containerMethods.saveContainer',
                update: 'apiClient.containerMethods.saveContainer'
            },
            payloadPreparation: {
                stubFields: ['referenceName', 'contentDefinitionID'],
                fullFields: ['settings', 'isShared', 'widgetTypeID']
            }
        };
    }

    /**
     * Design 2-pass pattern for Assets
     */
    designAssetPattern(): TwoPassPattern {
        return {
            entityType: 'Asset',
            pass1Description: 'Upload asset files and create asset records with metadata',
            pass2Description: 'Update asset metadata and gallery associations after galleries exist',
            circularHandling: false, // Assets don\'t have circular dependencies
            dependencies: ['Gallery'], // Assets may reference galleries
            apiMethods: {
                fetch: 'apiClient.assetMethods.getAsset',
                create: 'apiClient.assetMethods.uploadAsset',
                update: 'apiClient.assetMethods.updateAsset'
            },
            payloadPreparation: {
                stubFields: ['fileName', 'fileContent', 'contentType'],
                fullFields: ['description', 'tags', 'galleryID']
            }
        };
    }

    /**
     * Design 2-pass pattern for Galleries
     */
    designGalleryPattern(): TwoPassPattern {
        return {
            entityType: 'Gallery',
            pass1Description: 'Create gallery shells with basic metadata',
            pass2Description: 'Update galleries with asset associations after assets exist',
            circularHandling: false, // Galleries don\'t have circular dependencies
            dependencies: [], // Galleries are foundational like models
            apiMethods: {
                fetch: 'apiClient.galleryMethods.getGallery',
                create: 'apiClient.galleryMethods.saveGallery',
                update: 'apiClient.galleryMethods.saveGallery'
            },
            payloadPreparation: {
                stubFields: ['name', 'description'],
                fullFields: ['assetMediaGroupings', 'settings']
            }
        };
    }

    /**
     * Design 2-pass pattern for Content
     */
    designContentPattern(): TwoPassPattern {
        return {
            entityType: 'Content',
            pass1Description: 'Create content items with basic metadata and container reference',
            pass2Description: 'Update content with full field values after assets and models exist',
            circularHandling: true, // Content can have circular references through Content Definition fields
            dependencies: ['Model', 'Container', 'Asset', 'Gallery'], // Content depends on almost everything
            apiMethods: {
                fetch: 'apiClient.contentMethods.getContentItem',
                create: 'apiClient.contentMethods.saveContentItem',
                update: 'apiClient.contentMethods.saveContentItem'
            },
            payloadPreparation: {
                stubFields: ['referenceName', 'contentDefinitionID'],
                fullFields: ['properties.customFields', 'properties.seo', 'state']
            }
        };
    }

    /**
     * Design 2-pass pattern for Pages
     */
    designPagePattern(): TwoPassPattern {
        return {
            entityType: 'Page',
            pass1Description: 'Create page hierarchy with basic metadata and template reference',
            pass2Description: 'Update pages with content zones and modules after content exists',
            circularHandling: false, // Pages form hierarchies, not circles
            dependencies: ['Template', 'Content'], // Pages depend on templates and content
            apiMethods: {
                fetch: 'apiClient.pageMethods.getPage',
                create: 'apiClient.pageMethods.savePage',
                update: 'apiClient.pageMethods.savePage'
            },
            payloadPreparation: {
                stubFields: ['name', 'templateName', 'parentID'],
                fullFields: ['zones', 'seo', 'scripts', 'contentZones']
            }
        };
    }

    /**
     * Get all 2-pass patterns for universal implementation
     */
    getAllTwoPassPatterns(): TwoPassPattern[] {
        return [
            this.analyzeCurrentModelPattern(),
            this.designTemplatePattern(),
            this.designContainerPattern(),
            this.designAssetPattern(),
            this.designGalleryPattern(),
            this.designContentPattern(),
            this.designPagePattern()
        ];
    }

    /**
     * Generate optimal processing order based on dependencies
     */
    generateProcessingOrder(): { pass1Order: string[], pass2Order: string[] } {
        const patterns = this.getAllTwoPassPatterns();
        
        // Pass 1 Order: Process foundational entities first, then their dependents
        const pass1Order = [
            'Model',    // Foundational - no dependencies
            'Gallery',  // Foundational - no dependencies  
            'Template', // Depends on Model
            'Container',// Depends on Model
            'Asset',    // Depends on Gallery
            'Content',  // Depends on Model, Container, Asset, Gallery
            'Page'      // Depends on Template, Content
        ];

        // Pass 2 Order: Update in reverse dependency order to handle references
        const pass2Order = [
            'Model',    // Update circular model references first
            'Gallery',  // Update gallery-asset associations
            'Asset',    // Update asset-gallery associations
            'Template', // Update template zones with model references
            'Container',// Update container settings
            'Content',  // Update content with all asset/model references
            'Page'      // Update page zones with content references
        ];

        return { pass1Order, pass2Order };
    }

    /**
     * Key insights from model 2-pass implementation
     */
    getModelImplementationInsights(): string[] {
        return [
            '🔑 **Circular Dependency Detection**: Uses buildDependencyGraph() and detectCircularDependencies()',
            '🔑 **Stub Creation**: Circular models created with empty fields (overrideFields: [])',
            '🔑 **Stub Recognition**: Uses isStubCreationIntent flag to skip comparison on existing models',
            '🔑 **Reference Mapping**: Maps source entities to target entities for subsequent lookups',
            '🔑 **Error Handling**: Distinguishes between "not found" (404) vs actual errors',
            '🔑 **Progress Tracking**: Provides callbacks for UI progress indication',
            '🔑 **Diff Detection**: Uses areModelsDifferent() to avoid unnecessary updates',
            '🔑 **Payload Preparation**: Strips unnecessary fields (lastModifiedDate, etc.) for creation',
            '🔑 **Ordering Strategy**: Processes non-circular first, then circular stubs, then circular full'
        ];
    }

    /**
     * Generate detailed analysis report
     */
    generateAnalysisReport(): void {
        console.log(ansiColors.cyan('\n📋 TWO-PASS ANALYSIS REPORT'));
        console.log('='.repeat(50));

        console.log(ansiColors.blue('\n1. CURRENT MODEL IMPLEMENTATION ANALYSIS'));
        console.log('-'.repeat(40));
        const modelPattern = this.analyzeCurrentModelPattern();
        console.log(`Entity Type: ${modelPattern.entityType}`);
        console.log(`Pass 1: ${modelPattern.pass1Description}`);
        console.log(`Pass 2: ${modelPattern.pass2Description}`);
        console.log(`Circular Handling: ${modelPattern.circularHandling ? 'Yes' : 'No'}`);
        
        console.log(ansiColors.blue('\n2. KEY IMPLEMENTATION INSIGHTS'));
        console.log('-'.repeat(40));
        this.getModelImplementationInsights().forEach(insight => {
            console.log(`  ${insight}`);
        });

        console.log(ansiColors.blue('\n3. UNIVERSAL 2-PASS PATTERNS'));
        console.log('-'.repeat(40));
        const allPatterns = this.getAllTwoPassPatterns();
        allPatterns.forEach(pattern => {
            console.log(`\n${ansiColors.yellow(pattern.entityType)}:`);
            console.log(`  Dependencies: ${pattern.dependencies.join(', ') || 'None'}`);
            console.log(`  Pass 1: ${pattern.pass1Description}`);
            console.log(`  Pass 2: ${pattern.pass2Description}`);
            console.log(`  Circular: ${pattern.circularHandling ? 'Yes' : 'No'}`);
        });

        console.log(ansiColors.blue('\n4. OPTIMAL PROCESSING ORDER'));
        console.log('-'.repeat(40));
        const order = this.generateProcessingOrder();
        console.log(`Pass 1 Order: ${order.pass1Order.join(' → ')}`);
        console.log(`Pass 2 Order: ${order.pass2Order.join(' → ')}`);

        console.log(ansiColors.green('\n✅ Analysis Complete - Ready for Universal 2-Pass Implementation'));
    }

    /**
     * Validate 2-pass pattern design
     */
    validateTwoPassDesign(): { isValid: boolean, issues: string[] } {
        const patterns = this.getAllTwoPassPatterns();
        const issues: string[] = [];

        // Check for circular dependencies in pattern dependencies
        patterns.forEach(pattern => {
            pattern.dependencies.forEach(dep => {
                const depPattern = patterns.find(p => p.entityType === dep);
                if (depPattern && depPattern.dependencies.includes(pattern.entityType)) {
                    issues.push(`Circular dependency detected: ${pattern.entityType} ↔ ${dep}`);
                }
            });
        });

        // Validate that all dependencies have patterns
        patterns.forEach(pattern => {
            pattern.dependencies.forEach(dep => {
                const depPattern = patterns.find(p => p.entityType === dep);
                if (!depPattern) {
                    issues.push(`Missing pattern for dependency: ${dep} (required by ${pattern.entityType})`);
                }
            });
        });

        return {
            isValid: issues.length === 0,
            issues
        };
    }
} 