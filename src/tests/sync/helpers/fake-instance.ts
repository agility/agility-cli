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

export type EntityKind = "model" | "container" | "gallery" | "template" | "content" | "page" | "asset";

const DEFAULT_STARTING_IDS: Record<EntityKind, number> = {
  model: 7001,
  container: 8001,
  content: 9001,
  gallery: 6001,
  template: 5001,
  page: 4001,
  asset: 3001,
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
    writeEach(path.join(base, "assets", "json"), store.assets, (_a, i) => String(i));

    store.content.forEach((item, key) => {
      const locale = key.split(":")[0];
      writeJsonFile(path.join(base, locale, "item", `${item.contentID}.json`), item);
    });
    store.pages.forEach((page, key) => {
      const locale = key.split(":")[0];
      writeJsonFile(path.join(base, locale, "page", `${page.pageID}.json`), page);
    });
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
      // Real API returns batch IDs; the polling layer is stubbed, so any stable number works.
      return ids;
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
    getGalleryByName: async (name: string, guid: string) => {
      this.record("assetMethods.getGalleryByName", guid, { name });
      return Array.from(this.instance(guid).galleries.values()).find((g: any) => g.name === name) ?? null;
    },
    getDefaultContainer: async (guid: string) => {
      this.record("assetMethods.getDefaultContainer", guid);
      return { edgeUrl: "https://cdn.test.invalid", originKey: "test" };
    },
    saveGallery: async (gallery: any, guid: string) => {
      this.record("assetMethods.saveGallery", guid, gallery);
      const store = this.instance(guid);
      const incoming = gallery?.mediaGroupingID;
      const id = incoming && incoming > 0 ? incoming : this.allocate("gallery");
      const saved = { ...gallery, mediaGroupingID: id };
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
    savePageTemplate: async (template: any, guid: string, locale: string) => {
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
      return id;
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
