import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

interface AssetMapping {
  sourceGuid: string;
  targetGuid: string;
  sourceDateModified: string;
  targetDateModified: string;
  sourceMediaID: number;
  targetMediaID: number;
  sourceUrl?: string;
  targetUrl?: string;
  sourceContainerEdgeUrl?: string;
  targetContainerEdgeUrl?: string;
  sourceContainerOriginUrl?: string;
  targetContainerOriginUrl?: string;
}

export class AssetMapper {
  private fileOps: fileOperations;
  private sourceGuid: string;
  private targetGuid: string;
  private mappings: AssetMapping[];
  private directory: string;

  constructor(sourceGuid: string, targetGuid: string) {
    this.sourceGuid = sourceGuid;
    this.targetGuid = targetGuid;
    this.directory = "assets";

    // this will provide access to the /agility-files/{GUID} folder
    this.fileOps = new fileOperations(targetGuid);
    this.mappings = this.loadMapping();
  }

  getAssetMapping(asset: mgmtApi.Media, type: "source" | "target"): AssetMapping | null {
    const mapping = this.mappings.find((m: AssetMapping) =>
      type === "source" ? m.sourceMediaID === asset.mediaID : m.targetMediaID === asset.mediaID
    );
    if (!mapping) return null;
    return mapping;
  }

  getAssetMappingByMediaID(mediaID: number, type: "source" | "target"): AssetMapping | null {
    const mapping = this.mappings.find((m: AssetMapping) =>
      type === "source" ? m.sourceMediaID === mediaID : m.targetMediaID === mediaID
    );
    if (!mapping) return null;
    return mapping;
  }

  getAssetMappingByMediaUrl(url: string, type: "source" | "target"): AssetMapping | null {
    // Try exact match first
    const exact = this.mappings.find((m: AssetMapping) =>
      type === "source" ? m.sourceUrl === url : m.targetUrl === url
    );
    if (exact) return exact;

    // Fallback: match by container prefix (handles subfolder paths like /mobile/feature-carousel/)
    return this.findMappingByContainerPrefix(url, type);
  }

  /**
   * Remap a URL from source container to target container, preserving any subfolder path.
   * e.g. "cdn-usa2.aglty.io/brightstar-tns-cat/mobile/feature-carousel/file.png"
   *    → "cdn-usa2.aglty.io/2151a7f2/mobile/feature-carousel/file.png"
   *
   * Returns null if the URL doesn't match any mapping's container prefix.
   */
  remapUrlByContainer(url: string, type: "source" | "target"): string | null {
    const mapping = this.findMappingByContainerPrefix(url, type);
    if (!mapping) return null;

    // Determine which container URLs to use based on whether this is an edge or origin URL
    const sourceEdge = type === "source" ? mapping.sourceContainerEdgeUrl : mapping.targetContainerEdgeUrl;
    const targetEdge = type === "source" ? mapping.targetContainerEdgeUrl : mapping.sourceContainerEdgeUrl;
    const sourceOrigin = type === "source" ? mapping.sourceContainerOriginUrl : mapping.targetContainerOriginUrl;
    const targetOrigin = type === "source" ? mapping.targetContainerOriginUrl : mapping.sourceContainerOriginUrl;

    // Try edge URL swap first, then origin URL swap
    if (sourceEdge && targetEdge && url.startsWith(sourceEdge)) {
      return url.replace(sourceEdge, targetEdge);
    }
    if (sourceOrigin && targetOrigin && url.startsWith(sourceOrigin)) {
      return url.replace(sourceOrigin, targetOrigin);
    }

    return null;
  }

  private findMappingByContainerPrefix(url: string, type: "source" | "target"): AssetMapping | null {
    return (
      this.mappings.find((m: AssetMapping) => {
        const edgeUrl = type === "source" ? m.sourceContainerEdgeUrl : m.targetContainerEdgeUrl;
        const originUrl = type === "source" ? m.sourceContainerOriginUrl : m.targetContainerOriginUrl;
        return (edgeUrl && url.startsWith(edgeUrl + "/")) || (originUrl && url.startsWith(originUrl + "/"));
      }) || null
    );
  }

  /**
   * Returns true if the given URL starts with any container edge/origin URL
   * known to the mapper (source or target). Lets callers identify asset URLs
   * without hardcoding CDN domains — supports custom CDN hosts.
   *
   * Falls back to the URL origin (protocol + host) of the per-asset
   * sourceUrl/targetUrl for legacy mapping files written before container URLs
   * were tracked, so custom-CDN assets are still recognized without a re-map.
   */
  isKnownAssetUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;

