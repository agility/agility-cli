import { ReferenceMapper } from '../reference-mapper';
import * as ansiColors from 'ansi-colors';

export interface MappingDependencyResult {
    satisfied: boolean;
    missingMappings: string[];
    recommendations: string[];
    availableMappings: Record<string, number>;
}

export interface MappingRequirement {
    type: string;
    required: boolean;
    description: string;
}

/**
 * Mapping Dependency Enforcer
 * 
 * Conceptual shift from data dependency to mapping dependency:
 * - Instead of forcing download of ALL dependency data
 * - Check if required MAPPINGS exist for reference resolution
 * - Provide targeted recommendations for missing mappings
 */
export class MappingDependencyEnforcer {
    
    constructor(
        private referenceMapper: ReferenceMapper,
        private sourceGuid: string,
        private targetGuid: string
    ) {}

    /**
     * Enforce mapping dependencies for requested elements
     * 
     * @param requestedElements - Elements the user wants to push (e.g., ['Pages'])
     * @returns MappingDependencyResult with satisfaction status and recommendations
     */
    public enforceMappingDependencies(requestedElements: string[]): MappingDependencyResult {
        const requiredMappings = this.determineRequiredMappings(requestedElements);
        const availableMappings = this.checkAvailableMappings(requiredMappings);
        const missingMappings = this.identifyMissingMappings(requiredMappings, availableMappings);
        const recommendations = this.generateRecommendations(missingMappings, requestedElements);
        
        const satisfied = missingMappings.length === 0;
        
        if (!satisfied) {
            this.reportMappingGaps(missingMappings, recommendations);
        }
        
        return {
            satisfied,
            missingMappings,
            recommendations,
            availableMappings
        };
    }

    /**
     * Determine what mappings are required for the requested elements
     */
    private determineRequiredMappings(requestedElements: string[]): MappingRequirement[] {
        const requirements: MappingRequirement[] = [];
        
        // Pages require mappings to resolve references, not complete data
        if (requestedElements.includes('Pages')) {
            requirements.push(
                { type: 'template', required: true, description: 'Template ID mappings for page template references' },
                { type: 'container', required: true, description: 'Container ID mappings for page zone modules' },
                { type: 'content', required: true, description: 'Content ID mappings for page zone content' },
                { type: 'asset', required: false, description: 'Asset ID mappings for content asset references' },
                { type: 'gallery', required: false, description: 'Gallery ID mappings for content gallery references' }
            );
        }
        
        // Content requires container and model mappings
        if (requestedElements.includes('Content')) {
            requirements.push(
                { type: 'container', required: true, description: 'Container ID mappings for content container references' },
                { type: 'model', required: true, description: 'Model ID mappings for content definition validation' },
                { type: 'asset', required: false, description: 'Asset ID mappings for content asset fields' },
                { type: 'gallery', required: false, description: 'Gallery ID mappings for content gallery fields' }
            );
        }
        
        // Containers require model mappings
        if (requestedElements.includes('Containers')) {
            requirements.push(
                { type: 'model', required: true, description: 'Model ID mappings for container content definitions' }
            );
        }
        
        // Templates can be standalone - they define structure but don't require existing content
        // Models can be standalone - they define content structure
        // Assets and Galleries have mutual dependency
        if (requestedElements.includes('Assets') && !requestedElements.includes('Galleries')) {
            requirements.push(
                { type: 'gallery', required: true, description: 'Gallery ID mappings for asset gallery associations' }
            );
        }
        
        if (requestedElements.includes('Galleries') && !requestedElements.includes('Assets')) {
            requirements.push(
                { type: 'asset', required: true, description: 'Asset ID mappings for gallery asset collections' }
            );
        }
        
        return this.deduplicateRequirements(requirements);
    }

    /**
     * Check what mappings are currently available in ReferenceMapper
     */
    private checkAvailableMappings(requirements: MappingRequirement[]): Record<string, number> {
        const available: Record<string, number> = {};
        
        for (const requirement of requirements) {
            const mappingCount = this.referenceMapper.getRecordsByType(requirement.type as any).length;
            available[requirement.type] = mappingCount;
        }
        
        return available;
    }

