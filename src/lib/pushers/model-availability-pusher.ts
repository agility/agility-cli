import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getLoggerForGuid, state } from "../../core/state";
import { FailureDetail, PusherResult } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { SectionMapper } from "lib/mappers/section-mapper";
import { getModelAvailabilityFromFileSystem } from "../getters/filesystem/get-model-availability";
import { isAvailabilityUnsupported } from "../downloaders/download-model-availability";
import { preflightReport } from "../preflight/preflight-report";

/**
 * PROD-2914: push component availability rules ("where it can go") from the source to the target.
 *
 * Ownership, per the component availability design:
 * - `allowedIn` (sitemaps, page models, zones) is modelling, so it travels with the model. The
 *   target ends up with the source's rules, including having them cleared when the source has none.
 * - `addableBy` (who can add) belongs to the instance: it's always sent as `null`, so the API keeps
 *   the target's own rules. (Disabling a model is `isVisible`, handled by the model pusher.)
 *
 * Runs after templates, so the page models and zones it names exist on the target. Targets are
 * remapped for the target instance: page models and zones by their ID mapping when there is one
 * (and by name otherwise), sitemaps by `referenceName`. Source IDs are never sent, because the API
 * resolves an ID before a name and a source ID can belong to a different object on the target.
 */

const EMPTY_ALLOWED_IN: mgmtApi.ModelAvailabilityAllowedIn = { sitemaps: [], pageModels: [], zones: [] };

function lower(value: string | null | undefined): string {
  return (value || "").toLowerCase();
}

function isEmptyAllowedIn(allowedIn: mgmtApi.ModelAvailabilityAllowedIn | null | undefined): boolean {
  return (
    !allowedIn ||
    ((allowedIn.sitemaps || []).length === 0 &&
      (allowedIn.pageModels || []).length === 0 &&
      (allowedIn.zones || []).length === 0)
  );
}

/** Name keys of an `allowedIn` group, for comparing a source group with what the target holds. */
function allowedInKey(allowedIn: mgmtApi.ModelAvailabilityAllowedIn | null | undefined): string {
  const group = allowedIn || EMPTY_ALLOWED_IN;
  const sitemaps = (group.sitemaps || []).map((s) => lower(s.referenceName)).sort();
  const pageModels = (group.pageModels || []).map((p) => lower(p.name)).sort();
  const zones = (group.zones || []).map((z) => `${lower(z.pageModelName)}/${lower(z.referenceName || z.name)}`).sort();
  return JSON.stringify({ sitemaps, pageModels, zones });
}

/**
 * Rewrite a source `allowedIn` group for the target instance. Only the portable names, and target
 * IDs from the sync's own mappings, are sent.
 */
export function remapAllowedIn(
  allowedIn: mgmtApi.ModelAvailabilityAllowedIn,
  templateMapper: TemplateMapper,
  sectionMapper: SectionMapper
): mgmtApi.ModelAvailabilityAllowedIn {
  const targetPageModel = (sourcePageModelID: number | null | undefined) =>
    sourcePageModelID ? templateMapper.getTemplateMappingByPageTemplateID(sourcePageModelID, "source") : null;

  return {
    sitemaps: (allowedIn.sitemaps || []).map((sitemap) => ({
      referenceName: sitemap.referenceName ?? null,
      name: sitemap.name ?? null,
    })),
    pageModels: (allowedIn.pageModels || []).map((pageModel) => {
      const mapping = targetPageModel(pageModel.pageModelID);
      return {
        ...(mapping ? { pageModelID: mapping.targetPageTemplateID } : {}),
        name: mapping?.targetPageTemplateName || pageModel.name || null,
      };
    }),
    zones: (allowedIn.zones || []).map((zone) => {
      const pageModelMapping = targetPageModel(zone.pageModelID);
      const zoneMapping = zone.zoneID ? sectionMapper.getSectionMappingByID(zone.zoneID, "source") : null;
      return {
        ...(zoneMapping ? { zoneID: zoneMapping.targetPageItemTemplateID } : {}),
        ...(pageModelMapping ? { pageModelID: pageModelMapping.targetPageTemplateID } : {}),
        pageModelName: pageModelMapping?.targetPageTemplateName || zone.pageModelName || null,
        referenceName: zoneMapping?.targetReferenceName || zone.referenceName || null,
        name: zone.name ?? null,
      };
    }),
  };
}

