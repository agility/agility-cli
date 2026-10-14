import { ContentItem } from "@agility/management-sdk";
import { AssetMapper } from "lib/mappers/asset-mapper";
import { fileOperations } from "core/fileOperations";
import { getAssetsFromFileSystem } from "lib/getters/filesystem/get-assets";
import { buildCdnOwnership, collectForeignCdnReferences, ForeignCdnDetector } from "lib/content/foreign-cdn-detector";
import { foreignCdnReport } from "lib/content/foreign-cdn-report";

// One detector per source/target pair per process: building it reads every pulled asset file.
// Asset mappings created later in the same run only add containers already known from the pulled
// assets, so reusing it across the content phases of every locale is safe.
let cachedDetector: { key: string; detector: ForeignCdnDetector } | null = null;

export function resetForeignCdnDetectorCache(): void {
  cachedDetector = null;
}

export function getForeignCdnDetector(sourceGuid: string, targetGuid: string): ForeignCdnDetector {
  const key = `${sourceGuid}->${targetGuid}`;
  if (cachedDetector?.key === key) return cachedDetector.detector;

  const read = <T>(fn: () => T[]): T[] => {
    try {
      return fn() || [];
    } catch {
      return []; // best-effort: an unreadable side just stays unknown (no warnings)
    }
  };
  const assetMappings = read(() => [...new AssetMapper(sourceGuid, targetGuid).getMappings()]);
  const sourceAssets = read(() => getAssetsFromFileSystem(new fileOperations(sourceGuid)));
  const targetAssets = read(() => getAssetsFromFileSystem(new fileOperations(targetGuid)));

  const detector = new ForeignCdnDetector(buildCdnOwnership({ assetMappings, sourceAssets, targetAssets }));
  cachedDetector = { key, detector };
  return detector;
}

/**
 * PROD-2773: scan the content items of one locale for foreign CDN references and record them in
 * foreignCdnReport. Runs in both real and --preflight runs, before change detection, so an
 * unchanged item still carrying a foreign URL is reported too. Reporting only — the items are not
 * touched. Logs a warning the first time each URL is seen; repeat sightings go to the log file only.
 */
export function reportForeignCdnReferences(
  contentItems: ContentItem[],
  locale: string,
  opts: { sourceGuid: string; targetGuid: string; logger?: any; detector?: ForeignCdnDetector }
): number {
  const detector = opts.detector ?? getForeignCdnDetector(opts.sourceGuid, opts.targetGuid);
  if (!detector.isEnabled()) return 0;
  foreignCdnReport.setOwnContainers(detector.sourceContainers, detector.targetContainers);

  let found = 0;
  for (const contentItem of contentItems) {
    const refs = collectForeignCdnReferences(contentItem?.fields, detector);
    for (const ref of refs) {
      const item = {
        contentID: contentItem.contentID,
        referenceName: contentItem.properties?.referenceName ?? "unknown",
        locale,
      };
      const outcome = foreignCdnReport.record(ref, item);
      if (outcome === "duplicate") continue;
      found++;
      const message = foreignCdnReport.formatOccurrence(ref, item);
      if (outcome === "new-url") {
        if (opts.logger?.warning) opts.logger.warning(message);
        else console.warn(message);
      } else {
        opts.logger?.fileOnly?.(message);
      }
    }
  }
  return found;
}
