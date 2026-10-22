import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getDeferredModelDisables, getLoggerForGuid, state } from "../../core/state";
import { FailureDetail, PusherResult } from "../../types/sourceData";
import { ModelMapper } from "lib/mappers/model-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { SectionMapper } from "lib/mappers/section-mapper";
import { getModelAvailabilityFromFileSystem } from "../getters/filesystem/get-model-availability";
import { preflightReport } from "../preflight/preflight-report";

/**
 * PROD-2914: push component availability from the source to the target.
 *
 * Ownership, per the component availability design:
 * - `allowedIn` (sitemaps, page models, zones) is modelling, so it travels with the model.
 * - `addableBy` (who can add) belongs to the instance: it's always sent as `null`, so the API keeps
 *   the target's own rules.
 * - `isVisible` (disabled) belongs to the instance too: the model pusher never sends it on an
 *   update. A model created this run takes the source's value, and this phase applies it.
 *
 * This phase runs LAST, after the pages of every locale. On a new target every placement on a page
 * counts as new, and the API checks new placements against the rules, so rules (or a disabled
 * model) in place before the pages would reject pages that are valid on the source, where those
 * placements are older than the rules. Run last, this run's pages land first; later runs only add
 * placements the target doesn't have yet, and those are checked like any other edit.
 *
 * Targets are remapped for the target instance: page models and zones by their ID mapping when
 * there is one (and by name otherwise), sitemaps by `referenceName`. Source IDs are never sent,
 * because the API resolves an ID before a name and a source ID can belong to a different object on
 * the target.
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

/** The server's own message in an error response, if it sent one (an unmatched route sends none). */
function hasServerMessage(error: any): boolean {
  const data = error?.responseData ?? error?.response?.data;
  if (data === undefined || data === null) return false;
  if (typeof data === "string") return data.trim().length > 0;
  return Boolean(data.message ?? data.Message ?? data.exceptionMessage ?? data.title);
}

/**
 * How a failed availability save is handled:
 * - "unsupported": the target can't store rules (405, 409 from a database without the feature, or
 *   a 404 with no message, which is an API without the route). Every other save would fail too.
 * - "forbidden": a 403. The permission is instance-wide, so every other save would fail too.
 * - "model": this model's own failure (a 400 such as an unresolved zone, or a 404 with the API's
 *   message, such as a model mapping that points at a model the target no longer has).
 */
function classifySaveError(error: any): "unsupported" | "forbidden" | "model" {
  const status = error?.statusCode ?? error?.response?.status;
  if (status === 405 || status === 409) return "unsupported";
  if (status === 404) return hasServerMessage(error) ? "model" : "unsupported";
  if (status === 403) return "forbidden";
  return "model";
}

function errorText(error: any): string {
  return error?.message ? String(error.message) : String(error);
}

interface PhaseCounts {
  successful: number;
  failed: number;
  skipped: number;
  failureDetails: FailureDetail[];
  warningDetails: FailureDetail[];
}

function emptyCounts(): PhaseCounts {
  return { successful: 0, failed: 0, skipped: 0, failureDetails: [], warningDetails: [] };
}

/**
 * Disable the models this run created whose source is disabled (`isVisible: false`). The model
 * pusher created them enabled so this run's pages could place them.
 */