export async function pushModelAvailability(sourceModels: mgmtApi.Model[]): Promise<PusherResult> {
  const { sourceGuid, targetGuid } = state;
  const logger = getLoggerForGuid(sourceGuid);

  const sourceRules = getModelAvailabilityFromFileSystem(new fileOperations(sourceGuid));
  if (sourceRules === null) {
    // The source didn't answer (an API or database without the feature): leave the target alone.
    logger?.info("No component availability rules were pulled from the source; skipping them.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }
  // null = unknown: without the target's rules, a source with no rules mustn't clear anything.
  const targetRules = getModelAvailabilityFromFileSystem(new fileOperations(targetGuid));

  const sourceByModelID = new Map<number, mgmtApi.ModelAvailability>();
  for (const rule of sourceRules) if (rule?.modelID) sourceByModelID.set(rule.modelID, rule);
  const targetByModelID = new Map<number, mgmtApi.ModelAvailability>();
  for (const rule of targetRules || []) if (rule?.modelID) targetByModelID.set(rule.modelID, rule);

  const modelMapper = new ModelMapper(sourceGuid, targetGuid);
  const templateMapper = new TemplateMapper(sourceGuid, targetGuid);
  const sectionMapper = new SectionMapper(sourceGuid, targetGuid);
  const apiClient = getApiClient();

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const failureDetails: FailureDetail[] = [];
  const warningDetails: FailureDetail[] = [];

  // Only models in this sync's scope (sourceModels is already narrowed by --models and friends).
  for (const sourceModel of sourceModels || []) {
    if (!sourceModel?.id) continue;
    const sourceAllowedIn = sourceByModelID.get(sourceModel.id)?.allowedIn ?? null;

    const mapping = modelMapper.getModelMappingByID(sourceModel.id, "source");
    if (!mapping?.targetID) {
      if (isEmptyAllowedIn(sourceAllowedIn)) continue;
      if (state.preflight) {
        // Preflight writes no models, so a model the real run would create has no mapping yet.
        preflightReport.record({
          phase: "Component availability",
          action: "create",
          name: sourceModel.referenceName,
          detail: "set the placement rules once the model exists on the target",
        });
        successful++;
      } else {
        // The model itself wasn't synced (failed or skipped), so there's nothing to attach rules to.
        skipped++;
      }
      continue;
    }

    const targetKnown = targetRules !== null;
    const targetAllowedIn = targetByModelID.get(mapping.targetID)?.allowedIn ?? null;

    // Most models have no rules on either side: nothing to do, and nothing worth counting.
    if (isEmptyAllowedIn(sourceAllowedIn) && (!targetKnown || isEmptyAllowedIn(targetAllowedIn))) continue;

    const desired = isEmptyAllowedIn(sourceAllowedIn)
      ? EMPTY_ALLOWED_IN
      : remapAllowedIn(sourceAllowedIn, templateMapper, sectionMapper);

    if (targetKnown && allowedInKey(desired) === allowedInKey(targetAllowedIn)) {
      logger?.fileOnly(`Component availability for "${sourceModel.referenceName}" is unchanged, skipping.`);
      skipped++;
      continue;
    }

    if (state.preflight) {
      preflightReport.record({
        phase: "Component availability",
        action: "update",
        name: sourceModel.referenceName,
        detail: isEmptyAllowedIn(desired) ? "clear the placement rules" : "replace the placement rules",
      });
      successful++;
      continue;
    }

    try {
      await apiClient.modelMethods.saveModelAvailability(
        mapping.targetID,
        { modelID: mapping.targetID, addableBy: null, allowedIn: desired },
        targetGuid
      );
      logger?.info(`Component availability for "${sourceModel.referenceName}" updated.`);
      successful++;
    } catch (error: any) {
      if (isAvailabilityUnsupported(error)) {
        // The target can't store rules yet. Say so once and stop: every other save would fail too.
        const message =
          "The target instance doesn't support component availability rules yet, so placement rules weren't synced.";
        console.log(ansiColors.yellow(`⚠️ ${message}`));
        logger?.warning(message);
        warningDetails.push({ name: "Component availability", error: message, type: "model", guid: sourceGuid });
        break;
      }
      const reason = error?.message ? String(error.message) : String(error);
      logger?.error(`Component availability for "${sourceModel.referenceName}" failed: ${reason}`);
      failed++;
      failureDetails.push({
        name: sourceModel.referenceName,
        type: "model",
        error: `Failed to save component availability for "${sourceModel.referenceName}" (target ID: ${mapping.targetID}): ${reason}`,
        guid: sourceGuid,
      });
    }
  }

  return {
    status: failed > 0 ? "error" : "success",
    successful,
    failed,
    skipped,
    failureDetails,
    warningDetails,
  };
}
