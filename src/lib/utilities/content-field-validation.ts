/**
 * Content Field Validation Service
 * 
 * Validates and sanitizes content fields before mapping to ensure:
 * - Proper reference types and structures
 * - Asset URL validity 
 * - Content ID reference validation
 * - Field type compliance with Agility CMS expectations
 */

import { ReferenceMapper } from "../utilities/reference-mapper";
import { LinkTypeDetector } from './link-type-detector';

export interface FieldValidationResult {
    isValid: boolean;
    field: any;
    warnings: string[];
    errors: string[];
    sanitizedField?: any;
}

export interface ContentValidationOptions {
    referenceMapper?: ReferenceMapper;
    sourceAssets?: any[];
    sourceContainers?: any[];
    modelDefinitions?: any[];
    strictMode?: boolean; // If true, invalid references cause errors; if false, warnings
}

export class ContentFieldValidator {
    private linkTypeDetector: LinkTypeDetector;

    constructor() {
        this.linkTypeDetector = new LinkTypeDetector();
    }

    /**
     * Validate all fields in a content item
     */
    public validateContentFields(fields: any, options: ContentValidationOptions = {}): {
        isValid: boolean;
        validatedFields: any;
        totalWarnings: number;
        totalErrors: number;
        fieldResults: Map<string, FieldValidationResult>;
    } {
        if (!fields || typeof fields !== 'object') {
            return {
                isValid: true,
                validatedFields: fields,
                totalWarnings: 0,
                totalErrors: 0,
                fieldResults: new Map()
            };
        }

        const fieldResults = new Map<string, FieldValidationResult>();
        const validatedFields: any = {};
        let totalWarnings = 0;
        let totalErrors = 0;
        let overallValid = true;

        for (const [fieldKey, fieldValue] of Object.entries(fields)) {
            const result = this.validateSingleField(fieldKey, fieldValue, options);
            fieldResults.set(fieldKey, result);
            
            validatedFields[fieldKey] = result.sanitizedField ?? result.field;
            totalWarnings += result.warnings.length;
            totalErrors += result.errors.length;
            
            if (!result.isValid) {
                overallValid = false;
            }
        }

        return {
            isValid: overallValid,
            validatedFields,
            totalWarnings,
            totalErrors,
            fieldResults
        };
    }

    /**
     * Validate a single field with type-specific rules
     */
    private validateSingleField(fieldKey: string, fieldValue: any, options: ContentValidationOptions): FieldValidationResult {
        const result: FieldValidationResult = {
            isValid: true,
            field: fieldValue,
            warnings: [],
            errors: []
        };

        // Handle null/undefined - always valid
        if (fieldValue === null || fieldValue === undefined) {
            return result;
        }

        // Validate object fields (content references, nested structures)
        if (typeof fieldValue === 'object' && fieldValue !== null) {
            return this.validateObjectField(fieldKey, fieldValue, options);
        }

        // Validate string fields (asset URLs, text content)
        if (typeof fieldValue === 'string') {
            return this.validateStringField(fieldKey, fieldValue, options);
        }

        // Validate numeric fields
        if (typeof fieldValue === 'number') {
            return this.validateNumericField(fieldKey, fieldValue, options);
        }

        // Primitive fields (boolean, etc.) are always valid
        return result;
    }

