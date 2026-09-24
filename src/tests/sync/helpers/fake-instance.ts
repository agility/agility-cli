import * as fs from "fs";
import * as path from "path";
import * as mgmtApi from "@agility/management-sdk";

/**
 * A stateful in-memory stand-in for one or more Agility instances.
 *
 * `MockApiClient` is a call *recorder*: it captures writes and invents IDs, but it cannot
 * serve run 2 what run 1 wrote. That is fine for asserting "this pusher sent that payload",
 * and useless for the question this harness exists to answer — **sync twice with no source
 * change, and prove the second run does nothing.**
 *
 * Ordering between phases, conflict detection, version comparison and ID remapping are all
 * properties that only become observable on a second run, so a recorder cannot reach them.
 *
 * So reads here are served from the same store the writes populate, keyed by guid.
 *
 * ## The part that is easy to get wrong
 *
 * The orchestrator does NOT read the target through the API client. It reads both sides off
 * disk, from the `agility-files` tree a pull produced (`GuidDataLoader` → `fileOperations`).
 * The API client is write-mostly.
 *
 * So holding writes in memory is only half a re-sync. Between runs you must also project this
 * store back onto the target's on-disk tree — that projection *is* the re-pull a real sync
 * performs at the start of every run. Skip it and run 2 sees an empty target with mappings
 * pointing into it, which is the stale-mapping path, not the idempotency path. See
 * `projectToDisk`.
 */

export interface FakeInstanceOptions {
  /** First ID handed out for each entity type. Distinct ranges make failures readable. */
  startingIds?: Partial<Record<EntityKind, number>>;
  /** Locales the instance reports. Defaults to ["en-us"]. */
  locales?: string[];
}

export type EntityKind =
  | "model"
  | "container"
  | "gallery"
  | "template"
  | "content"
  | "page"
  | "asset"
  | "urlRedirection";

const DEFAULT_STARTING_IDS: Record<EntityKind, number> = {
  model: 7001,
  container: 8001,
  content: 9001,
  gallery: 6001,
  template: 5001,
  page: 4001,
  asset: 3001,
  urlRedirection: 2001,
};

/** One instance's contents. Locale-scoped kinds are keyed `${locale}:${id}`. */
interface InstanceStore {
  models: Map<number, any>;
  containers: Map<number, any>;
  galleries: Map<number, any>;
  templates: Map<number, any>;
  assets: any[];
  content: Map<string, any>;
  pages: Map<string, any>;
  urlRedirections: Map<number, any>;
  sitemap: any[];
  locales: string[];
}

function emptyStore(locales: string[]): InstanceStore {
  return {
    models: new Map(),
    containers: new Map(),
    galleries: new Map(),
    templates: new Map(),
    assets: [],
    content: new Map(),
    pages: new Map(),
    urlRedirections: new Map(),
    sitemap: [],
    locales,
  };
}

/** One recorded API call, in order. The ordered log is what the golden-file tier diffs. */
export interface RecordedCall {
  method: string;
  guid?: string;
  locale?: string;
  payload?: any;
}

export class FakeInstance {
  /** Every API call in order, for assertions and (later) golden files. */
  readonly calls: RecordedCall[] = [];

  private readonly stores = new Map<string, InstanceStore>();
  private readonly nextId: Record<EntityKind, number>;
  private readonly locales: string[];

  constructor(opts: FakeInstanceOptions = {}) {
    this.locales = opts.locales ?? ["en-us"];
    this.nextId = { ...DEFAULT_STARTING_IDS, ...(opts.startingIds ?? {}) } as Record<EntityKind, number>;
  }

  // ─── store access ──────────────────────────────────────────────────────────

  /** Get (creating if needed) the store for a guid. */
  instance(guid: string): InstanceStore {
    let store = this.stores.get(guid);
    if (!store) {
      store = emptyStore([...this.locales]);
      this.stores.set(guid, store);
    }
    return store;
  }

  private allocate(kind: EntityKind): number {
    return this.nextId[kind]++;
  }

  private record(method: string, guid?: string, payload?: any, locale?: string): void {
    this.calls.push({ method, guid, locale, payload });
  }

  /** Calls for one method, in order. */
  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Drop the call log, keeping stored state. Use between runs to assert on run 2 alone. */
  resetCalls(): void {
    this.calls.length = 0;
  }

  // ─── seeding ───────────────────────────────────────────────────────────────

