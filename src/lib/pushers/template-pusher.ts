import * as mgmtApi from "@agility/management-sdk";
import { state, getLoggerForGuid } from "../../core/state";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { FailureDetail, PusherResult } from "types/sourceData";
import { preflightReport } from "../preflight/preflight-report";


export async function pushTemplates(
  sourceTemplates: mgmtApi.PageModel[],
  targetTemplates: mgmtApi.PageModel[],
  locale: string
): Promise<PusherResult> {

  const { sourceGuid, cachedApiClient: apiClient } = state;
  const logger = getLoggerForGuid(sourceGuid[0]);

  if (!sourceTemplates || sourceTemplates.length === 0) {
    console.log("No sourceTemplates found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let processedCount = 0;
  let overallStatus: "success" | "error" = "success";
  const failureDetails: FailureDetail[] = [];

  for (let i = 0; i < sourceTemplates.length; i++) {
    let sourceTemplate = sourceTemplates[i];

    const { sourceGuid, targetGuid } = state;
    const referenceMapper = new TemplateMapper(sourceGuid[0], targetGuid[0]);

    let existingMapping = referenceMapper.getTemplateMapping(sourceTemplate, "source");
    let targetTemplate: mgmtApi.PageModel | null = null;

    // If we have a mapping, try to get the target template via the target template id from the mapping
    if(existingMapping){
      targetTemplate = targetTemplates.find((t) => t.pageTemplateID === existingMapping.targetPageTemplateID) ?? null;
    }

    // Handle templates that exist in target but have no mapping (match by name)
    if (!existingMapping && !targetTemplate) {
      targetTemplate = targetTemplates.find((t) => t.pageTemplateName === sourceTemplate.pageTemplateName) ?? null;
      if (targetTemplate) {
          logger.template.error(
            sourceTemplate,
            new Error(
              `A target template named "${targetTemplate.pageTemplateName}" with ID: ${targetTemplate.pageTemplateID} exists but is not mapped to source ID ${sourceTemplate.pageTemplateID} (likely a rename or reassignment of the source template).`
            ),
            targetGuid[0]
          );
          throw new Error(
            `Page template validation failed: mapping inconsistency for template "${sourceTemplate.pageTemplateName}" (ID: ${sourceTemplate.pageTemplateID}). ` +
              `A mapping exists for the target template, but the source template ID does not match — this likely indicates ` +
              `a rename or reassignment on the source. Stopping sync to avoid a partial push; review the template mappings and re-run. Please contact AgilityCMS Support to resolve this issue`
          );
      }
    }

    // Templates have no lastModifiedDate, so compare the source and target
    // structure directly: identical -> skip, different -> update (source wins),
    // mapped but missing on target -> fall through and recreate.
    const templateChanged = referenceMapper.hasTemplateChanged(sourceTemplate, targetTemplate);

    const shouldUpdate = existingMapping !== null && targetTemplate !== null && templateChanged;
    const shouldSkip = existingMapping !== null && targetTemplate !== null && !templateChanged;

    if (shouldSkip) {
      logger.template.skipped(sourceTemplate, "Up to date, skipping", targetGuid[0]);
      preflightReport.record({
        phase: "Templates",
        action: "skip",
        name: sourceTemplate.pageTemplateName,
        detail: "up to date",
      });
      skipped++;
    }
    else if (state.preflight) {
      // Preflight: report the planned create/update and skip the write.
      preflightReport.record({
        phase: "Templates",
        action: shouldUpdate ? "update" : "create",
        name: sourceTemplate.pageTemplateName,
      });
      successful++;
    }
    else {
      let targetId = shouldUpdate ? targetTemplate?.pageTemplateID : -1;

      // Prepare payload
      const mappedSections = sourceTemplate.contentSectionDefinitions.map((sourceContentSecDef) => {
        const mappedDef = { ...sourceContentSecDef };

        // Find the target section data to use for updates
        const targetSection = shouldUpdate ? targetTemplate?.contentSectionDefinitions?.find((targetContentSecDef) => targetContentSecDef.pageItemTemplateReferenceName === sourceContentSecDef.pageItemTemplateReferenceName) : null;

        mappedDef.pageItemTemplateID = shouldUpdate ? targetSection?.pageItemTemplateID ?? -1 : -1;
        mappedDef.pageTemplateID = targetId;
        mappedDef.contentViewID = shouldUpdate ? targetSection?.contentViewID ?? -1 : -1;

        // should have the models by now
        if (sourceContentSecDef.contentDefinitionID) {
          const modelMappers = new ModelMapper(sourceGuid[0], targetGuid[0]);
          const modelMapping = modelMappers.getModelMappingByID(sourceContentSecDef.contentDefinitionID, "source");
          if (modelMapping?.targetID) mappedDef.contentDefinitionID = modelMapping.targetID;
        }

        // should have the containers by now
        if (sourceContentSecDef.itemContainerID) {
          const containerMappers = new ContainerMapper(sourceGuid[0], targetGuid[0]);
          const containerMapping = containerMappers.getContainerMappingByContentViewID(sourceContentSecDef.itemContainerID, "source");
          if (containerMapping?.targetContentViewID) mappedDef.itemContainerID = containerMapping.targetContentViewID;
        }

        return mappedDef;
      });

      const payload = {
        ...sourceTemplate,
        pageTemplateID: targetId,
        contentSectionDefinitions: mappedSections,
      };

      try {
        const savedTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid[0], locale, payload);
        referenceMapper.addMapping(sourceTemplate, savedTemplate);
        const action = shouldUpdate ? "updated" : "created";
        logger.template[action](sourceTemplate, action, targetGuid[0]);
        successful++;
      } catch (error: any) {
        logger.template.error(sourceTemplate, error, targetGuid[0]);
        failed++;
        overallStatus = "error";
        failureDetails.push({
          name: sourceTemplate.pageTemplateName,
          error: error?.message || String(error),
          guid: sourceGuid[0],
        });
      }
    }

    processedCount++;
  }

  return { status: overallStatus, successful, failed, skipped, failureDetails };
}
