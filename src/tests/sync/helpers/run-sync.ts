import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { state, resetState, setState } from "core/state";
import { Pushers, PushResults } from "lib/pushers/orchestrate-pushers";
import type { JsonSummaryPhase } from "core/json-summary";

import { FakeInstance } from "./fake-instance";

/**
 * Driver for hermetic end-to-end sync runs.
 *
 * Runs the **real** `Pushers.instanceOrchestrator()` — all eight phases in their real order,
 * real change detection, real mapping writes — against a temp `agility-files` tree and a
 * `FakeInstance`. Nothing is stubbed inside the pipeline; only its edges.
 *
 * The thing this exists for is `resync()`. Sync twice with no source change and the second run
 * must create nothing and update nothing. That single assertion covers duplicate mappings,
 * false conflicts, version-comparison drift and ID remapping across all eight phases at once —
 * none of which is observable on a first run into an empty target.
 */

/** Mapping folder names, as the mappers write them. */
export type MappingKind =
  | "models"
  | "containers"
  | "templates"
  | "sections"
  | "galleries"
  | "assets"
  | "urlredirections"
  | "item"
  | "page";

/** Content and pages are written per locale; everything else is guid-level. */
const LOCALE_SCOPED_MAPPINGS: MappingKind[] = ["item", "page"];

export interface SyncFixture {
  /** JSON files under the source guid's tree, relative to `<rootPath>/<sourceGuid>/`. */
  source: Record<string, any>;
  /**
   * Non-JSON files under the source tree, written verbatim.
   *
   * Needed for assets: the asset pusher streams the actual bytes off disk before uploading
   * and rejects a missing or zero-byte file, so an asset fixture is a JSON record *and* a
   * real file at the path its `originUrl` resolves to.
   */
  sourceFiles?: Record<string, string>;
  /** Files under the target guid's tree. Omit for a fresh sync into an empty target. */
  target?: Record<string, any>;
  /** Mapping files, relative to `<rootPath>/`. e.g. "mappings/src-1-tgt-1/models/mappings.json". */
  mappings?: Record<string, any>;
}

export interface RunSyncOptions {
  sourceGuid?: string;
  targetGuid?: string;
  locales?: string[];
  /** Comma-separated, as the CLI takes it. Defaults to models + containers + content. */
  elements?: string;
  overwrite?: boolean;
  preflight?: boolean;
  fixture: SyncFixture;
  /** Pre-seed the fake's target instance, for entities that exist server-side already. */
  seedTarget?: (fake: FakeInstance, targetGuid: string) => void;
}

export interface SyncRun {
  results: PushResults[];
  phases: JsonSummaryPhase[];
  /** Phases that actually ran — `notRun` filtered out. */
  ranPhases: JsonSummaryPhase[];
  totals: { successful: number; failed: number; skipped: number };
}

export class SyncHarness {
  readonly rootPath: string;
  readonly sourceGuid: string;
  readonly targetGuid: string;
  readonly locales: string[];
  readonly fake: FakeInstance;

  private readonly elements: string;
  private readonly overwrite: boolean;
  private readonly preflight: boolean;

