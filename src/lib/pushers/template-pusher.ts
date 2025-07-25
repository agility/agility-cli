import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { state, getState, getApiClient } from '../../core/state';
import { TemplateMapper } from "lib/mappers/template-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";


/**
 * Enhanced template finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */

export async function pushTemplates(
    sourceData: any,
    targetData: any,
    locale: string
    // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {

    // Extract data from sourceData - unified parameter pattern
    const templates: mgmtApi.PageModel[] = sourceData || [];

    // console.log(`[Template Debug] Starting template processing. Found ${templates ? templates.length : 0} templates to process.`);

    if (!templates || templates.length === 0) {
        console.log('No templates found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const apiClient = getApiClient();

    // Log template names for debugging
    // console.log(`[Template Debug] Template names: ${templates.map(t => t.pageTemplateName).join(', ')}`);

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    const totalTemplates = templates.length;
    let overallStatus: 'success' | 'error' = 'success';

    for (let i = 0; i < templates.length; i++) {
        let template = templates[i];
        let originalID = template.pageTemplateID;
        let currentStatus: 'success' | 'error' = 'success';
        let templateProcessed = false;
        let payload: mgmtApi.PageModel | null = null;


        const { sourceGuid, targetGuid } = state;
        const referenceMapper = new TemplateMapper(sourceGuid[0], targetGuid[0]);

        const existingMapping = referenceMapper.getTemplateMapping(template, "source");
        let targetTemplate = targetData.find(targetTemplate => targetTemplate.pageTemplateID === existingMapping?.targetPageTemplateID) || null;
        if (!targetTemplate) {
            // Try to get the template via the mapper
            targetTemplate = referenceMapper.getMappedEntity(existingMapping, "target");
        }


        const isTargetSafe = existingMapping !== null && referenceMapper.hasTargetChanged(targetTemplate);
        const hasSourceChanges = existingMapping !== null && referenceMapper.hasSourceChanged(template);
        const shouldUpdate = existingMapping !== null && isTargetSafe && hasSourceChanges;
        const shouldSkip = existingMapping !== null && !isTargetSafe && !hasSourceChanges;


        // const findResult = await findTemplateInTargetInstanceEnhanced(template, apiClient, targetGuid[0], targetData, referenceMapper);
        // const { template: existingTemplate, shouldUpdate, shouldCreate, shouldSkip } = findResult;

        if (shouldSkip) {
            if (targetTemplate) {
                referenceMapper.addMapping(template, targetTemplate);
            }
            console.log(`✓ Template ${ansiColors.underline.cyan(template.pageTemplateName)} ${ansiColors.bold.gray('up to date, skipping')}`);
            skipped++;
        } else {
            let isUpdate = shouldUpdate;
            let targetId = isUpdate ? targetTemplate.pageTemplateID : -1;

            // Prepare payload
            const mappedSections = template.contentSectionDefinitions.map(def => {
                const mappedDef = { ...def };
                mappedDef.pageItemTemplateID = isUpdate ? def.pageItemTemplateID : -1;
                mappedDef.pageTemplateID = targetId;
                mappedDef.contentViewID = isUpdate ? def.contentViewID : 0;

                if (def.contentDefinitionID) {
                    const modelMappers = new ModelMapper(sourceGuid[0], targetGuid[0]);
                    const modelMapping = modelMappers.getModelMappingByID(def.contentDefinitionID, 'target');
                    if (modelMapping?.targetID) mappedDef.contentDefinitionID = modelMapping.targetID;
                }
                if (def.itemContainerID) {
                    const containerMappers = new ContainerMapper(sourceGuid[0], targetGuid[0]);
                    const containerMapping = containerMappers.getContainerMappingByContentViewID(def.itemContainerID, 'target');
                    if (containerMapping?.targetContentViewID) mappedDef.itemContainerID = containerMapping.targetContentViewID;
                }
                // if (def.publishContentItemID) {
                //     const contentMappers = new ContentItemMapper(sourceGuid[0], targetGuid[0]);
                //     const contentMapping = contentMappers.getContentItemMappingByContentID(def.publishContentItemID, 'target');
                //     if (contentMapping?.targetID) mappedDef.publishContentItemID = contentMapping.targetID;
                // }
                return mappedDef;
            });

            const payload = {
                ...template,
                pageTemplateID: targetId,
                contentSectionDefinitions: mappedSections
            };

            try {
                const savedTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid[0], locale, payload);
                referenceMapper.addMapping(template, savedTemplate);
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
