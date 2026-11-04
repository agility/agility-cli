import * as mgmtApi from "@agility/management-sdk";
import { state, getLoggerForGuid, registerHeldBackTemplate, recordSavedTarget } from "../../core/state";
import { TemplateMapper, templateHash } from "lib/mappers/template-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { SectionMapper } from "lib/mappers/section-mapper";
import { FailureDetail, PusherResult } from "types/sourceData";
import { preflightReport } from "../preflight/preflight-report";
import { keptTargetChanges } from "./kept-target-changes";
import { decideSync, fingerprintFields, hasFingerprint, UNRECORDED_UPDATE_DETAIL } from "../shared/sync-fingerprint";
import ansiColors from "ansi-colors";

/**
 * Source sections with no counterpart on the target template, by the section ID mapping or by
 * reference name: the zones translateZoneNames could only place by position or fold into the main
 * zone. Used when the target's template is left as it is (a kept target change or a conflict).
 */
function unresolvedSections(
  sourceTemplate: mgmtApi.PageModel,
  targetTemplate: mgmtApi.PageModel,
  sectionMapper: SectionMapper
): string[] {
  const targetSections = targetTemplate.contentSectionDefinitions || [];
  return (sourceTemplate.contentSectionDefinitions || [])
    .filter((sourceSection) => {
      if (!sourceSection) return false;
      const mapping =
        sourceSection.pageItemTemplateID != null
          ? sectionMapper.getSectionMappingByID(sourceSection.pageItemTemplateID, "source")
          : null;
      if (mapping && targetSections.some((t) => t?.pageItemTemplateID === mapping.targetPageItemTemplateID)) return false;
      return !targetSections.some((t) => t?.pageItemTemplateReferenceName === sourceSection.pageItemTemplateReferenceName);
    })
    .map((s) => s.pageItemTemplateReferenceName);
}