async function disableModelsCreatedThisRun(
  sourceModels: mgmtApi.Model[],
  modelMapper: ModelMapper
): Promise<PhaseCounts> {
  const { sourceGuid, targetGuid } = state;
  const logger = getLoggerForGuid(sourceGuid);
  const counts = emptyCounts();
  const deferred = new Set(getDeferredModelDisables());
  if (deferred.size === 0) return counts;
  const apiClient = getApiClient();

  for (const sourceModel of sourceModels || []) {
    if (!sourceModel?.id || !deferred.has(sourceModel.id)) continue;

    if (state.preflight) {
      preflightReport.record({
        phase: "Component availability",
        action: "update",
        name: sourceModel.referenceName,
        detail: "disable the new model once the pages are synced (it's disabled on the source)",
      });
      counts.successful++;
      continue;
    }

    const mapping = modelMapper.getModelMappingByID(sourceModel.id, "source");
    if (!mapping?.targetID) {
      counts.skipped++;
      continue;
    }

    try {
      const target = await apiClient.modelMethods.getContentModel(mapping.targetID, targetGuid);
      if (!target) throw new Error(`The model with ID ${mapping.targetID} wasn't found on the target.`);
      if (target.isVisible === undefined) {
        // An API that doesn't return isVisible can't store it either (it saves every model enabled).
        const message =
          "The target instance's API can't disable models yet, so models that are disabled on the source were left enabled.";
        console.log(ansiColors.yellow(`⚠️ ${message}`));
        logger?.warning(message);
        counts.warningDetails.push({ name: "Component availability", error: message, type: "model", guid: sourceGuid });
        break;
      }
      const saved = await apiClient.modelMethods.saveModel({ ...target, isVisible: false }, targetGuid);
      // The save moves the target's modified date. Record it, or the next sync reads the model as
      // changed on the target and holds it back as a conflict.
      modelMapper.addMapping(sourceModel, saved?.lastModifiedDate ? saved : { ...target, ...(saved || {}) });
      logger?.info(`Model "${sourceModel.referenceName}" disabled, as it is on the source.`);
      counts.successful++;
    } catch (error: any) {
      const reason = errorText(error);
      logger?.error(`Disabling model "${sourceModel.referenceName}" failed: ${reason}`);
      counts.failed++;
      counts.failureDetails.push({
        name: sourceModel.referenceName,
        type: "model",
        error: `Failed to disable model "${sourceModel.referenceName}" (target ID: ${mapping.targetID}), which is disabled on the source: ${reason}`,
        guid: sourceGuid,
      });
    }
  }

  return counts;
}

