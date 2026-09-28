import * as mgmtApi from "@agility/management-sdk";
import { PageMapper } from "../../mappers/page-mapper";

interface Props {
  targetPageID: number;
  savedLocale: string;
  locales: string[];
  sourceGuid: string;
  targetGuid: string;
  apiClient: mgmtApi.ApiClient;
}

/**
 * PROD-2628: saving a page in one locale can give the page a new versionID in its other locales
 * too (observed on the server for some pages, not all). The mapping for the other locale still
 * holds the version recorded before this save, so the next run reads the other locale as
 * "target has been changed independently" — and under reverse-sync the same bump on the
 * original source reads as a source change, so the page ping-pongs between the instances.
 *
 * After a successful save, re-read the page in each other locale of this run and move that
 * locale's recorded targetVersionID forward. Only records that were in sync before the save are
 * refreshed: a locale whose pulled target version is already ahead of its mapping carries a real
 * edit made outside the CLI, and is left alone so it is still detected as a conflict.
 *
 * Mapping files are oriented through PageMapper/fileOperations, so under reverse-sync this moves
 * the original source's recorded version, which is the side reverse-sync wrote to.
 *
 * Returns the locales whose mapping was refreshed. Never throws — a failed re-read only leaves
 * the old behaviour (a spurious conflict on the next run) for that locale.
 */
export async function refreshOtherLocaleVersions({
  targetPageID,
  savedLocale,
  locales,
  sourceGuid,
  targetGuid,
  apiClient,
}: Props): Promise<string[]> {
  const refreshed: string[] = [];

  for (const otherLocale of locales || []) {
    if (!otherLocale || otherLocale === savedLocale) continue;

    try {
      const otherMapper = new PageMapper(sourceGuid, targetGuid, otherLocale);
      const record = otherMapper.getPageMappingByPageID(targetPageID, "target");
      if (!record) continue;

      // The pulled target page for that locale (read at the start of the run). Ahead of the
      // mapping means an independent target edit: leave the record so it still conflicts.
      const pulledTargetPage = otherMapper.getMappedEntity(record, "target");
      if (!pulledTargetPage) continue;
      const pulledVersion = pulledTargetPage.properties?.versionID ?? 0;
      if (pulledVersion > record.targetVersionID) continue;

      const currentPage = await apiClient.pageMethods.getPage(targetPageID, targetGuid, otherLocale);
      const currentVersion = currentPage?.properties?.versionID;
      if (!currentVersion || currentVersion <= record.targetVersionID) continue;

      const result = otherMapper.updateTargetVersionID(targetPageID, currentVersion);
      if (result.success) refreshed.push(otherLocale);
    } catch {
      // Non-fatal: see the doc comment.
    }
  }

  return refreshed;
}
