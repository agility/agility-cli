import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { state, getState } from '../../core/state';
import { SyncDeltaFileWorker } from "lib/shared/sync-delta-file-worker";

/**
 * Simple change detection for templates
 */
interface ChangeDetection {
  entity: any;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  reason: string;
}

function changeDetection(
  sourceEntity: any,
  targetFromMapping: any,
  targetFromData: any
): ChangeDetection {
  if (!targetFromMapping && !targetFromData) {
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      reason: 'Template does not exist in target'
    };
  }
  
  const targetEntity = targetFromData || targetFromMapping;
  
  // For templates, simple existence check (templates rarely change)
  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: 'Template exists and is up to date'
  };
}

/**
 * Enhanced template finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findTemplateInTargetInstanceEnhanced(
    sourceTemplate: mgmtApi.PageModel,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapperV2
): Promise<{ template: mgmtApi.PageModel | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: ChangeDetection }> {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageModel>("template", "pageTemplateName", sourceTemplate.pageTemplateName);
    let targetTemplateFromMapping: mgmtApi.PageModel | null = existingMapping?.target || null;

    // STEP 2: Find target instance data
    const targetInstanceData = targetData.templates?.find((t: any) => {
        if (targetTemplateFromMapping) {
            return t.pageTemplateName === targetTemplateFromMapping.pageTemplateName ||
                   t.pageTemplateID === targetTemplateFromMapping.pageTemplateID;
        } else {
            return t.pageTemplateName === sourceTemplate.pageTemplateName;
        }
    });

    // STEP 3: Use change detection for conflict resolution
    const decision = changeDetection(
        sourceTemplate,
        targetTemplateFromMapping,
        targetInstanceData
    );

    return {
        template: decision.entity,
        shouldUpdate: decision.shouldUpdate,
        shouldCreate: decision.shouldCreate,
        shouldSkip: decision.shouldSkip,
        decision: decision
    };
}

export async function pushTemplates(
    sourceData: any,
    targetData: any,
    referenceMapper: ReferenceMapperV2,
    syncDeltaWorker: SyncDeltaFileWorker,
    // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {
    
    // Extract data from sourceData - unified parameter pattern
    const templates: mgmtApi.PageModel[] = sourceData.templates || [];
    
    // console.log(`[Template Debug] Starting template processing. Found ${templates ? templates.length : 0} templates to process.`);
    
    if (!templates || templates.length === 0) {
        console.log('No templates found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const { targetGuid, locale } = state;
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    // Log template names for debugging
    // console.log(`[Template Debug] Template names: ${templates.map(t => t.pageTemplateName).join(', ')}`);

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    const totalTemplates = templates.length;
    let overallStatus: 'success' | 'error' = 'success';

    for(let i = 0; i < templates.length; i++){
        let template = templates[i];
        let originalID = template.pageTemplateID;
        let currentStatus: 'success' | 'error' = 'success';
        let templateProcessed = false;
        let payload: mgmtApi.PageModel | null = null;

        const findResult = await findTemplateInTargetInstanceEnhanced(template, apiClient, targetGuid[0], targetData, referenceMapper);
        const { template: existingTemplate, shouldUpdate, shouldCreate, shouldSkip } = findResult;

        if (shouldSkip) {
            referenceMapper.addRecord('template', template, existingTemplate);
            console.log(`✓ Template ${ansiColors.underline.cyan(template.pageTemplateName)} ${ansiColors.bold.gray('up to date, skipping')}`);
            skipped++;
        } else {
            let isUpdate = shouldUpdate;
            let targetId = isUpdate ? existingTemplate.pageTemplateID : -1;

            // Prepare payload
            const mappedSections = template.contentSectionDefinitions.map(def => {
                const mappedDef = { ...def };
                mappedDef.pageItemTemplateID = isUpdate ? def.pageItemTemplateID : -1;
                mappedDef.pageTemplateID = targetId;
                mappedDef.contentViewID = isUpdate ? def.contentViewID : 0;

                if (def.contentDefinitionID) {
                    const modelMapping = referenceMapper.getMappingByKey<mgmtApi.Model>('model', 'id', def.contentDefinitionID);
                    if (modelMapping?.target?.id) mappedDef.contentDefinitionID = modelMapping.target.id;
                }
                if (def.itemContainerID) {
                    const containerMapping = referenceMapper.getMappingByKey<mgmtApi.Container>('container', 'contentViewID', def.itemContainerID);
                    if (containerMapping?.target?.contentViewID) mappedDef.itemContainerID = containerMapping.target.contentViewID;
                }
                if (def.publishContentItemID) {
                    const contentMapping = referenceMapper.getMappingByKey<mgmtApi.ContentItem>('content', 'contentID', def.publishContentItemID);
                    if (contentMapping?.target?.contentID) mappedDef.publishContentItemID = contentMapping.target.contentID;
                }
                return mappedDef;
            });

            const payload = {
                ...template,
                pageTemplateID: targetId,
                contentSectionDefinitions: mappedSections
            };

            try {
                const savedTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid[0], locale[0], payload);
                referenceMapper.addRecord('template', template, savedTemplate);
                const action = isUpdate ? 'updated' : 'created';
                console.log(`✓ Template ${ansiColors.underline.cyan(template.pageTemplateName)} ${ansiColors.green(action)} - Source: ${originalID} Target: ${savedTemplate.pageTemplateID}`);
                successful++;
            } catch (error: any) {
                console.error(`✗ Failed to ${isUpdate ? 'update' : 'create'} template ${template.pageTemplateName}: ${error.message}`);
                if (error.response) console.log(JSON.stringify(error.response.data, null, 2));
                failed++;
                currentStatus = 'error';
                overallStatus = 'error';
            }
        }
        
        // Progress update after each attempt
        processedCount++;
            // if(onProgress) {
            //     onProgress(processedCount, totalTemplates, overallStatus);
            // }
    }

   return { status: overallStatus, successful, failed, skipped }; // Return status object
}
