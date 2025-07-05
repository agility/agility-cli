import * as mgmtApi from '@agility/management-sdk';

/**
 * Content classification result
 */
export interface ContentClassification {
    normalContentItems: mgmtApi.ContentItem[];
    linkedContentItems: mgmtApi.ContentItem[];
    classificationDetails: {
        totalItems: number;
        normalCount: number;
        linkedCount: number;
        analysisTime: number;
    };
}

/**
 * Model field analysis cache
 */
interface ModelFieldAnalysis {
    hasLinkedContentFields: boolean;
    linkedContentFieldNames: string[];
    fieldTypeMap: Map<string, string>; // fieldName -> fieldType
    cachedAt: number;
}

/**
 * Content Classifier - separates content into normal vs linked based on legacy pattern
 * 
 * Based on push_legacy.ts logic:
 * - Normal content: No Content fields with linked content references
 * - Linked content: Has Content fields with LinkeContentDropdownValueField, SortIDFieldName, contentid, etc.
 */
export class ContentClassifier {
    private modelAnalysisCache = new Map<string, ModelFieldAnalysis>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Classify content items into normal vs linked categories
     */
    async classifyContent(
        contentItems: mgmtApi.ContentItem[],
        models: mgmtApi.Model[]
    ): Promise<ContentClassification> {
        const startTime = Date.now();
        
        const normalContentItems: mgmtApi.ContentItem[] = [];
        const linkedContentItems: mgmtApi.ContentItem[] = [];

        // Build model lookup for efficient analysis
        const modelLookup = new Map<string, mgmtApi.Model>();
        models.forEach(model => {
            modelLookup.set(model.referenceName, model);
        });

        // Classify each content item
        for (const contentItem of contentItems) {
            const definitionName = contentItem.properties?.definitionName;
            if (!definitionName) {
                // No model definition - treat as normal content
                normalContentItems.push(contentItem);
                continue;
            }

            const model = modelLookup.get(definitionName);
            if (!model) {
                // Model not found - treat as normal content
                normalContentItems.push(contentItem);
                continue;
            }

            // Analyze content item against model
            const hasLinkedContentReferences = this.hasLinkedContentReferences(contentItem, model);
            
            if (hasLinkedContentReferences) {
                linkedContentItems.push(contentItem);
            } else {
                normalContentItems.push(contentItem);
            }
        }

        const analysisTime = Date.now() - startTime;

        return {
            normalContentItems,
            linkedContentItems,
            classificationDetails: {
                totalItems: contentItems.length,
                normalCount: normalContentItems.length,
                linkedCount: linkedContentItems.length,
                analysisTime
            }
        };
    }

    /**
     * Check if content item has linked content references based on model fields
     */
    private hasLinkedContentReferences(contentItem: mgmtApi.ContentItem, model: mgmtApi.Model): boolean {
        // Get cached model analysis or create new one
        const modelAnalysis = this.getModelAnalysis(model);
        
        // If model has no Content fields, it can't have linked content
        if (!modelAnalysis.hasLinkedContentFields) {
            return false;
        }

        // Check content item fields for actual linked content references
        return this.checkContentFieldsForLinkedReferences(contentItem, modelAnalysis);
    }

    /**
     * Get or create model field analysis with caching
     */
    private getModelAnalysis(model: mgmtApi.Model): ModelFieldAnalysis {
        const cacheKey = model.referenceName;
        const cached = this.modelAnalysisCache.get(cacheKey);
        
        // Check cache validity
        if (cached && (Date.now() - cached.cachedAt) < this.CACHE_TTL) {
            return cached;
        }

        // Analyze model fields
        const analysis = this.analyzeModelFields(model);
        this.modelAnalysisCache.set(cacheKey, analysis);
        
        return analysis;
    }