  /** Put an entity into an instance without going through a write method. */
  seedModel(guid: string, model: any): any {
    this.instance(guid).models.set(model.id, model);
    return model;
  }

  seedContainer(guid: string, container: any): any {
    this.instance(guid).containers.set(container.contentViewID, container);
    return container;
  }

  seedContent(guid: string, locale: string, item: any): any {
    this.instance(guid).content.set(`${locale}:${item.contentID}`, item);
    return item;
  }

  // ─── the projection that makes run 2 meaningful ────────────────────────────

  /**
   * Write an instance's contents to the `agility-files` layout the loaders read, standing in
   * for the pull a real sync performs before every push.
   *
   * Layout (mirrors `fileOperations` + the filesystem getters):
   *   <rootPath>/<guid>/models/<id>.json
   *   <rootPath>/<guid>/containers/<contentViewID>.json
   *   <rootPath>/<guid>/galleries/<mediaGroupingID>.json
   *   <rootPath>/<guid>/templates/<pageTemplateID>.json
   *   <rootPath>/<guid>/assets/json/<n>.json
   *   <rootPath>/<guid>/<locale>/item/<contentID>.json
   *   <rootPath>/<guid>/<locale>/page/<pageID>.json
   */
  projectToDisk(rootPath: string, guid: string): void {
    const store = this.instance(guid);
    const base = path.join(rootPath, guid);

    writeEach(path.join(base, "models"), Array.from(store.models.values()), (m) => String(m.id));
    writeEach(path.join(base, "containers"), Array.from(store.containers.values()), (c) =>
      String(c.contentViewID)
    );
    writeEach(path.join(base, "galleries"), Array.from(store.galleries.values()), (g) =>
      String(g.mediaGroupingID)
    );
    writeEach(path.join(base, "templates"), Array.from(store.templates.values()), (t) =>
      String(t.pageTemplateID)
    );
    // Assets are NOT one file per asset: the getter unwraps an `assetMedias` array out of each
    // file, so a bare media object per file reads back as zero assets and run 2 recreates
    // everything while looking like a clean fresh sync.
    if (store.assets.length > 0) {
      writeJsonFile(path.join(base, "assets", "json", "0.json"), { assetMedias: store.assets });
    }

    store.content.forEach((item, key) => {
      const locale = key.split(":")[0];
      writeJsonFile(path.join(base, locale, "item", `${item.contentID}.json`), item);
    });
    store.pages.forEach((page, key) => {
      const locale = key.split(":")[0];
      writeJsonFile(path.join(base, locale, "page", `${page.pageID}.json`), page);
    });

    // Redirections live under the LOCALE, not the guid root. The set is instance-wide, so the
    // same file is written for every locale the instance reports — which is what a pull does.
    if (store.urlRedirections.size > 0) {
      const items = Array.from(store.urlRedirections.values()).map((r) => ({
        ...r,
        id: r.urlRedirectionID,
      }));
      store.locales.forEach((locale) => {
        writeJsonFile(path.join(base, locale, "urlredirections", "urlredirections.json"), {
          items,
          lastAccessDate: nextTimestamp(),
        });
      });
    }
  }

  // ─── the mgmtApi.ApiClient surface ─────────────────────────────────────────

  modelMethods = {
    saveModel: async (model: any, guid: string) => {
      this.record("modelMethods.saveModel", guid, model);
      const store = this.instance(guid);
      // Model creation is two-pass: a shell with `fields: []` to get an ID, then the same
      // model again with its fields. Both arrive here; the second must update, not duplicate.
      const id = model?.id && model.id > 0 ? model.id : this.allocate("model");
      const saved = { ...model, id, lastModifiedDate: nextTimestamp() };
      store.models.set(id, saved);
      return saved;
    },
    getContentModel: async (id: number, guid: string) => {
      this.record("modelMethods.getContentModel", guid, { id });
      return this.instance(guid).models.get(id) ?? null;
    },
    getContentModules: async (includeDefaults: boolean, guid: string) => {
      this.record("modelMethods.getContentModules", guid, { includeDefaults });
      return Array.from(this.instance(guid).models.values());
    },
    getPageModules: async (includeDefaults: boolean, guid: string) => {
      this.record("modelMethods.getPageModules", guid, { includeDefaults });
      return [];
    },
  };

