import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import { getState } from "../../core/state";

export async function findTemplateInTargetInstanceEnhanced(
    sourceTemplate: mgmtApi.PageModel,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ template: mgmtApi.PageModel | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean }> {
    const state = getState();
    const overwrite = state.overwrite;
    let existsInTarget = false;

    // STEP 1: Check for existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageModel>("template", "pageTemplateName", sourceTemplate.pageTemplateName);
    let targetTemplateFromMapping: mgmtApi.PageModel | null = existingMapping?.target || null;

    // STEP 2: Find in targetData.templates
    const targetInstanceData = targetData.templates?.find((t: any) => {
        if (targetTemplateFromMapping) {
            return t.pageTemplateName === targetTemplateFromMapping.pageTemplateName ||
                   t.pageTemplateID === targetTemplateFromMapping.pageTemplateID;
        } else {
            return t.pageTemplateName === sourceTemplate.pageTemplateName;
        }
    });

    if (targetInstanceData) {
        existsInTarget = true;
    }

    // STEP 3: Decision logic
    let shouldUpdate = false;
    let shouldCreate = false;
    let shouldSkip = false;
    let finalTargetTemplate: mgmtApi.PageModel | null = null;

    if (targetInstanceData) {
        finalTargetTemplate = targetInstanceData;
        shouldCreate = false;

        if (targetTemplateFromMapping) {
            shouldUpdate = overwrite;
            shouldSkip = !overwrite;
        } else {
            shouldUpdate = false;
            shouldSkip = true;
        }

    } else {
        shouldCreate = true;
        shouldUpdate = false;
        shouldSkip = false;
        finalTargetTemplate = null;
    }

    // Handle overwrite
    if (overwrite) {
        if (existsInTarget) {
            shouldUpdate = true;
            shouldCreate = false;
            shouldSkip = false;
        } else {
            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
        }
    }

    return {
        template: finalTargetTemplate,
        shouldUpdate,
        shouldCreate,
        shouldSkip,
    };
} 