  constructor(opts: RunSyncOptions) {
    this.sourceGuid = opts.sourceGuid ?? "src-1";
    this.targetGuid = opts.targetGuid ?? "tgt-1";
    this.locales = opts.locales ?? ["en-us"];
    this.elements = opts.elements ?? "Models,Containers,Content";
    this.overwrite = opts.overwrite ?? false;
    this.preflight = opts.preflight ?? false;

    this.rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "agility-sync-harness-"));
    this.fake = new FakeInstance({ locales: this.locales });

    writeTree(path.join(this.rootPath, this.sourceGuid), opts.fixture.source);
    if (opts.fixture.sourceFiles) {
      Object.keys(opts.fixture.sourceFiles).forEach((rel) => {
        const full = path.join(this.rootPath, this.sourceGuid, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, (opts.fixture.sourceFiles as Record<string, string>)[rel], "utf8");
      });
    }
    // Always create the target directory, even when empty: the loaders treat a missing
    // directory and an empty one the same, but leaving it absent hides typos in the guid.
    fs.mkdirSync(path.join(this.rootPath, this.targetGuid), { recursive: true });
    if (opts.fixture.target) writeTree(path.join(this.rootPath, this.targetGuid), opts.fixture.target);
    if (opts.fixture.mappings) writeTree(this.rootPath, opts.fixture.mappings);

    opts.seedTarget?.(this.fake, this.targetGuid);
  }

  /** Run the orchestrator once against the current on-disk state. */
  async run(): Promise<SyncRun> {
    resetState();
    setState({
      rootPath: this.rootPath,
      sourceGuid: this.sourceGuid,
      targetGuid: this.targetGuid,
      // `locales` (comma-separated string), NOT `locale`. setState parses the string form into
      // state.locale; it has no handler for an array, so passing `locale` silently leaves
      // state.locale as []. That is not a harmless no-op — the orchestrator iterates
      // `for (const locale of state.locale)` for the locale-scoped phases, so an empty array
      // means Content and Pages never run at all and are reported as absent rather than failed.
      locales: this.locales.join(","),
      isSync: true,
      elements: this.elements,
      overwrite: this.overwrite,
      preflight: this.preflight,
    });
    state.cachedApiClient = this.fake.asApiClient();
    state.availableLocales = [...this.locales];
    this.wireBatchLayer();

    const results = await new Pushers().instanceOrchestrator();
    const phases = results.flatMap((r) => r.phases ?? []);
    return {
      results,
      phases,
      ranPhases: phases.filter((p) => p.status !== "notRun"),
      totals: phases.reduce(
        (acc, p) => ({
          successful: acc.successful + p.successful,
          failed: acc.failed + p.failed,
          skipped: acc.skipped + p.skipped,
        }),
        { successful: 0, failed: 0, skipped: 0 }
      ),
    };
  }

  /**
   * Re-pull the target, then run again — the two halves of a second `agility sync`.
   *
   * The re-pull is not optional decoration. `GuidDataLoader` reads the target off disk, so
   * without projecting the fake's state back onto the target tree, run 2 sees an empty target
   * while the mappings point into it. That is the *stale-mapping* path, not the idempotency
   * path, and a test that skips this asserts the wrong thing while looking correct.
   */
  async resync(): Promise<SyncRun> {
    this.fake.projectToDisk(this.rootPath, this.targetGuid);
    this.fake.resetCalls();
    return this.run();
  }

  /**
   * Point the stubbed batch layer at this harness's fake.
   *
   * Content is not written through a plain API call: the pusher saves a batch, polls it, then
   * reads the assigned IDs back via `extractContentBatchResults`. The test file mocks that
   * module (jest.mock is hoisted, so it cannot be done from here), but the mock has no way to
   * know which fake it belongs to — so the harness supplies the implementation.
   *
   * Without this, extract returns the default empty result, every content item is reported as
   * neither succeeded nor failed, and no content mapping is ever written. The sync still
   * "passes", which is precisely the silent-nothing failure this suite is built to refuse.
   */
  private wireBatchLayer(): void {
    // Required, not optional: a test that forgets the module mock would otherwise reach the
    // real polling loop and hang against a network that is not there.
    const batchPolling = require("lib/pushers/batch-polling");
    const poll = batchPolling.pollBatchUntilComplete;
    const extractContent = batchPolling.extractContentBatchResults;
    const extractPage = batchPolling.extractPageBatchResults;

    // Pages batch too, via extractPageBatchResults — and process-page imports it dynamically
    // from the same module, so a mock that omits it yields `undefined is not a function`
    // rather than anything that points at the cause.
    if (!jest.isMockFunction(poll) || !jest.isMockFunction(extractContent) || !jest.isMockFunction(extractPage)) {
      throw new Error(
        "SyncHarness requires lib/pushers/batch-polling to be module-mocked, including " +
          "extractPageBatchResults. Add this to the top of the test file:\n\n" +
          '  jest.mock("lib/pushers/batch-polling", () => ({\n' +
          "    pollBatchUntilComplete: jest.fn(),\n" +
          "    extractContentBatchResults: jest.fn(),\n" +
          "    extractPageBatchResults: jest.fn(),\n" +
          "  }));"
      );
    }

    poll.mockResolvedValue({ items: [] });
    extractContent.mockImplementation((_batch: any, includedItems: any[]) =>
      this.fake.buildContentBatchResults(includedItems)
    );
    extractPage.mockImplementation((_batch: any, includedItems: any[]) =>
      this.fake.buildPageBatchResults(includedItems)
    );

    this.wireOptionalEscapeRoutes();
  }

  /**
   * Wire the two escape routes that bypass `state.cachedApiClient` entirely.
   *
   * Unlike the batch layer these are optional: a models-only test should not have to mock
   * asset upload. Each is configured only if the test file mocked it — and if it did not,
   * `installNetworkStubs` makes the attempt fail loudly rather than reach the wire.
   *
   * - **Asset upload** posts multipart form-data through `axios` directly, because the SDK
   *   omits the multipart boundary headers.
   * - **URL redirections** go through `lib/pushers/url-redirection-api`, which builds its own
   *   URL and calls global `fetch`.
   */
  private wireOptionalEscapeRoutes(): void {
    try {
      const axios = require("axios");
      if (jest.isMockFunction(axios.post)) {
        axios.post.mockImplementation(async (url: string, form: any) => {
          this.fake.recordExternal("axios.post", url);
          // The upload URL carries the destination folder; the filename comes off the
          // multipart form. Both feed the originKey the pusher later matches on.
          const folderPath = decodeURIComponent((url.match(/folderPath=([^&]*)/) || [])[1] || "");
          const fileName = extractFormFileName(form) ?? "asset.bin";
          return { data: this.fake.buildAssetUploadResponse(this.targetGuid, folderPath, fileName) };
        });
      }
    } catch {
      // axios not resolvable in this test context — nothing to wire.
    }

    try {
      const redirectionApi = require("lib/pushers/url-redirection-api");
      if (jest.isMockFunction(redirectionApi.saveUrlRedirections)) {
        redirectionApi.saveUrlRedirections.mockImplementation(async (guid: string, redirections: any[]) =>
          this.fake.saveUrlRedirections(guid, redirections)
        );
      }
    } catch {
      // Module not mocked in this test context — nothing to wire.
    }
  }

  /**
   * Rewrite a file in the source tree between runs — an author editing content.
   *
   * There is no `--skipPull`, so a real sync re-pulls the source every run; editing the
   * on-disk source here is the hermetic equivalent of that pull picking up a change.
   */
  editSourceFile(relativePath: string, contents: any): void {
    const full = path.join(this.rootPath, this.sourceGuid, ...relativePath.split("/"));
    if (!fs.existsSync(full)) {
      throw new Error(
        `editSourceFile: ${relativePath} does not exist in the source fixture. ` +
          `Editing a file that was never seeded silently tests nothing.`
      );
    }
    fs.writeFileSync(full, JSON.stringify(contents, null, 2), "utf8");
  }

  /**
   * Read a mapping file, or null when it was never written.
   *
   * Guid-level kinds live at `mappings/<src>-<tgt>/<kind>/mappings.json`, but **content and
   * pages are locale-scoped** and sit at `mappings/<src>-<tgt>/<locale>/<kind>/mappings.json`.
   * Reading a locale-scoped kind without a locale finds nothing and returns null, which is
   * indistinguishable from "the sync wrote no mappings" — so that case throws instead.
   */
  readMappings(kind: MappingKind, locale?: string): any[] | null {
    const localeScoped = LOCALE_SCOPED_MAPPINGS.includes(kind);
    if (localeScoped && !locale) {
      throw new Error(
        `readMappings("${kind}") is locale-scoped — pass a locale, e.g. readMappings("${kind}", "${this.locales[0]}"). ` +
          `Without one this would return null and read as "no mappings were written".`
      );
    }
    const base = path.join(this.rootPath, "mappings", `${this.sourceGuid}-${this.targetGuid}`);
    const p = localeScoped
      ? path.join(base, locale as string, kind, "mappings.json")
      : path.join(base, kind, "mappings.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  /** Every mapping file that exists, keyed by relative path — for byte-comparison across runs. */
  readAllMappings(): Record<string, any> {
    const base = path.join(this.rootPath, "mappings");
    const out: Record<string, any> = {};
    if (!fs.existsSync(base)) return out;
    walkFiles(base).forEach((file) => {
      out[path.relative(base, file).split(path.sep).join("/")] = JSON.parse(fs.readFileSync(file, "utf8"));
    });
    return out;
  }

  cleanup(): void {
    fs.rmSync(this.rootPath, { recursive: true, force: true });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Write `{ "models/10.json": {...} }` as real files under `base`. */
function writeTree(base: string, files: Record<string, any>): void {
  Object.keys(files).forEach((rel) => {
    const full = path.join(base, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(files[rel], null, 2), "utf8");
  });
}

/**
 * Pull the uploaded filename out of a `form-data` instance.
 *
 * There is no public accessor, so this reads the internal stream list. Best-effort by design:
 * the caller falls back to a placeholder, since a wrong filename affects only the readability
 * of the fake's originKey, not whether the upload is recorded.
 */
function extractFormFileName(form: any): string | null {
  try {
    const streams: any[] = form?._streams ?? [];
    for (const chunk of streams) {
      const match = typeof chunk === "string" && chunk.match(/filename="([^"]+)"/);
      if (match) return match[1];
    }
  } catch {
    // Not a form-data instance, or its internals changed — fall back.
  }
  return null;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  });
  return out;
}
