import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { state, getState, getApiClient, getLoggerForGuid } from "../../core/state";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { FailureDetail, PusherResult } from "types/sourceData";

/**
 * Enhanced template finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */

export async function pushTemplates(
    sourceData: any,
    targetData: any,
    locale: string
    // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<PusherResult> {

    // Extract data from sourceData - unified parameter pattern
    const templates: mgmtApi.PageModel[] = sourceData || [];
    const { sourceGuid, targetGuid, cachedApiClient: apiClient, overwrite } = state;
    const logger = getLoggerForGuid(sourceGuid[0]);

    // console.log(`[Template Debug] Starting template processing. Found ${templates ? templates.length : 0} templates to process.`);

    if (!templates || templates.length === 0) {
        console.log('No templates found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    const totalTemplates = templates.length;
    let overallStatus: 'success' | 'error' = 'success';
    const failureDetails: FailureDetail[] = [];

    for (let i = 0; i < templates.length; i++) {
        let template = templates[i];
        let originalID = template.pageTemplateID;
        let currentStatus: 'success' | 'error' = 'success';
        let templateProcessed = false;
        let payload: mgmtApi.PageModel | null = null;


        const { sourceGuid, targetGuid } = state;
        const referenceMapper = new TemplateMapper(sourceGuid[0], targetGuid[0]);

        let existingMapping = referenceMapper.getTemplateMapping(template, "source");
        let targetTemplate = targetData.find(targetTemplate => targetTemplate.pageTemplateID === existingMapping?.targetPageTemplateID) || null;
        if (!targetTemplate) {
            // Try to get the template via the mapper
            targetTemplate = referenceMapper.getMappedEntity(existingMapping, "target");
        }

    const isTargetSafe = existingMapping !== null && referenceMapper.hasTargetChanged(targetTemplate);
    const hasSourceChanges = existingMapping !== null && referenceMapper.hasSourceChanged(template);
    let shouldUpdate = existingMapping !== null && isTargetSafe && hasSourceChanges;
    let shouldSkip = existingMapping !== null && !isTargetSafe && !hasSourceChanges;

    if (overwrite && existingMapping && targetTemplate) {
      shouldUpdate = true;
      shouldSkip = false;
    }

    if (shouldSkip) {
      if (targetTemplate) {
        referenceMapper.addMapping(template, targetTemplate);
      }
      logger.template.skipped(template, "up to date, skipping", targetGuid[0]);
      skipped++;
    } else {
      let targetId = shouldUpdate ? targetTemplate.pageTemplateID : -1;

      // Prepare payload
      const mappedSections = template.contentSectionDefinitions.map((def) => {
        const mappedDef = { ...def };
        mappedDef.pageItemTemplateID = shouldUpdate ? def.pageItemTemplateID : -1;
        mappedDef.pageTemplateID = targetId;
        mappedDef.contentViewID = shouldUpdate ? def.contentViewID : 0;

        if (def.contentDefinitionID) {
          const modelMappers = new ModelMapper(sourceGuid[0], targetGuid[0]);
          const modelMapping = modelMappers.getModelMappingByID(def.contentDefinitionID, "source");
          if (modelMapping?.targetID) mappedDef.contentDefinitionID = modelMapping.targetID;
        }

        if (shouldSkip) {
            if (targetTemplate) {
                referenceMapper.addMapping(template, targetTemplate);
            }
            logger.template.skipped(template, "up to date, skipping", targetGuid[0])
            skipped++;
        } else {
            let targetId = shouldUpdate ? targetTemplate.pageTemplateID : -1;

            // Prepare payload
            const mappedSections = template.contentSectionDefinitions.map(def => {
                const mappedDef = { ...def };
                mappedDef.pageItemTemplateID = shouldUpdate ? def.pageItemTemplateID : -1;
                mappedDef.pageTemplateID = targetId;
                mappedDef.contentViewID = shouldUpdate ? def.contentViewID : 0;

                if (def.contentDefinitionID) {
                    const modelMappers = new ModelMapper(sourceGuid[0], targetGuid[0]);
                    const modelMapping = modelMappers.getModelMappingByID(def.contentDefinitionID, 'source');
                    if (modelMapping?.targetID) mappedDef.contentDefinitionID = modelMapping.targetID;
                }
                if (def.itemContainerID) {
                    const containerMappers = new ContainerMapper(sourceGuid[0], targetGuid[0]);
                    const containerMapping = containerMappers.getContainerMappingByContentViewID(def.itemContainerID, 'source');
                    if (containerMapping?.targetContentViewID) mappedDef.itemContainerID = containerMapping.targetContentViewID;
                }
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
                const action = shouldUpdate ? 'updated' : 'created';
                logger.template[action](template, action, targetGuid[0])
                successful++;
            } catch (error: any) {
                logger.template.error(template, error, targetGuid[0])
                failed++;
                currentStatus = 'error';
                overallStatus = 'error';
                failureDetails.push({
                    name: template.pageTemplateName,
                    error: error?.message || String(error),
                    guid: sourceGuid[0],
                });
            }
        }
        return mappedDef;
      });

      const payload = {
        ...template,
        pageTemplateID: targetId,
        contentSectionDefinitions: mappedSections,
      };

      try {
        const savedTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid[0], locale, payload);
        referenceMapper.addMapping(template, savedTemplate);
        const action = shouldUpdate ? "updated" : "created";
        logger.template[action](template, action, targetGuid[0]);
        successful++;
      } catch (error: any) {
        logger.template.error(template, error, targetGuid[0]);
        failed++;
        currentStatus = "error";
        overallStatus = "error";
      }
    }

    return { status: overallStatus, successful, failed, skipped, failureDetails };
}