/** Push the source's placement rules (`allowedIn`) for the models in this sync's scope. */
async function pushPlacementRules(sourceModels: mgmtApi.Model[], modelMapper: ModelMapper): Promise<PhaseCounts> {
  const { sourceGuid, targetGuid } = state;
  const logger = getLoggerForGuid(sourceGuid);
  const counts = emptyCounts();

  const sourceRules = getModelAvailabilityFromFileSystem(new fileOperations(sourceGuid));
  if (sourceRules === null) {
    // The source didn't answer (an API without the feature, or a failed pull): leave the target alone.
    logger?.info("No component availability rules were pulled from the source; skipping them.");
    return counts;
  }
  const targetRules = getModelAvailabilityFromFileSystem(new fileOperations(targetGuid));
  if (targetRules === null) {
    // The target didn't answer either way: its API can't store rules, or its pull failed. Saving
    // without knowing what it holds would be guesswork, so say so once (when there's anything to say).
    if (sourceRules.length > 0) {
      const message =
        "The target instance's component availability rules couldn't be read (its API may not support them yet), so placement rules weren't synced.";
      console.log(ansiColors.yellow(`⚠️ ${message}`));
      logger?.warning(message);
      counts.warningDetails.push({ name: "Component availability", error: message, type: "model", guid: sourceGuid });
    }
    return counts;
  }

  // A database without the feature reads exactly like one with no rules (an empty list), so an
  // empty source can't be told from a source that hasn't been migrated yet. Only a source that
  // listed at least one rule has proved it stores them, and only then is a model with no placement
  // rules allowed to clear the target's. Otherwise a sync from an unmigrated source would silently
  // wipe rules set on a migrated target.
  const sourceStoresRules = sourceRules.length > 0;

  const sourceByModelID = new Map<number, mgmtApi.ModelAvailability>();
  for (const rule of sourceRules) if (rule?.modelID) sourceByModelID.set(rule.modelID, rule);
  const targetByModelID = new Map<number, mgmtApi.ModelAvailability>();
  for (const rule of targetRules) if (rule?.modelID) targetByModelID.set(rule.modelID, rule);

  const templateMapper = new TemplateMapper(sourceGuid, targetGuid);
  const sectionMapper = new SectionMapper(sourceGuid, targetGuid);
  const apiClient = getApiClient();

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
        counts.successful++;
      } else {
        // The model itself wasn't synced (failed or skipped), so there's nothing to attach rules to.
        counts.skipped++;
      }
      continue;
    }

    const targetAllowedIn = targetByModelID.get(mapping.targetID)?.allowedIn ?? null;

    // Most models have no rules on either side: nothing to do, and nothing worth counting. A source
    // that hasn't proved it stores rules never clears the target's.
    if (isEmptyAllowedIn(sourceAllowedIn) && (!sourceStoresRules || isEmptyAllowedIn(targetAllowedIn))) continue;

    const desired = isEmptyAllowedIn(sourceAllowedIn)
      ? EMPTY_ALLOWED_IN
      : remapAllowedIn(sourceAllowedIn, templateMapper, sectionMapper);

    if (allowedInKey(desired) === allowedInKey(targetAllowedIn)) {
      logger?.fileOnly(`Component availability for "${sourceModel.referenceName}" is unchanged, skipping.`);
      counts.skipped++;
      continue;
    }

    if (state.preflight) {
      preflightReport.record({
        phase: "Component availability",
        action: "update",
        name: sourceModel.referenceName,
        detail: isEmptyAllowedIn(desired) ? "clear the placement rules" : "replace the placement rules",
      });
      counts.successful++;
      continue;
    }

    try {
      await apiClient.modelMethods.saveModelAvailability(
        mapping.targetID,
        { modelID: mapping.targetID, addableBy: null, allowedIn: desired },
        targetGuid
      );
      logger?.info(`Component availability for "${sourceModel.referenceName}" updated.`);
      counts.successful++;
    } catch (error: any) {
      const kind = classifySaveError(error);
      if (kind === "unsupported") {
        // The target can't store rules yet. Say so once and stop: every other save would fail too.
        const message =
          "The target instance doesn't support component availability rules yet, so placement rules weren't synced.";
        console.log(ansiColors.yellow(`⚠️ ${message}`));
        logger?.warning(message);
        counts.warningDetails.push({ name: "Component availability", error: message, type: "model", guid: sourceGuid });
        break;
      }
      const reason = errorText(error);
      if (kind === "forbidden") {
        // One failure, not one per model: the permission is the same for all of them.
        const message = `Component availability rules weren't synced: saving them needs the Manage or Design permission on the target (${reason})`;
        logger?.error(message);
        counts.failed++;
        counts.failureDetails.push({ name: "Component availability", type: "model", error: message, guid: sourceGuid });
        break;
      }
      logger?.error(`Component availability for "${sourceModel.referenceName}" failed: ${reason}`);
      counts.failed++;
      counts.failureDetails.push({
        name: sourceModel.referenceName,
        type: "model",
        error: `Failed to save component availability for "${sourceModel.referenceName}" (target ID: ${mapping.targetID}): ${reason}`,
        guid: sourceGuid,
      });
    }
  }

  return counts;
}

export async function pushModelAvailability(sourceModels: mgmtApi.Model[]): Promise<PusherResult> {
  const { sourceGuid, targetGuid } = state;
  const modelMapper = new ModelMapper(sourceGuid, targetGuid);

  const parts = [
    await disableModelsCreatedThisRun(sourceModels, modelMapper),
    await pushPlacementRules(sourceModels, modelMapper),
  ];
  const sum = (pick: (c: PhaseCounts) => number) => parts.reduce((total, c) => total + pick(c), 0);
  const failed = sum((c) => c.failed);

  return {
    status: failed > 0 ? "error" : "success",
    successful: sum((c) => c.successful),
    failed,
    skipped: sum((c) => c.skipped),
    failureDetails: parts.flatMap((c) => c.failureDetails),
    warningDetails: parts.flatMap((c) => c.warningDetails),
  };
}