  containerMethods = {
    saveContainer: async (container: any, guid: string) => {
      this.record("containerMethods.saveContainer", guid, container);
      const store = this.instance(guid);
      const incoming = container?.contentViewID;
      const id = incoming && incoming > 0 ? incoming : this.allocate("container");
      const saved = { ...container, contentViewID: id, lastModifiedDate: nextLegacyTimestamp() };
      store.containers.set(id, saved);
      return saved;
    },
    getContainerList: async (guid: string) => {
      this.record("containerMethods.getContainerList", guid);
      return Array.from(this.instance(guid).containers.values());
    },
    getContainerByID: async (id: number, guid: string) => {
      this.record("containerMethods.getContainerByID", guid, { id });
      return this.instance(guid).containers.get(id) ?? null;
    },
  };

  /**
   * The IDs assigned by the most recent `saveContentItems`, in payload order.
   *
   * Content does not come back from the save call — the real API returns a batch ID and the
   * results are read later via `extractContentBatchResults`. `buildContentBatchResults`
   * replays these so the batch layer can hand the pusher the same IDs this store holds.
   */
  private lastContentSaveIds: number[] = [];

  /** Same idea as `lastContentSaveIds`, for pages — they batch one page at a time. */
  private lastPageSaveIds: number[] = [];

  contentMethods = {
    saveContentItems: async (items: any[], guid: string, locale: string) => {
      this.record("contentMethods.saveContentItems", guid, items, locale);
      const store = this.instance(guid);
      const ids = items.map((item) => {
        const incoming = item?.contentID;
        const id = incoming && incoming > 0 ? incoming : this.allocate("content");
        store.content.set(`${locale}:${id}`, { ...item, contentID: id });
        return id;
      });
      this.lastContentSaveIds = ids;
      // Real API returns batch IDs; the polling layer is stubbed, so any stable number works.
      return [1000 + this.callsTo("contentMethods.saveContentItems").length];
    },
    saveContentItem: async (item: any, guid: string, locale: string) => {
      this.record("contentMethods.saveContentItem", guid, item, locale);
      const id = item?.contentID && item.contentID > 0 ? item.contentID : this.allocate("content");
      this.instance(guid).content.set(`${locale}:${id}`, { ...item, contentID: id });
      return id;
    },
    getContentItem: async (id: number, guid: string, locale: string) => {
      this.record("contentMethods.getContentItem", guid, { id }, locale);
      return this.instance(guid).content.get(`${locale}:${id}`) ?? null;
    },
    publishContent: async (id: number, guid: string, locale: string) => {
      this.record("contentMethods.publishContent", guid, { id }, locale);
      return [id];
    },
    batchWorkflowContent: async (ids: number[], guid: string, locale: string) => {
      this.record("contentMethods.batchWorkflowContent", guid, { ids }, locale);
      return ids;
    },
  };

  assetMethods = {
    getMediaList: async (pageSize: number, recordOffset: number, guid: string) => {
      this.record("assetMethods.getMediaList", guid, { pageSize, recordOffset });
      // One page only: returning the full list on every call would loop forever if the
      // caller pages until it sees fewer than pageSize results.
      return { assetMedias: recordOffset > 0 ? [] : this.instance(guid).assets };
    },
    getGalleries: async (guid: string) => {
      this.record("assetMethods.getGalleries", guid);
      return { assetMediaGroupings: Array.from(this.instance(guid).galleries.values()) };
    },
    // (guid, name) — note the order, see the note on saveGallery below.
    getGalleryByName: async (guid: string, name: string) => {
      this.record("assetMethods.getGalleryByName", guid, { name });
      return Array.from(this.instance(guid).galleries.values()).find((g: any) => g.name === name) ?? null;
    },
    getDefaultContainer: async (guid: string) => {
      this.record("assetMethods.getDefaultContainer", guid);
      return { edgeUrl: "https://cdn.test.invalid", originKey: "test" };
    },
    /**
     * ⚠️ `(guid, payload)` — the reverse of `saveModel(payload, guid)` and
     * `saveContainer(payload, guid, …)`. The SDK is not consistent about this, and getting it
     * backwards here does not fail loudly: the fake stores the guid *string* as the entity,
     * and the error only surfaces on the next run when something reads a field off it.
     * Argument order for every method on this fake is taken from its real call site.
     */
    saveGallery: async (guid: string, gallery: any) => {
      this.record("assetMethods.saveGallery", guid, gallery);
      const store = this.instance(guid);
      const incoming = gallery?.mediaGroupingID;
      const id = incoming && incoming > 0 ? incoming : this.allocate("gallery");
      // `modifiedOn` is not decoration: change detection runs it through date-fns `parse`,
      // which calls .match() on the value. A gallery without one fails the next sync with
      // "Cannot read properties of null (reading 'match')", which names neither the gallery
      // nor the field.
      const saved = { ...gallery, mediaGroupingID: id, modifiedOn: nextLegacyTimestamp() };
      store.galleries.set(id, saved);
      return saved;
    },
    deleteFile: async (mediaID: number, guid: string) => {
      this.record("assetMethods.deleteFile", guid, { mediaID });
      return true;
    },
    deleteFolder: async (originKey: string, guid: string) => {
      this.record("assetMethods.deleteFolder", guid, { originKey });
      return true;
    },
  };