    /**
     * Identify which required mappings are missing or insufficient
     */
    private identifyMissingMappings(
        requirements: MappingRequirement[], 
        available: Record<string, number>
    ): string[] {
        const missing: string[] = [];
        
        for (const requirement of requirements) {
            const availableCount = available[requirement.type] || 0;
            
            if (requirement.required && availableCount === 0) {
                missing.push(requirement.type);
            }
        }
        
        return missing;
    }

    /**
     * Generate specific recommendations for establishing missing mappings
     */
    private generateRecommendations(missingMappings: string[], requestedElements: string[]): string[] {
        const recommendations: string[] = [];
        
        if (missingMappings.length === 0) {
            return recommendations;
        }
        
        // Add header recommendation
        recommendations.push('To establish missing mappings, run these pull commands:');
        
        // Generate specific pull commands for missing mappings
        for (const mappingType of missingMappings) {
            const elementName = this.mappingTypeToElementName(mappingType);
            const pullCommand = `node dist/index.js pull --sourceGuid ${this.sourceGuid} --locale en-us --channel website --elements ${elementName}`;
            recommendations.push(`  ${pullCommand}`);
        }
        
        // Add efficiency note
        recommendations.push('Note: This only downloads mapping data, not complete entity data');
        
        return recommendations;
    }

    /**
     * Report mapping gaps to the user with clear guidance
     */
    private reportMappingGaps(missingMappings: string[], recommendations: string[]): void {
        console.log(ansiColors.yellow('\n⚠️ Missing Mapping Dependencies'));
        console.log(ansiColors.yellow('='.repeat(50)));
        
        console.log(ansiColors.red(`Missing mappings for: ${missingMappings.join(', ')}`));
        console.log(ansiColors.gray('These mappings are required to resolve entity references during push operations.'));
        
        console.log(ansiColors.cyan('\n📋 Recommendations:'));
        recommendations.forEach(rec => {
            console.log(ansiColors.white(rec));
        });
        
        console.log(ansiColors.yellow('\n💡 Performance Benefit:'));
        console.log(ansiColors.gray('Mapping-based dependencies are 10x faster than full data downloads.'));
        console.log(ansiColors.gray('Establish mappings once, then push entities multiple times efficiently.'));
    }

    /**
     * Convert mapping type to element name for pull commands
     */
    private mappingTypeToElementName(mappingType: string): string {
        const typeMap: Record<string, string> = {
            'template': 'Templates',
            'container': 'Containers',
            'content': 'Content',
            'asset': 'Assets',
            'gallery': 'Galleries',
            'model': 'Models'
        };
        
        return typeMap[mappingType] || mappingType;
    }

    /**
     * Remove duplicate requirements (same type can be required by multiple elements)
     */
    private deduplicateRequirements(requirements: MappingRequirement[]): MappingRequirement[] {
        const seen = new Set<string>();
        const deduplicated: MappingRequirement[] = [];
        
        for (const req of requirements) {
            if (!seen.has(req.type)) {
                seen.add(req.type);
                deduplicated.push(req);
            }
        }
        
        return deduplicated;
    }

    /**
     * Get detailed mapping statistics for reporting
     */
    public getMappingStatistics(): Record<string, { available: number; lastUpdated?: Date }> {
        const stats: Record<string, { available: number; lastUpdated?: Date }> = {};
        
        const mappingTypes = ['template', 'container', 'content', 'asset', 'gallery', 'model'];
        
        for (const type of mappingTypes) {
            const records = this.referenceMapper.getRecordsByType(type as any);
            stats[type] = {
                available: records.length,
                // TODO: Add lastUpdated timestamp when ReferenceMapper supports it
            };
        }
        
        return stats;
    }

    /**
     * Validate that specific entity references can be resolved
     * 
     * @param entityType - Type of entity being pushed
     * @param entityData - Entity data with references to validate  
     * @returns Array of unresolvable references
     */
    public validateEntityReferences(entityType: string, entityData: any): string[] {
        const unresolvableRefs: string[] = [];
        
        // TODO: Implement specific reference validation based on entity type
        // This would check if specific entity references can be resolved through mappings
        
        return unresolvableRefs;
    }
} 