    /**
     * Validate object fields with content references
     */
    private validateObjectField(fieldKey: string, fieldValue: any, options: ContentValidationOptions): FieldValidationResult {
        const result: FieldValidationResult = {
            isValid: true,
            field: fieldValue,
            warnings: [],
            errors: []
        };

        // Validate contentid/contentID references
        if ('contentid' in fieldValue || 'contentID' in fieldValue) {
            const contentId = fieldValue.contentid || fieldValue.contentID;
            
            if (typeof contentId !== 'number' || contentId <= 0) {
                result.errors.push(`Invalid content ID: ${contentId} in field ${fieldKey}`);
                result.isValid = false;
            } else if (options.referenceMapper) {
                // Check if content ID exists in reference mapper
                const mappedContent = options.referenceMapper.getTarget('content', contentId);
                if (!mappedContent && options.strictMode) {
                    result.errors.push(`Content ID ${contentId} not found in reference mapper for field ${fieldKey}`);
                    result.isValid = false;
                } else if (!mappedContent) {
                    result.warnings.push(`Content ID ${contentId} not yet mapped for field ${fieldKey}`);
                }
            }
        }

        // Validate LinkedContentDropdown pattern
        if (fieldValue.referencename && fieldValue.sortids) {
            const sortIds = fieldValue.sortids.toString();
            
            // Validate sortids format (comma-separated numbers)
            const ids = sortIds.split(',').map(id => id.trim());
            const invalidIds = ids.filter(id => isNaN(parseInt(id)) || parseInt(id) <= 0);
            
            if (invalidIds.length > 0) {
                result.errors.push(`Invalid sort IDs in field ${fieldKey}: ${invalidIds.join(', ')}`);
                result.isValid = false;
            }

            // Validate reference name if containers are available
            if (options.sourceContainers) {
                const containerExists = options.sourceContainers.some(c => 
                    c.referenceName === fieldValue.referencename
                );
                if (!containerExists) {
                    result.warnings.push(`Container reference ${fieldValue.referencename} not found in field ${fieldKey}`);
                }
            }
        }

        // Validate gallery references
        if (fieldValue.mediaGroupingID) {
            const galleryId = fieldValue.mediaGroupingID;
            if (typeof galleryId !== 'number' || galleryId <= 0) {
                result.errors.push(`Invalid gallery ID: ${galleryId} in field ${fieldKey}`);
                result.isValid = false;
            }
        }

        // Recursive validation for nested objects/arrays
        if (Array.isArray(fieldValue)) {
            fieldValue.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                    const nestedResult = this.validateObjectField(`${fieldKey}[${index}]`, item, options);
                    result.warnings.push(...nestedResult.warnings);
                    result.errors.push(...nestedResult.errors);
                    if (!nestedResult.isValid) {
                        result.isValid = false;
                    }
                }
            });
        }

        return result;
    }

    /**
     * Validate string fields 
     */
    private validateStringField(fieldKey: string, fieldValue: string, options: ContentValidationOptions): FieldValidationResult {
        const result: FieldValidationResult = {
            isValid: true,
            field: fieldValue,
            warnings: [],
            errors: []
        };

        // Validate asset URLs
        if (fieldValue.includes('cdn.aglty.io')) {
            if (!this.isValidAssetUrl(fieldValue)) {
                result.errors.push(`Invalid asset URL format in field ${fieldKey}: ${fieldValue}`);
                result.isValid = false;
            } else if (options.sourceAssets) {
                // Check if asset exists in source data
                const assetExists = options.sourceAssets.some(asset => 
                    asset.originUrl === fieldValue || 
                    asset.url === fieldValue || 
                    asset.edgeUrl === fieldValue
                );
                if (!assetExists) {
                    result.warnings.push(`Asset URL not found in source data for field ${fieldKey}: ${fieldValue}`);
                }
            }
        }

        // Validate content ID strings (CategoryID, ValueField patterns)
        if (this.isContentIdField(fieldKey, fieldValue)) {
            const contentIds = fieldValue.includes(',') ? 
                fieldValue.split(',').map(id => id.trim()) : 
                [fieldValue.trim()];

            const invalidIds = contentIds.filter(id => isNaN(parseInt(id)) || parseInt(id) <= 0);
            if (invalidIds.length > 0) {
                result.errors.push(`Invalid content IDs in field ${fieldKey}: ${invalidIds.join(', ')}`);
                result.isValid = false;
            }
        }

        // Validate against maximum field length
        if (fieldValue.length > 10000) { // Agility CMS typical max field length
            result.warnings.push(`Field ${fieldKey} exceeds recommended length (${fieldValue.length} chars)`);
        }

        return result;
    }

    /**
     * Validate numeric fields
     */
    private validateNumericField(fieldKey: string, fieldValue: number, options: ContentValidationOptions): FieldValidationResult {
        const result: FieldValidationResult = {
            isValid: true,
            field: fieldValue,
            warnings: [],
            errors: []
        };

        // Validate range for ID fields
        if (fieldKey.toLowerCase().includes('id') || fieldKey.toLowerCase().includes('contentid')) {
            if (fieldValue <= 0) {
                result.errors.push(`Invalid ID value in field ${fieldKey}: ${fieldValue}`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Check if string field contains content ID references
     */
    private isContentIdField(fieldKey: string, fieldValue: string): boolean {
        const lowercaseKey = fieldKey.toLowerCase();
        return (lowercaseKey.includes('categoryid') || 
                lowercaseKey.includes('valuefield') ||
                lowercaseKey.includes('tags') ||
                lowercaseKey.includes('links')) &&
               /^\d+(,\d+)*$/.test(fieldValue.trim());
    }

    /**
     * Validate asset URL format
     */
    private isValidAssetUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.includes('cdn.aglty.io') && urlObj.pathname.length > 1;
        } catch {
            return false;
        }
    }

    /**
     * Sanitize field value to ensure compatibility
     */
    public sanitizeField(fieldKey: string, fieldValue: any): any {
        if (fieldValue === null || fieldValue === undefined) {
            return fieldValue;
        }

        // Sanitize string fields
        if (typeof fieldValue === 'string') {
            // Trim whitespace
            let sanitized = fieldValue.trim();
            
            // Remove null characters
            sanitized = sanitized.replace(/\0/g, '');
            
            // Ensure proper encoding for special characters
            try {
                sanitized = decodeURIComponent(encodeURIComponent(sanitized));
            } catch {
                // If encoding fails, return original
                return fieldValue;
            }
            
            return sanitized;
        }

        // Sanitize numeric fields
        if (typeof fieldValue === 'number') {
            // Ensure finite numbers
            if (!Number.isFinite(fieldValue)) {
                return 0;
            }
            return fieldValue;
        }

        // Sanitize object fields recursively
        if (typeof fieldValue === 'object' && fieldValue !== null) {
            if (Array.isArray(fieldValue)) {
                return fieldValue.map((item, index) => this.sanitizeField(`${fieldKey}[${index}]`, item));
            } else {
                const sanitized: any = {};
                for (const [key, value] of Object.entries(fieldValue)) {
                    sanitized[key] = this.sanitizeField(`${fieldKey}.${key}`, value);
                }
                return sanitized;
            }
        }

        return fieldValue;
    }

    /**
     * Get validation summary for reporting
     */
    public getValidationSummary(fieldResults: Map<string, FieldValidationResult>): {
        totalFields: number;
        validFields: number;
        fieldsWithWarnings: number;
        fieldsWithErrors: number;
        criticalFields: string[];
    } {
        const summary = {
            totalFields: fieldResults.size,
            validFields: 0,
            fieldsWithWarnings: 0,
            fieldsWithErrors: 0,
            criticalFields: [] as string[]
        };

        fieldResults.forEach((result, fieldKey) => {
            if (result.isValid) {
                summary.validFields++;
            }
            if (result.warnings.length > 0) {
                summary.fieldsWithWarnings++;
            }
            if (result.errors.length > 0) {
                summary.fieldsWithErrors++;
                summary.criticalFields.push(fieldKey);
            }
        });

        return summary;
    }
}

/**
 * Factory function for easy usage
 */
export function createContentFieldValidator(): ContentFieldValidator {
    return new ContentFieldValidator();
}

/**
 * Quick validation function for single fields
 */
export function validateField(fieldKey: string, fieldValue: any, options: ContentValidationOptions = {}): FieldValidationResult {
    const validator = new ContentFieldValidator();
    return validator['validateSingleField'](fieldKey, fieldValue, options);
} 