    return this.mappings.some((mapping) => {
      const knownContainerUrls = [
        mapping.sourceContainerEdgeUrl,
        mapping.sourceContainerOriginUrl,
        mapping.targetContainerEdgeUrl,
        mapping.targetContainerOriginUrl,
      ].filter((containerUrl): containerUrl is string => typeof containerUrl === "string");

      if (knownContainerUrls.length > 0) {
        // New-format mapping: match strictly on the container prefix so assets
        // from a different account on the same CDN host are not falsely matched.
        return knownContainerUrls.some((containerUrl) => url.startsWith(containerUrl));
      }

      // Legacy fallback: this mapping predates container-URL tracking and only
      // stored the full asset URLs (sourceUrl/targetUrl). Match on the URL
      // origin so any asset on the same CDN host is recognized without a re-map.
      const legacyOrigins = [mapping.sourceUrl, mapping.targetUrl]
        .map((assetUrl) => this.getUrlOrigin(assetUrl))
        .filter((origin): origin is string => origin !== null);

      return legacyOrigins.some((origin) => url.startsWith(origin));
    });
  }

  /**
   * Extract the origin (protocol + host) from a URL, or null if it can't be parsed.
   */
  private getUrlOrigin(url: string | undefined): string | null {
    if (!url || typeof url !== "string") return null;
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  getMappedEntity(mapping: AssetMapping, type: "source" | "target"): mgmtApi.Media | null {
    const guid = type === "source" ? mapping.sourceGuid : mapping.targetGuid;
    const mediaID = type === "source" ? mapping.sourceMediaID : mapping.targetMediaID;
    const fileOps = new fileOperations(guid);
    const mediaFilePath = fileOps.getDataFilePath(`assets/${mediaID}.json`);
    const mediaData = fileOps.readJsonFile(mediaFilePath);
    if (!mediaData) return null;
    return mediaData as mgmtApi.Media;
  }

  addMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media) {
    const targetMapping = this.getAssetMapping(targetAsset, "target");
    const sourceMapping = this.getAssetMapping(sourceAsset, "source");

    if (targetMapping && sourceMapping && targetMapping !== sourceMapping) {
      throw new Error(
        `Invalid Mappings detected! Source mediaID: ${sourceAsset.mediaID}, Target mediaID: ${targetAsset.mediaID}`
      );
    }

    if (targetMapping) {
      this.updateMapping(sourceAsset, targetAsset, targetMapping);
    } else if (sourceMapping) {
      // PROD-2627: the source asset already has a record but it points at a different target asset
      // (the old one was deleted, or a copy was uploaded). A source asset maps to exactly one target,
      // so repoint the existing record rather than appending a second one — with two records the
      // source and target lookups return different records and addMapping throws "Invalid Mappings".
      this.writeMapping(sourceAsset, targetAsset, sourceMapping);
    } else {
      const newMapping: AssetMapping = {
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourceDateModified: sourceAsset.dateModified,
        targetDateModified: targetAsset.dateModified,
        sourceMediaID: sourceAsset.mediaID,
        targetMediaID: targetAsset.mediaID,
        sourceUrl: sourceAsset.edgeUrl,
        targetUrl: targetAsset.edgeUrl,
        sourceContainerEdgeUrl: sourceAsset.containerEdgeUrl,
        targetContainerEdgeUrl: targetAsset.containerEdgeUrl,
        sourceContainerOriginUrl: sourceAsset.containerOriginUrl,
        targetContainerOriginUrl: targetAsset.containerOriginUrl,
      };

      this.mappings.push(newMapping);
    }

    this.saveMapping();
  }

  updateMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media, mapping: AssetMapping) {
    if (targetAsset.mediaID !== mapping.targetMediaID) {
      throw new Error(
        `Invalid items trying to be mapped! Source mediaID: ${sourceAsset.mediaID}, Target mediaID: ${targetAsset.mediaID}`
      );
    }
    this.writeMapping(sourceAsset, targetAsset, mapping);
  }

  private writeMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media, mapping: AssetMapping) {
    mapping.sourceGuid = this.sourceGuid;
    mapping.targetGuid = this.targetGuid;
    mapping.sourceDateModified = sourceAsset.dateModified;
    mapping.targetDateModified = targetAsset.dateModified;
    mapping.sourceMediaID = sourceAsset.mediaID;
    mapping.targetMediaID = targetAsset.mediaID;
    mapping.sourceUrl = sourceAsset.edgeUrl;
    mapping.targetUrl = targetAsset.edgeUrl;
    mapping.sourceContainerEdgeUrl = sourceAsset.containerEdgeUrl;
    mapping.targetContainerEdgeUrl = targetAsset.containerEdgeUrl;
    mapping.sourceContainerOriginUrl = sourceAsset.containerOriginUrl;
    mapping.targetContainerOriginUrl = targetAsset.containerOriginUrl;
    this.saveMapping();
  }

  /**
   * PROD-2627: point an existing record at a different (live) target asset without touching its
   * source side. Used when the mapped target asset is gone but an asset at the same path exists on
   * the target: the recorded source date is kept so a pending source change is still pushed.
   */
  relinkTarget(mapping: AssetMapping, targetAsset: mgmtApi.Media) {
    const other = this.getAssetMapping(targetAsset, "target");
    if (other && other !== mapping) {
      throw new Error(
        `Invalid Mappings detected! Target mediaID ${targetAsset.mediaID} is already mapped to source mediaID ${other.sourceMediaID}`
      );
    }
    mapping.targetMediaID = targetAsset.mediaID;
    mapping.targetDateModified = targetAsset.dateModified;
    mapping.targetUrl = targetAsset.edgeUrl;
    mapping.targetContainerEdgeUrl = targetAsset.containerEdgeUrl;
    mapping.targetContainerOriginUrl = targetAsset.containerOriginUrl;
    this.saveMapping();
  }

  /**
   * PROD-2627: collapse duplicate records left by earlier runs (one source asset mapped to several
   * target assets, or several sources to one target). Earlier versions appended a record instead of
   * repointing, so the source and target lookups could return different records.
   *
   * For each group of records sharing a source (or target) mediaID, keep the one whose other side
   * is live in the pulled data and sits at the same path, dropping the rest. A group is only
   * resolved when the pulled data can tell the records apart; otherwise it is left alone.
   * Returns the number of records removed.
   */
  resolveDuplicateRecords(sourceAssets: mgmtApi.Media[], targetAssets: mgmtApi.Media[]): number {
    const sourceByID = new Map(sourceAssets.map((a) => [a.mediaID, a]));
    const targetByID = new Map(targetAssets.map((a) => [a.mediaID, a]));
    const removed = new Set<AssetMapping>();

    const collapse = (side: "source" | "target") => {
      const groups = new Map<number, AssetMapping[]>();
      for (const m of this.mappings) {
        if (removed.has(m)) continue;
        const key = side === "source" ? m.sourceMediaID : m.targetMediaID;
        const group = groups.get(key);
        if (group) group.push(m);
        else groups.set(key, [m]);
      }

      for (const group of Array.from(groups.values())) {
        if (group.length < 2) continue;
        const score = (m: AssetMapping) => {
          const source = sourceByID.get(m.sourceMediaID);
          const target = targetByID.get(m.targetMediaID);
          // the side that differs between the records in this group
          const otherLive = side === "source" ? !!target : !!source;
          const samePath = !!source && !!target && !!source.originKey && source.originKey === target.originKey;
          return (otherLive ? 2 : 0) + (samePath ? 1 : 0);
        };
        const scores = group.map(score);
        const best = Math.max(...scores);
        const winners = group.filter((_, i) => scores[i] === best);
        // can't tell them apart from the pulled data -> leave the group for a person to resolve
        if (best === 0 || winners.length !== 1) continue;
        for (const m of group) if (m !== winners[0]) removed.add(m);
      }
    };

    collapse("source");
    collapse("target");

    if (removed.size > 0) {
      this.mappings = this.mappings.filter((m) => !removed.has(m));
      this.saveMapping();
    }
    return removed.size;
  }

  loadMapping() {
    const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
    return mapping;
  }

  saveMapping() {
    this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
  }

  hasSourceChanged(sourceAsset: mgmtApi.Media | null | undefined) {
    if (!sourceAsset) return false;
    const mapping = this.getAssetMapping(sourceAsset, "source");
    if (!mapping) return false;

    const sourceDate = new Date(sourceAsset.dateModified);
    const mappingDate = new Date(mapping.sourceDateModified);
    return sourceDate > mappingDate;
  }

  hasTargetChanged(targetAsset?: mgmtApi.Media | null | undefined) {
    if (!targetAsset) return false;
    const mapping = this.getAssetMapping(targetAsset, "target");
    if (!mapping) return false;

    const targetDate = new Date(targetAsset.dateModified);
    const mappingDate = new Date(mapping.targetDateModified);

    return targetDate > mappingDate;
  }
}
