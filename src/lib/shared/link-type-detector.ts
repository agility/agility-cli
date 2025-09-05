/**
 * Link Type Detection Service
 *
 * Detects Agility CMS link types from model field configurations to enable
 * proper handling of different content linking patterns and eliminate false
 * broken chain reports from field configuration misinterpretation.
 */

export interface LinkTypeDetection {
  type: 'dropdown' | 'searchlistbox' | 'grid' | 'nested' | 'shared' | 'unknown';
  strategy: string;
  requiresMapping: boolean;
  followDependencies: boolean;
  isFieldConfiguration?: boolean; // Added to identify field setting strings
}

export interface ContentFieldAnalysis {
  fieldName: string;
  linkType: LinkTypeDetection;
  contentDefinition: string;
  actualContentReferences: string[]; // Real content references, not field settings
  fieldConfigurationStrings: string[]; // Field setting strings to ignore
}

export class LinkTypeDetector {
  /**
   * Detect link type from a Content field's settings
   */
  detectLinkType(field: any): LinkTypeDetection {
    if (field.type !== 'Content') {
      return {
        type: 'unknown',
        strategy: 'not-content-field',
        requiresMapping: false,
        followDependencies: false,
      };
    }

    const settings = field.settings;
    const renderAs = settings.RenderAs || '';
    const nestedTypeID = settings.LinkedContentNestedTypeID || '';
    const sharedContent = settings.SharedContent || '';
    const contentView = settings.ContentView || '';

    // 1. DROPDOWN LINKS (Shared Content)
    if (renderAs === 'dropdown' && sharedContent !== '_newcontent_agility_') {
      return {
        type: 'dropdown',
        strategy: "Use ID mapping only, don't follow dependencies",
        requiresMapping: true,
        followDependencies: false,
      };
    }

    // 2. SEARCHLISTBOX LINKS (Filtered Selection)
    if (renderAs === 'searchlistbox') {
      return {
        type: 'searchlistbox',
        strategy: 'Reference via contentID in separate field with remapping',
        requiresMapping: true,
        followDependencies: true,
      };
    }

    // 3. GRID LINKS (Multi-item Lists)
    if (renderAs === 'grid' && nestedTypeID === '1') {
      return {
        type: 'grid',
        strategy: 'Link to shared list with mapping + optional sorting',
        requiresMapping: true,
        followDependencies: true,
      };
    }

    // 4. NESTED LINKS (Single Item Containers)
    if (renderAs === '' && nestedTypeID === '0') {
      return {
        type: 'nested',
        strategy: 'Create container if missing, link locally',
        requiresMapping: true,
        followDependencies: true,
      };
    }

    // 5. SHARED CONTENT (Specific View Names)
    if (contentView !== '_newcontent_agility_' && sharedContent !== '_newcontent_agility_') {
      return {
        type: 'shared',
        strategy: 'Treat as shared, use content view metadata for context',
        requiresMapping: true,
        followDependencies: false,
      };
    }

    return {
      type: 'unknown',
      strategy: 'unhandled-pattern',
      requiresMapping: false,
      followDependencies: false,
    };
  }

  /**
   * Analyze all Content fields in a model and extract real references vs field settings
   */
  analyzeModelContentFields(model: any): ContentFieldAnalysis[] {
    if (!model.fields) return [];

    return model.fields
      .filter((field: any) => field.type === 'Content')
      .map((field: any) => {
        const linkType = this.detectLinkType(field);
        const settings = field.settings;

        // Identify field configuration strings (NOT content references)
        const fieldConfigurationStrings: string[] = [];
        if (settings.LinkeContentDropdownValueField) {
          fieldConfigurationStrings.push(settings.LinkeContentDropdownValueField);
        }
        if (settings.LinkeContentDropdownTextField) {
          fieldConfigurationStrings.push(settings.LinkeContentDropdownTextField);
        }

        // Extract actual content references (depend on link type)
        const actualContentReferences: string[] = [];
        if (settings.ContentDefinition) {
          actualContentReferences.push(settings.ContentDefinition);
        }

        return {
          fieldName: field.name,
          linkType,
          contentDefinition: settings.ContentDefinition || '',
          actualContentReferences,
          fieldConfigurationStrings,
        };
      });
  }

  /**
   * Check if a reference string is a field configuration (should be ignored)
   */
  isFieldConfigurationString(referenceString: string, model: any): boolean {
    const analysis = this.analyzeModelContentFields(model);

    return analysis.some((fieldAnalysis) =>
      fieldAnalysis.fieldConfigurationStrings.includes(referenceString)
    );
  }

  /**
   * Extract only real content references from a model (filter out field settings)
   */
  extractRealContentReferences(
    model: any
  ): Array<{ fieldName: string; contentDefinition: string; linkType: LinkTypeDetection }> {
    const analysis = this.analyzeModelContentFields(model);

    return analysis
      .filter((fieldAnalysis) => fieldAnalysis.actualContentReferences.length > 0)
      .map((fieldAnalysis) => ({
        fieldName: fieldAnalysis.fieldName,
        contentDefinition: fieldAnalysis.contentDefinition,
        linkType: fieldAnalysis.linkType,
      }));
  }

  /**
   * Get human-readable description of link type
   */
  getLinkTypeDescription(linkType: LinkTypeDetection): string {
    const typeDescriptions = {
      dropdown: '🔽 Dropdown (Shared Content)',
      searchlistbox: '🔍 SearchListBox (Filtered Selection)',
      grid: '📋 Grid (Multi-item List)',
      nested: '📦 Nested (Single Container)',
      shared: '🔗 Shared (Content View)',
      unknown: '❓ Unknown Pattern',
    };

    return typeDescriptions[linkType.type] || '❓ Unknown';
  }
}
