/**
 * PROD-3042: after a sync saves pages, advance the container mappings the page saves made look
 * "changed on the target".
 *
 * Saving a page (UpdatePageItem) aligns the "requires approval" setting of the non-shared
 * containers of its components with the page's, and stamps lastModifiedDate on each one it changes.
 * The container pusher compares a target container's lastModifiedDate with the one in its mapping,
 * so on the next run those containers looked edited on the target, and every following sync needed
 * --overwrite. That's the same family as PROD-2604 (models) and PROD-2628 (pages in other locales).
 *
 * A container that was in sync with its mapping when the run started, and has a newer date now,
 * was changed by this run, so its mapping takes the new date. A container already changed on the
 * target before the run is left alone, so a real target edit still shows as a conflict.
 */

import { parse } from "date-fns";
import { state, getApiClient, getLoggerForGuid } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";
import { GuidDataLoader } from "../pushers/guid-data-loader";

const DATE_FORMAT = "MM/dd/yyyy hh:mma";

function toTime(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const time = parse(value, DATE_FORMAT, new Date()).getTime();
  return Number.isNaN(time) ? undefined : time;
}

export interface ContainerDateUpdate {
  targetContentViewID: number;
  from: string;
  to: string;
}

/**
 * Work out which container mapping records to advance, and advance them in place.
 *
 * @param records       container mapping records (targetContentViewID, targetLastModifiedDate)
 * @param pulledDates   target container ID -> lastModifiedDate in the target pull, i.e. at the start of the run
 * @param currentDates  target container ID -> lastModifiedDate now, after the run's writes
 */
export function advanceContainerDates(
  records: any[],
  pulledDates: Map<number, string>,
  currentDates: Map<number, string>
): ContainerDateUpdate[] {
  const updates: ContainerDateUpdate[] = [];
  for (const record of records || []) {
    const id = Number(record?.targetContentViewID);
    const mapped = toTime(record?.targetLastModifiedDate);
    const current = currentDates.get(id);
    const currentTime = toTime(current);
    if (!(id > 0) || mapped === undefined || currentTime === undefined || currentTime <= mapped) continue;

    // Not in the pull (e.g. created this run): its mapping was written by this run.
    const pulled = toTime(pulledDates.get(id));
    const inSyncAtStart = pulled === undefined || pulled <= mapped;
    if (!inSyncAtStart) continue;

    updates.push({ targetContentViewID: id, from: record.targetLastModifiedDate, to: current! });
    record.targetLastModifiedDate = current;
  }
  return updates;
}

/** Re-read the target's containers and advance the mappings this run's page saves made stale. */
export async function refreshContainerDatesAfterPageSaves(sourceGuid: string, targetGuid: string, locale: string): Promise<number> {
  if (state.preflight) return 0;
  const logger = getLoggerForGuid(sourceGuid);
  const fileOps = new fileOperations(targetGuid);
  const records = fileOps.getMappingFile("containers", sourceGuid, targetGuid, null);
  if (!Array.isArray(records) || records.length === 0) return 0;

  try {
    const pulled = await new GuidDataLoader(targetGuid).loadCompleteGuidEntities(locale);
    const pulledDates = new Map<number, string>(
      (pulled.containers || []).map((c: any) => [Number(c.contentViewID), c.lastModifiedDate] as [number, string])
    );
    const current = await getApiClient().containerMethods.getContainerList(targetGuid);
    const currentDates = new Map<number, string>(
      (current || []).map((c: any) => [Number(c.contentViewID), c.lastModifiedDate] as [number, string])
    );

    const updates = advanceContainerDates(records, pulledDates, currentDates);
    if (updates.length > 0) {
      fileOps.saveMappingFile(records, "containers", sourceGuid, targetGuid);
      logger?.info(
        `Container mappings: ${updates.length} advanced to the date this sync's page saves set (` +
          updates.map((u) => u.targetContentViewID).join(", ") +
          ")"
      );
    }
    return updates.length;
  } catch (error: any) {
    // Bookkeeping only: the sync itself succeeded. The cost of failing here is a false conflict next run.
    logger?.warning(`Could not refresh container mapping dates after page saves: ${error?.message || error}`);
    return 0;
  }
}