export async function pushTemplates(
  sourceTemplates: mgmtApi.PageModel[],
  targetTemplates: mgmtApi.PageModel[],
  locale: string
): Promise<PusherResult> {

  const { sourceGuid, cachedApiClient: apiClient } = state;
  const logger = getLoggerForGuid(sourceGuid);

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

    const templateMapper = new TemplateMapper(sourceGuid, targetGuid);
    const sectionMapper = new SectionMapper(sourceGuid, targetGuid);

    let existingMapping = templateMapper.getTemplateMapping(sourceTemplate, "source");
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
            targetGuid
          );
          throw new Error(
            `Page template validation failed: mapping inconsistency for template "${sourceTemplate.pageTemplateName}" (ID: ${sourceTemplate.pageTemplateID}). ` +
              `A mapping exists for the target template, but the source template ID does not match — this likely indicates ` +
              `a rename or reassignment on the source. Stopping sync to avoid a partial push; review the template mappings and re-run. Please contact AgilityCMS Support to resolve this issue`
          );
      }
    }

    // PROD-2603: the mapping points at a target template that is no longer in the pulled target
    // data (deleted on the target). Treat it like a target-side change, as model-pusher does:
    // conflict unless --overwrite, which falls through and recreates it (addMapping repoints the
    // stale record). Templates have no lastModifiedDate, so unlike content there is no
    // "source unchanged -> skip" branch. Pages that use a held-back template are skipped by the
    // page pusher rather than saved against the dead target ID.
    if (existingMapping && !targetTemplate && !state.overwrite) {
      const reason = `Warning: mapped target template (ID: ${existingMapping.targetPageTemplateID}) no longer exists on the target! Add \`--overwrite\` flag to recreate it.`;
      console.warn(`⚠️  Conflict detected Template ${sourceTemplate.pageTemplateName} — ${reason}`);
      logger.template.skipped(sourceTemplate, reason, targetGuid);
      preflightReport.record({
        phase: "Templates",
        action: "conflict",
        name: sourceTemplate.pageTemplateName,
        detail: reason,
      });
      registerHeldBackTemplate(
        sourceTemplate.pageTemplateName,
        `page template ${sourceTemplate.pageTemplateName} is missing on the target and was not recreated (use --overwrite to recreate it)`
      );
      skipped++;
      processedCount++;
      continue;
    }

    // Templates have no version or modified date. Whether the two sides differ is a structural
    // comparison; which side changed since the last sync comes from the hashes stored in the
    // mapping (PROD-3078, see sync-fingerprint.ts). A mapping with no hashes yet (older CLI) lets
    // the source win, as before. Mapped but missing on the target (only reached with --overwrite):
    // fall through and recreate.
    const templateChanged = templateMapper.hasTemplateChanged(sourceTemplate, targetTemplate, sectionMapper);
    const sourceHash = templateHash(sourceTemplate);
    const targetHash = targetTemplate ? templateHash(targetTemplate) : null;
    const decision =
      existingMapping && targetTemplate ? decideSync(!templateChanged, sourceHash, targetHash!, existingMapping) : null;

    if ((decision === "keep" || decision === "conflict") && !state.overwrite) {
      // The target's template stays as it is. Pages that use it are still synced against it,
      // unless one of the source's zones has no section on it to go to: placing those by
      // position or folding them into the main zone would move components, so hold them back.
      const missing = unresolvedSections(sourceTemplate, targetTemplate!, sectionMapper);
      if (missing.length > 0) {
        registerHeldBackTemplate(
          sourceTemplate.pageTemplateName,
          `page template ${sourceTemplate.pageTemplateName} was ${decision === "keep" ? "changed on the target and kept" : "changed on both sides (a conflict)"}, ` +
            `and has no section for zone(s) ${missing.join(", ")} (use --overwrite to replace it with the source)`
        );
      }
      const heldBack = missing.length > 0 ? `; pages using it are held back (no section for ${missing.join(", ")})` : "";

      if (decision === "keep") {
        const change = {
          type: "template" as const,
          name: sourceTemplate.pageTemplateName,
          sourceID: sourceTemplate.pageTemplateID,
          targetID: targetTemplate!.pageTemplateID,
        };
        keptTargetChanges.record(change);
        console.warn(ansiColors.yellow(keptTargetChanges.formatLine(change)));
        logger.template.skipped(sourceTemplate, `target changed since the last sync, kept${heldBack}`, targetGuid);
        preflightReport.record({
          phase: "Templates",
          action: "skip",
          name: sourceTemplate.pageTemplateName,
          detail: `target changed since the last sync and the source didn't; kept the target's version${heldBack}`,
        });
      } else {
        const reason = `source and target both changed since the last sync; use --overwrite to replace the target${heldBack}`;
        console.warn(`⚠️  Conflict detected Template ${sourceTemplate.pageTemplateName} — ${reason}`);
        logger.template.skipped(sourceTemplate, `conflict: ${reason}`, targetGuid);
        preflightReport.record({
          phase: "Templates",
          action: "conflict",
          name: sourceTemplate.pageTemplateName,
          detail: `source and target both changed; use --overwrite to force${heldBack}`,
        });
      }
      skipped++;
      processedCount++;
      continue;
    }

    const shouldUpdate = existingMapping !== null && targetTemplate !== null && templateChanged;
    const shouldSkip = existingMapping !== null && targetTemplate !== null && !templateChanged;
    const updateDetail =
      decision === "update-unrecorded"
        ? UNRECORDED_UPDATE_DETAIL
        : decision === "keep"
          ? "target change overwritten"
          : decision === "conflict"
            ? "conflict overwritten"
            : undefined;

    if (shouldSkip) {
      // Backfill the section ID mapping for templates that are already in sync but predate
      // SectionMapper (PROD-2350) — otherwise a template that never changes again would never
      // get its sections seeded, leaving translateZoneNames on the name-match fallback forever.
      // "Up to date" means hasTemplateChanged already found the source and target structurally
      // identical, so source/target section counts and names should always line up here; if
      // they don't, something is inconsistent and we hard-stop rather than guess.
      const sourceSections = sourceTemplate.contentSectionDefinitions || [];
      const targetSections = targetTemplate?.contentSectionDefinitions || [];

      if (sourceSections.length !== targetSections.length) {
        throw new Error(
          `Page template validation failed: template "${sourceTemplate.pageTemplateName}" (ID: ${sourceTemplate.pageTemplateID}) is marked up to date, but has ${sourceSections.length} section(s) on the source and ${targetSections.length} on the target. ` +
            `This indicates a mapping inconsistency; review the template mappings and re-run. Please contact AgilityCMS Support to resolve this issue`
        );
      }

      for (const sourceSection of sourceSections) {
        const targetSection = targetSections.find(
          (t) => t.pageItemTemplateReferenceName === sourceSection.pageItemTemplateReferenceName
        );

        if (!targetSection) {
          throw new Error(
            `Page template validation failed: template "${sourceTemplate.pageTemplateName}" (ID: ${sourceTemplate.pageTemplateID}) is marked up to date, but source section "${sourceSection.pageItemTemplateReferenceName}" has no matching section on the target. ` +
              `This indicates a mapping inconsistency; review the template mappings and re-run. Please contact AgilityCMS Support to resolve this issue`
          );
        }

        if (sourceSection.pageItemTemplateID == null || targetSection.pageItemTemplateID == null) continue;

        const existingSectionMapping = sectionMapper.getSectionMappingByID(sourceSection.pageItemTemplateID, "source");
        if (!existingSectionMapping) {
          sectionMapper.addMapping(sourceSection, targetSection);
        }
      }

      // Seed or refresh the hashes: an older mapping gets them here, and two sides edited to the
      // same structure agree again.
      if (
        !hasFingerprint(existingMapping) ||
        existingMapping.sourceHash !== sourceHash ||
        existingMapping.targetHash !== targetHash
      ) {
        templateMapper.recordFingerprint(existingMapping, fingerprintFields(sourceHash, targetHash!));
      }

      logger.template.skipped(sourceTemplate, "Up to date, skipping", targetGuid);
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
        ...(shouldUpdate && updateDetail ? { detail: updateDetail } : {}),
      });
      successful++;
    }
    else {
      let targetId = shouldUpdate ? targetTemplate?.pageTemplateID : -1;


      // Prepare payload
      const mappedSections = sourceTemplate.contentSectionDefinitions.map((sourceContentSecDef) => {
        const mappedDef = { ...sourceContentSecDef };

        // Find the target section data to use for updates. Prefer the persisted ID mapping —
        // PROD-2350: matching by reference name breaks whenever a section has been renamed on
        // either side. Fall back to a name match only when no mapping exists yet (first push
        // after upgrading, or a section that's genuinely new).
        let targetSection: mgmtApi.ContentSectionDefinition | null = null;
        if (shouldUpdate) {
          const sectionMapping = sourceContentSecDef.pageItemTemplateID
            ? sectionMapper.getSectionMappingByID(sourceContentSecDef.pageItemTemplateID, "source")
            : null;

          targetSection = sectionMapping
            ? targetTemplate?.contentSectionDefinitions?.find(
                (t) => t.pageItemTemplateID === sectionMapping.targetPageItemTemplateID
              ) ?? null
            : null;

          if (!targetSection) {
            targetSection =
              targetTemplate?.contentSectionDefinitions?.find(
                (t) => t.pageItemTemplateReferenceName === sourceContentSecDef.pageItemTemplateReferenceName
              ) ?? null;
          }
        }

        mappedDef.pageItemTemplateID = targetSection?.pageItemTemplateID ?? -1;
        mappedDef.pageTemplateID = targetId;
        mappedDef.contentViewID = targetSection?.contentViewID ?? -1;

        // should have the models by now
        if (sourceContentSecDef.contentDefinitionID) {
          const modelMappers = new ModelMapper(sourceGuid, targetGuid);
          const modelMapping = modelMappers.getModelMappingByID(sourceContentSecDef.contentDefinitionID, "source");
          if (modelMapping?.targetID) mappedDef.contentDefinitionID = modelMapping.targetID;
        }

        // should have the containers by now
        if (sourceContentSecDef.itemContainerID) {
          const containerMappers = new ContainerMapper(sourceGuid, targetGuid);
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
        const savedTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid, locale, payload);
        // The target's hash comes from what the server saved, not from what was sent: if it
        // normalises a compared field (renumbering itemOrder, say), hashing the payload would make
        // the next pull look like a target edit and keep it with a false warning on every run.
        templateMapper.addMapping(sourceTemplate, savedTemplate, fingerprintFields(sourceHash, templateHash(savedTemplate)));
        // The page pusher translates zone names against this template; the pulled copy lacks any zone added here.
        recordSavedTarget("template", sourceTemplate.pageTemplateID, savedTemplate, sourceTemplate.pageTemplateName);

        // Refresh section-level ID mappings from the confirmed response — this both seeds the
        // mapping the first time a section is seen and keeps it correct going forward, regardless
        // of any later renames on either side.
        for (const sourceSection of sourceTemplate.contentSectionDefinitions || []) {
          const savedSection = savedTemplate.contentSectionDefinitions?.find(
            (s) => s.pageItemTemplateReferenceName === sourceSection.pageItemTemplateReferenceName
          );
          if (savedSection?.pageItemTemplateID != null && sourceSection.pageItemTemplateID != null) {
            sectionMapper.addMapping(sourceSection, savedSection);
          }
        }

        const action = shouldUpdate ? "updated" : "created";
        logger.template[action](sourceTemplate, action, targetGuid);
        successful++;
      } catch (error: any) {
        logger.template.error(sourceTemplate, error, targetGuid);
        failed++;
        overallStatus = "error";
        failureDetails.push({
          name: sourceTemplate.pageTemplateName,
          type: "template",
          error: error?.message || String(error),
          guid: sourceGuid,
        });
      }
    }

    processedCount++;
  }

  return { status: overallStatus, successful, failed, skipped, failureDetails };
}