  pageMethods = {
    getSitemap: async (guid: string, locale: string) => {
      this.record("pageMethods.getSitemap", guid, undefined, locale);
      return this.instance(guid).sitemap;
    },
    getPage: async (id: number, guid: string, locale: string) => {
      this.record("pageMethods.getPage", guid, { id }, locale);
      return this.instance(guid).pages.get(`${locale}:${id}`) ?? null;
    },
    getPageTemplates: async (guid: string, locale: string, includeModuleZones: boolean) => {
      this.record("pageMethods.getPageTemplates", guid, { includeModuleZones }, locale);
      return Array.from(this.instance(guid).templates.values());
    },
    // (guid, locale, payload) — again the reverse of savePage(payload, guid, locale, …).
    savePageTemplate: async (guid: string, locale: string, template: any) => {
      this.record("pageMethods.savePageTemplate", guid, template, locale);
      const store = this.instance(guid);
      const incoming = template?.pageTemplateID;
      const id = incoming && incoming > 0 ? incoming : this.allocate("template");
      const saved = { ...template, pageTemplateID: id };
      store.templates.set(id, saved);
      return saved;
    },
    savePage: async (page: any, guid: string, locale: string) => {
      this.record("pageMethods.savePage", guid, page, locale);
      const incoming = page?.pageID;
      const id = incoming && incoming > 0 ? incoming : this.allocate("page");
      this.instance(guid).pages.set(`${locale}:${id}`, { ...page, pageID: id });
      this.lastPageSaveIds = [id];
      // The pusher calls savePage with returnBatchID=true and requires an ARRAY back; a bare
      // id falls through to "Unexpected response format" and the page is reported as failed.
      return [2000 + this.callsTo("pageMethods.savePage").length];
    },
    publishPage: async (id: number, guid: string, locale: string) => {
      this.record("pageMethods.publishPage", guid, { id }, locale);
      return [id];
    },
    batchWorkflowPages: async (ids: number[], guid: string, locale: string) => {
      this.record("pageMethods.batchWorkflowPages", guid, { ids }, locale);
      return ids;
    },
  };

  instanceMethods = {
    getLocales: async (guid: string) => {
      this.record("instanceMethods.getLocales", guid);
      return this.instance(guid).locales;
    },
    getFetchApiStatus: async (guid: string) => {
      this.record("instanceMethods.getFetchApiStatus", guid);
      return { isEnabled: true, enabled: true };
    },
  };

  batchMethods = {
    getBatch: async (batchID: number, guid: string) => {
      this.record("batchMethods.getBatch", guid, { batchID });
      return { batchID, batchState: 3, items: [] };
    },
    publishBatch: async (batchID: number, guid: string) => {
      this.record("batchMethods.publishBatch", guid, { batchID });
      return batchID;
    },
    publish: async (batchID: number, guid: string) => {
      this.record("batchMethods.publish", guid, { batchID });
      return batchID;
    },
  };

  /**
   * Replay the last content save as the batch layer would report it.
   *
   * Content is written through a batch: the save call returns a batch ID, and the pusher
   * learns the new IDs only by polling and then calling `extractContentBatchResults`. The
   * harness stubs that layer, so this supplies its output from what the store actually
   * assigned — keeping the IDs in the mapping files identical to the IDs in the fake.
   *
   * Shape matches `BatchSuccessItem` in `lib/pushers/batch-polling` — `originalItem`, not
   * `originalContent`; the processor renames it downstream.
   */
  buildContentBatchResults(includedItems: any[]): {
    successfulItems: Array<{ originalItem: any; newId: number; newItem: any; index: number }>;
    failedItems: any[];
  } {
    return {
      successfulItems: includedItems.map((item, index) => {
        const newId = this.lastContentSaveIds[index];
        return {
          originalItem: item,
          newId,
          newItem: { itemID: newId, processedItemVersionID: 100 + index },
          index,
        };
      }),
      failedItems: [],
    };
  }

