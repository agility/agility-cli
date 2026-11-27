/**
 * PROD-3449: the source assets whose upload failed in this run.
 *
 * When an asset upload fails (e.g. a 503), the asset gets no mapping. A content item that uses it
 * was still pushed: the field mapper's container-prefix fallback rewrites the URL to the target
 * container, where no such asset exists, and the target saved the item without the image. The
 * item's mapping then recorded its source version, so later runs skipped it and never repaired it.
 *
 * The asset pusher records each failed upload here; the content batch processor fails any item that
 * references one, so it gets no new mapping version and the next run pushes it again.
 *
 * Only assets that failed in THIS run are recorded. An item that points at an asset deleted from
 * the source behaves as before. A process-level singleton, reset at the start of each push.
 */
import type * as mgmtApi from "@agility/management-sdk";

export interface FailedAsset {
  mediaID: number;
  fileName: string;
  error: string;
}

export interface FailedAssetReference {
  /** Dotted field path inside the content item's fields, e.g. "bannerImage.url". */
  path: string;
  asset: FailedAsset;
}

class FailedAssets {
  private byUrl = new Map<string, FailedAsset>();

  reset(): void {
    this.byUrl.clear();
  }

  get size(): number {
    return this.byUrl.size;
  }

  /** Record a source asset whose upload failed, under every URL content may use for it. */
  record(media: Pick<mgmtApi.Media, "mediaID" | "fileName" | "edgeUrl" | "originUrl">, error: string): void {
    const entry: FailedAsset = { mediaID: media.mediaID, fileName: media.fileName, error };
    for (const url of [media.edgeUrl, media.originUrl]) {
      const key = normalize(url);
      if (key) this.byUrl.set(key, entry);
    }
  }

  /** The failed asset a URL points at, if any. */
  find(url: string): FailedAsset | undefined {
    const key = normalize(url);
    return key ? this.byUrl.get(key) : undefined;
  }

  /**
   * Every place in a content item's fields that uses a failed asset: an attachment's `url`, a
   * field whose value is the asset URL, or a string (e.g. rich text) that contains it.
   */
  findReferences(fields: any): FailedAssetReference[] {
    if (this.byUrl.size === 0 || !fields || typeof fields !== "object") return [];
    const refs: FailedAssetReference[] = [];
    const seen = new Set<string>();

    const visit = (value: any, path: string) => {
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        this.byUrl.forEach((asset, url) => {
          if (lower.includes(url)) {
            const key = `${path}\u0000${asset.mediaID}`;
            if (!seen.has(key)) {
              seen.add(key);
              refs.push({ path, asset });
            }
          }
        });
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${path}[${i}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      }
    };

    visit(fields, "");
    return refs;
  }
}

function normalize(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export const failedAssets = new FailedAssets();
