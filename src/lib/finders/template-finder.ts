import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced template finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findTemplateInTargetInstanceEnhanced(
    sourceTemplate: mgmtApi.PageModel,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ template: mgmtApi.PageModel | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision }> {
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

    // STEP 3: Use FinderDecisionEngine for proper conflict resolution
    const decision = FinderDecisionEngine.makeDecision(
        'template',
        sourceTemplate.pageTemplateID,
        sourceTemplate.pageTemplateName || `Template-${sourceTemplate.pageTemplateID}`,
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