  /**
   * Record a call that bypassed the API client — asset upload via axios, redirections via
   * global fetch. Kept in the same ordered log so a golden file sees the whole conversation,
   * not just the part that happened to go through the SDK.
   */
  recordExternal(method: string, url: string): void {
    this.calls.push({ method, payload: { url } });
  }

  /**
   * Response body the asset pusher expects back from its direct multipart upload, and the
   * point at which the uploaded asset enters the store.
   *
   * The upload bypasses the API client entirely, so nothing else would record it — and an
   * asset missing from the store is an asset missing from `projectToDisk`, which makes run 2
   * upload it again while reporting a clean create.
   *
   * `originKey` is what the pusher matches on to decide an asset already exists on the target,
   * so it must be derived from the request rather than invented, or the match never hits.
   */
  buildAssetUploadResponse(guid: string, folderPath: string, fileName: string): any[] {
    const mediaID = this.allocate("asset");
    const originKey = folderPath ? `${folderPath}/${fileName}` : fileName;
    const media = {
      mediaID,
      fileName,
      originKey,
      size: 1,
      isFolder: false,
      edgeUrl: `https://cdn.test.invalid/${originKey}`,
      originUrl: `https://cdn.test.invalid/${originKey}`,
    };
    this.instance(guid).assets.push(media);
    return [media];
  }

  /**
   * Stand-in for `lib/pushers/url-redirection-api.saveUrlRedirections`.
   *
   * Returns the `{ created, updated, skipped }` shape the pusher reads. `index` is the
   * position within *this* request's payload — the pusher uses it to look the source item
   * back up, so getting it wrong silently maps the wrong redirection.
   *
   * An incoming `urlRedirectionID` means the caller is updating an existing redirection;
   * without one it is a create.
   */
  async saveUrlRedirections(guid: string, redirections: any[]): Promise<any> {
    this.record("urlRedirectionApi.saveUrlRedirections", guid, redirections);
    const store = this.instance(guid);
    const created: any[] = [];
    const updated: any[] = [];

    redirections.forEach((payload, index) => {
      const existingId = payload?.urlRedirectionID;
      const id = existingId && existingId > 0 ? existingId : this.allocate("urlRedirection");
      store.urlRedirections.set(id, { ...payload, urlRedirectionID: id });
      const result = { index, urlRedirectionID: id, originUrl: payload?.originUrl };
      (existingId && existingId > 0 ? updated : created).push(result);
    });

    return { created, updated, skipped: [] };
  }

  /** As `buildContentBatchResults`, for the page batch. */
  buildPageBatchResults(includedItems: any[]): {
    successfulItems: Array<{ originalItem: any; newId: number; newItem: any; index: number }>;
    failedItems: any[];
  } {
    return {
      successfulItems: includedItems.map((item, index) => {
        const newId = this.lastPageSaveIds[index];
        return {
          originalItem: item,
          newId,
          newItem: { itemID: newId, processedItemVersionID: 200 + index },
          index,
        };
      }),
      failedItems: [],
    };
  }

  /**
   * Hand this to `state.cachedApiClient`. The cast is the point of the seam: `getApiClient()`
   * returns whatever is cached, so assigning this one field redirects every downloader,
   * pusher, publisher and mapping updater at once.
   */
  asApiClient(): mgmtApi.ApiClient {
    return this as unknown as mgmtApi.ApiClient;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function writeJsonFile(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function writeEach<T>(dir: string, items: T[], name: (item: T, index: number) => string): void {
  items.forEach((item, i) => writeJsonFile(path.join(dir, `${name(item, i)}.json`), item));
}

/**
 * Monotonic ISO timestamps for writes.
 *
 * Change detection compares a mapping's recorded `targetLastModifiedDate` against what the
 * target currently reports. A fixed timestamp would make every write look unchanged and hide
 * real update bugs; `new Date()` makes two runs in the same millisecond indistinguishable on
 * a fast machine. A counter is deterministic and strictly increasing, which is what the
 * comparison actually needs.
 */
let tick = 0;
function nextTimestamp(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick * 1000).toISOString().replace("Z", "");
}

/** Containers report the legacy `MM/DD/YYYY hh:mmAM` shape rather than ISO. */
function nextLegacyTimestamp(): string {
  tick += 1;
  const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick * 1000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()} 12:00AM`;
}