    /**
     * Analyze model fields to identify Content fields and their settings
     */
    private analyzeModelFields(model: mgmtApi.Model): ModelFieldAnalysis {
        const linkedContentFieldNames: string[] = [];
        const fieldTypeMap = new Map<string, string>();
        let hasLinkedContentFields = false;

        if (!model.fields) {
            return {
                hasLinkedContentFields: false,
                linkedContentFieldNames: [],
                fieldTypeMap,
                cachedAt: Date.now()
            };
        }

        model.fields.forEach(field => {
            const fieldName = this.camelize(field.name);
            fieldTypeMap.set(fieldName, field.type);

            // Check for Content fields (from legacy push_legacy.ts logic)
            if (field.type === 'Content') {
                hasLinkedContentFields = true;
                linkedContentFieldNames.push(fieldName);
            }
        });

        return {
            hasLinkedContentFields,
            linkedContentFieldNames,
            fieldTypeMap,
            cachedAt: Date.now()
        };
    }

    /**
     * Check content item fields for actual linked content references
     */
    private checkContentFieldsForLinkedReferences(
        contentItem: mgmtApi.ContentItem, 
        modelAnalysis: ModelFieldAnalysis
    ): boolean {
        if (!contentItem.fields) {
            return false;
        }

        // Check each Content field for linked content patterns
        for (const fieldName of modelAnalysis.linkedContentFieldNames) {
            const fieldValue = contentItem.fields[fieldName];
            
            if (!fieldValue) {
                continue;
            }

            // Check for linked content patterns (from push_legacy.ts)
            if (this.hasLinkedContentPatterns(fieldValue)) {
                return true;
            }
        }

        // Also check for direct contentid/contentID references in any object field
        return this.hasDirectContentReferences(contentItem.fields);
    }

    /**
     * Check field value for linked content patterns from legacy logic
     */
    private hasLinkedContentPatterns(fieldValue: any): boolean {
        if (typeof fieldValue !== 'object' || fieldValue === null) {
            return false;
        }

        // Pattern 1: contentid or contentID reference (legacy: fieldVal.contentid)
        if ('contentid' in fieldValue || 'contentID' in fieldValue) {
            return true;
        }

        // Pattern 2: sortids array (legacy: fieldVal.sortids)
        if ('sortids' in fieldValue) {
            return true;
        }

        // Pattern 3: referencename with content references (legacy: fieldVal.referencename)
        if ('referencename' in fieldValue) {
            return true;
        }

        return false;
    }

    /**
     * Check for direct content ID references in any field
     */
    private hasDirectContentReferences(fields: any): boolean {
        // Recursively scan for contentid/contentID patterns
        return this.scanObjectForContentReferences(fields);
    }

    /**
     * Recursively scan object for content reference patterns
     */
    private scanObjectForContentReferences(obj: any): boolean {
        if (typeof obj !== 'object' || obj === null) {
            return false;
        }

        if (Array.isArray(obj)) {
            return obj.some(item => this.scanObjectForContentReferences(item));
        }

        for (const [key, value] of Object.entries(obj)) {
            // Direct content reference patterns
            if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                return true;
            }

            // Recursive scan for nested objects
            if (this.scanObjectForContentReferences(value)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Convert field name to camelCase (from legacy logic)
     */
    private camelize(str: string): string {
        return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
            return index === 0 ? word.toLowerCase() : word.toUpperCase();
        }).replace(/\s+/g, '');
    }

    /**
     * Clear model analysis cache
     */
    clearCache(): void {
        this.modelAnalysisCache.clear();
    }

    /**
     * Get classification statistics
     */
    getClassificationStats(classification: ContentClassification): string {
        const { classificationDetails } = classification;
        const normalPercent = Math.round((classificationDetails.normalCount / classificationDetails.totalItems) * 100);
        const linkedPercent = Math.round((classificationDetails.linkedCount / classificationDetails.totalItems) * 100);
        
        return `Content Classification: ${classificationDetails.normalCount} normal (${normalPercent}%) + ${classificationDetails.linkedCount} linked (${linkedPercent}%) = ${classificationDetails.totalItems} total (${classificationDetails.analysisTime}ms)`;
    }
} 