/**
 * `agility verify` (PROD-2552, PROD-2549): prove a migrated target matches its source.
 *
 * A sync reports on its own bookkeeping; a customer had syncs report success while
 * the components on their pages were in the wrong order. Verify is the independent check for a
 * blue/green cutover: it pulls both instances fresh, then compares them in a neutral form (see
 * lib/verify/canonicalize.ts) that shares no code with the push transforms.
 *
 * Flow:
 *  1. Status guard — wait (bounded, 10 minutes) until neither instance has a Fetch API update in
 *     progress, in both preview and fetch modes. A status error or timeout is exit 2.
 *  2. Full pull of both instances. A pull failure is exit 2. Mapping files are never written.
 *  3. Re-check status. If an update started or landed during the pull, pull once more; if it
 *     happens again, exit 2 ("an update ran during the pull, re-run").
 *  4. Per-locale checks, aggregate, console report + JSON report, exit code.
 *
 * Exit codes: 0 pass, 1 differences found, 2 could not verify.
 */
import * as fs from "fs";
import ansiColors from "ansi-colors";
import { Auth } from "./auth";
import { Pull } from "./pull";
import { state, setState, resetState, primeFromEnv, getPageCmsLink, getContentCmsLink } from "./state";
import { normalizeArgv } from "./arg-normalizer";
import { FetchApiStatus, FetchApiSyncMode, getFetchApiStatus } from "../lib/shared/get-fetch-api-status";
import { sleep as defaultSleep } from "../lib/shared/sleep";
import { ModelFilterOptions } from "../lib/pushers/guid-data-loader";
import { resolvePageSyncScope } from "../lib/pages/resolve-page-sync-scope";
import { parsePageSelectors } from "../lib/pages/page-scope";
import { resolveContainerSyncScope } from "../lib/containers/resolve-container-sync-scope";
import { parseContainerSelectors } from "../lib/containers/container-scope";
import {
  buildMappingIndex,
  createFileMappingReader,
  mappingPairDirectory,
  MappingIndex,
} from "../lib/verify/mapping-index";
import {
  createVerifyContext,
  findUnreadableCacheFiles,
  loadSideEntities,
  SideEntities,
} from "../lib/verify/verify-context";
import { checkInstanceIntegrity, checkLocaleIntegrity } from "../lib/verify/check-mapping-integrity";
import { checkStructure } from "../lib/verify/check-structure";
import { checkContent } from "../lib/verify/check-content";
import { checkPages } from "../lib/verify/check-page-zones";
import { checkSitemap } from "../lib/verify/check-sitemap";
import {
  buildErrorReport,
  buildVerifyReport,
  defaultReportPath,
  emptyRunInfo,
  EXIT_CANNOT_VERIFY,
  Finding,
  FindingCollector,
  printVerifyReport,
  StatusSnapshot,
  VerifyOptionsSummary,
  VerifyReport,
  VerifyRunInfo,
  writeVerifyReport,
} from "../lib/verify/verify-report";
import * as path from "path";

/** How long the status guard waits for an in-progress update before giving up. */
export const STATUS_TIMEOUT_MS = 10 * 60 * 1000;
/** How often the status guard polls while an update is in progress. */
export const STATUS_POLL_MS = 5000;

const STATUS_MODES: FetchApiSyncMode[] = ["preview", "fetch"];

/** A condition under which verify cannot produce a verdict — always exit 2. */
export class VerifyAbort extends Error {}

export interface VerifyOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
  /** Restrict sitemap checks to this channel; undefined = every channel. */
  channel?: string;
  models: string;
  pages: string;
  containers: string;
  /** Report path; empty = agility-files/logs/verify-{src}-{tgt}-{ts}.json. */
  jsonSummary: string;
  rootPath: string;
}

export interface VerifyDeps {
  getStatus: (guid: string, mode: FetchApiSyncMode) => Promise<FetchApiStatus>;
  /** Full pull of state.sourceGuid and state.targetGuid. */
  pull: () => Promise<{ success: boolean; results: any[] }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  /** Load one side of one locale from the pulled cache. */
  loadSide: (guid: string, locale: string, filter?: ModelFilterOptions) => Promise<SideEntities>;
  statusTimeoutMs: number;
  statusPollMs: number;
  /** Print the console report (default true). */
  print: boolean;
}

const defaultDeps: VerifyDeps = {
  getStatus: (guid, mode) => getFetchApiStatus(guid, mode, false),
  pull: () => new Pull().pullInstances(true),
  sleep: (ms) => defaultSleep(ms),
  now: () => Date.now(),
  log: (line) => console.log(line),
  loadSide: (guid, locale, filter) => loadSideEntities(guid, locale, filter),
  statusTimeoutMs: STATUS_TIMEOUT_MS,
  statusPollMs: STATUS_POLL_MS,
  print: true,
};

function snapshot(guid: string, mode: string, status: FetchApiStatus, at: number): StatusSnapshot {
  return {
    guid,
    mode,
    checkedAt: new Date(at).toISOString(),
    inProgress: status?.inProgress === true,
    lastContentVersionID: status?.lastContentVersionID ?? null,
    maxChangeDate: status?.maxChangeDate ?? null,
  };
}

/** Snapshots whose content version or change date moved, or that are now in progress. */
export function changedSnapshots(before: StatusSnapshot[], after: StatusSnapshot[]): StatusSnapshot[] {
  return after.filter((a) => {
    const b = before.find((x) => x.guid === a.guid && x.mode === a.mode);
    return (
      a.inProgress ||
      !b ||
      b.lastContentVersionID !== a.lastContentVersionID ||
      (b.maxChangeDate ?? null) !== (a.maxChangeDate ?? null)
    );
  });
}

export class Verify {
  private readonly options: VerifyOptions;
  private readonly deps: VerifyDeps;

  constructor(options: VerifyOptions, deps: Partial<VerifyDeps> = {}) {
    this.options = options;
    this.deps = { ...defaultDeps, ...deps };
  }

  get optionsSummary(): VerifyOptionsSummary {
    return {
      locales: this.options.locales.slice(),
      channel: this.options.channel ?? "",
      models: this.options.models,
      pages: this.options.pages,
      containers: this.options.containers,
    };
  }

  /** Run the whole command. Never throws and never exits the process: the exit code is on the report. */
  async run(): Promise<VerifyReport> {
    const startedAt = new Date(this.deps.now());
    const run = emptyRunInfo(startedAt);
    let report: VerifyReport;

    try {
      await this.guardedPull(run);
      const compareStarted = this.deps.now();
      const collector = await this.compare();
      run.compareElapsedMs = this.deps.now() - compareStarted;
      this.finishRun(run, startedAt);
      report = buildVerifyReport({
        source: this.options.sourceGuid,
        target: this.options.targetGuid,
        options: this.optionsSummary,
        collector,
        run,
      });
    } catch (error: any) {
      this.finishRun(run, startedAt);
      const message =
        error instanceof VerifyAbort ? error.message : `Unexpected error while verifying: ${error?.message || error}`;
      report = buildErrorReport({
        source: this.options.sourceGuid,
        target: this.options.targetGuid,
        options: this.optionsSummary,
        error: message,
        run,
      });
    }

    this.emit(report, startedAt);
    return report;
  }

  private finishRun(run: VerifyRunInfo, startedAt: Date): void {
    const finished = this.deps.now();
    run.finishedAt = new Date(finished).toISOString();
    run.elapsedMs = finished - startedAt.getTime();
  }

  private emit(report: VerifyReport, startedAt: Date): void {
    const { sourceGuid, targetGuid } = this.options;
    if (this.deps.print) {
      printVerifyReport(report, {
        log: this.deps.log,
        linkFor: (f) => cmsLinkFor(f, sourceGuid, targetGuid),
      });
      const pull = report.run.pull;
      if (pull.attempts > 0) {
        this.deps.log(
          ansiColors.gray(
            `Pull: ${pull.attempts} attempt(s), ${pull.elapsedMs.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(" + ")}; ` +
              `compare: ${(report.run.compareElapsedMs / 1000).toFixed(1)}s; total: ${(report.run.elapsedMs / 1000).toFixed(1)}s`
          )
        );
      }
    }
    const reportPath =
      this.options.jsonSummary || defaultReportPath(this.options.rootPath, sourceGuid, targetGuid, startedAt);
    const written = writeVerifyReport(reportPath, report);
    if (this.deps.print) {
      this.deps.log(
        written.written
          ? ansiColors.gray(`Report: ${path.resolve(reportPath)}`)
          : ansiColors.yellow(`⚠️ Could not write the verify report to ${reportPath}: ${written.error}`)
      );
    }
  }

  // ─── status guard + pull ─────────────────────────────────────────────────

  private guids(): string[] {
    return [this.options.sourceGuid, this.options.targetGuid];
  }

  private async checkStatus(guid: string, mode: FetchApiSyncMode): Promise<FetchApiStatus> {
    try {
      const status = await this.deps.getStatus(guid, mode);
      if (!status || typeof status !== "object") throw new Error("empty response");
      return status;
    } catch (error: any) {
      throw new VerifyAbort(`Could not check the Fetch API status of ${guid} (${mode}): ${error?.message || error}`);
    }
  }

  /** Wait until no instance has an update in progress, in either mode. Bounded by statusTimeoutMs. */
  async waitForIdle(): Promise<StatusSnapshot[]> {
    const deadline = this.deps.now() + this.deps.statusTimeoutMs;
    const snapshots: StatusSnapshot[] = [];
    for (const guid of this.guids()) {
      for (const mode of STATUS_MODES) {
        let status = await this.checkStatus(guid, mode);
        let announced = false;
        while (status.inProgress) {
          if (this.deps.now() >= deadline) {
            throw new VerifyAbort(
              `Timed out after ${Math.round(this.deps.statusTimeoutMs / 60000)} minute(s) waiting for an in-progress ` +
                `Fetch API update on ${guid} (${mode}) to finish`
            );
          }
          if (!announced) {
            this.deps.log(
              ansiColors.gray(`⏳ ${guid} (${mode}): an update is in progress, waiting for it to finish...`)
            );
            announced = true;
          }
          await this.deps.sleep(this.deps.statusPollMs);
          status = await this.checkStatus(guid, mode);
        }
        snapshots.push(snapshot(guid, mode, status, this.deps.now()));
      }
    }
    return snapshots;
  }

  private async currentStatus(): Promise<StatusSnapshot[]> {
    const snapshots: StatusSnapshot[] = [];
    for (const guid of this.guids()) {
      for (const mode of STATUS_MODES) {
        snapshots.push(snapshot(guid, mode, await this.checkStatus(guid, mode), this.deps.now()));
      }
    }
    return snapshots;
  }

  async guardedPull(run: VerifyRunInfo): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await this.waitForIdle();
      run.status.before = before;

      const pullStarted = this.deps.now();
      await this.pullOnce();
      run.pull.attempts = attempt;
      run.pull.elapsedMs.push(this.deps.now() - pullStarted);

      const after = await this.currentStatus();
      run.status.after = after;

      const changed = changedSnapshots(before, after);
      if (changed.length === 0) return;

      const which = changed.map((s) => `${s.guid} (${s.mode})`).join(", ");
      if (attempt === 2) {
        throw new VerifyAbort(
          `An update ran during the pull again (${which}); re-run verify once the instances are idle`
        );
      }
      this.deps.log(ansiColors.yellow(`⚠️ An update ran during the pull (${which}); pulling once more`));
    }
  }

  /**
   * One full pull of both instances. The scope flags are cleared for the pull's duration: a scoped
   * verify still needs complete data (the `--models` filter would otherwise pull models only).
   */
  private async pullOnce(): Promise<void> {
    const saved = {
      fullPull: state.fullPull,
      models: state.models,
      modelsWithDeps: state.modelsWithDeps,
      pages: state.pages,
      containers: state.containers,
      elements: state.elements,
    };
    state.fullPull = true;
    state.models = "";
    state.modelsWithDeps = "";
    state.pages = "";
    state.containers = "";
    state.elements = "Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps,UrlRedirections";

    let result: { success: boolean; results: any[] };
    try {
      this.deps.log(ansiColors.cyan(`⬇️  Full pull of ${this.guids().join(" and ")}...`));
      result = await this.deps.pull();
    } catch (error: any) {
      throw new VerifyAbort(`Pull failed: ${error?.message || error}`);
    } finally {
      Object.assign(state, saved);
    }

    const results = Array.isArray(result?.results) ? result.results : [];
    const pulled = new Set(results.map((r: any) => r?.guidProcessed).filter(Boolean));
    const missing = this.guids().filter((g) => !pulled.has(g));
    const failures = results.flatMap((r: any) =>
      (r?.failed || []).map((f: any) => `${r.guidProcessed}: ${f.operation} — ${f.error}`)
    );
    if (!result?.success || failures.length > 0 || missing.length > 0) {
      const detail = [...failures, ...missing.map((g) => `${g}: no pull result`)].join("; ");
      throw new VerifyAbort(`Pull failed${detail ? `: ${detail}` : ""}`);
    }
  }

  // ─── comparison ──────────────────────────────────────────────────────────

  private resolveFilter(): Promise<ModelFilterOptions | undefined> | ModelFilterOptions | undefined {
    const { sourceGuid, targetGuid, locales, models, pages, containers } = this.options;
    const used = [models && "--models", pages && "--pages", containers && "--containers"].filter(Boolean);
    if (used.length > 1) {
      throw new VerifyAbort(`${used.join(", ")} cannot be combined — pass one scope at a time`);
    }
    if (pages) {
      // Verify does not care whether a page's ancestors were synced: it reports what is there.
      const pageScope = resolvePageSyncScope({
        sourceGuid,
        targetGuid,
        locales,
        selectors: parsePageSelectors(pages),
        isAncestorMapped: () => true,
      });
      return { pageScope };
    }
    if (containers) {
      return resolveContainerSyncScope({
        sourceGuid,
        targetGuid,
        locales,
        selectors: parseContainerSelectors(containers),
        loadEntities: async (guid, locale) => (await this.deps.loadSide(guid, locale)) as any,
      }).then((containerScope) => ({ containerScope }));
    }
    if (models) {
      const names = models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      return names.length > 0 ? { models: names } : undefined;
    }
    return undefined;
  }

  private loadMappings(): MappingIndex {
    const { rootPath, sourceGuid, targetGuid, locales } = this.options;
    const pairDir = mappingPairDirectory(rootPath, sourceGuid, targetGuid);
    if (!fs.existsSync(pairDir)) {
      throw new VerifyAbort(
        `No mapping files for ${sourceGuid} → ${targetGuid} (expected ${pairDir}). Run a sync first.`
      );
    }
    const missingLocales = locales.filter((locale) => !fs.existsSync(path.join(pairDir, locale)));
    if (missingLocales.length > 0) {
      throw new VerifyAbort(
        `No content/page mappings for locale(s) ${missingLocales.join(", ")} in ${pairDir}. Sync those locales first, or pass --locales.`
      );
    }
    try {
      return buildMappingIndex(createFileMappingReader(rootPath, sourceGuid, targetGuid), locales);
    } catch (error: any) {
      throw new VerifyAbort(`Could not read the mapping files in ${pairDir}: ${error?.message || error}`);
    }
  }

  async compare(): Promise<FindingCollector> {
    const { sourceGuid, targetGuid, locales, rootPath, channel } = this.options;
    if (locales.length === 0) throw new VerifyAbort("No locales to verify");

    const mappings = this.loadMappings();

    const unreadable = [
      ...findUnreadableCacheFiles(rootPath, sourceGuid, locales),
      ...findUnreadableCacheFiles(rootPath, targetGuid, locales),
    ];
    if (unreadable.length > 0) {
      throw new VerifyAbort(
        `The pulled cache is unreadable (${unreadable.length} problem(s)): ${unreadable.slice(0, 5).join("; ")}`
      );
    }

    let filter: ModelFilterOptions | undefined;
    try {
      filter = await this.resolveFilter();
    } catch (error: any) {
      if (error instanceof VerifyAbort) throw error;
      throw new VerifyAbort(error?.message || String(error));
    }

    const collector = new FindingCollector();
    for (let i = 0; i < locales.length; i++) {
      const locale = locales[i];
      this.deps.log(ansiColors.cyan(`🔎 Comparing ${locale}...`));
      const source = await this.deps.loadSide(sourceGuid, locale, filter);
      const target = await this.deps.loadSide(targetGuid, locale);
      const ctx = createVerifyContext({
        sourceGuid,
        targetGuid,
        locale,
        mappings,
        source,
        target,
        scoped: !!filter,
        channels: channel ? [channel] : undefined,
      });

      if (i === 0) {
        // Models, containers, templates, assets and galleries are instance-wide: check them once.
        checkStructure(ctx, checkInstanceIntegrity(ctx, collector), collector);
      }
      const localePairs = checkLocaleIntegrity(ctx, collector);
      checkContent(ctx, localePairs.content, collector);
      checkPages(ctx, localePairs.pages, collector);
      checkSitemap(ctx, collector);
    }
    return collector;
  }
}

/** A CMS link for a finding: the target entity when there is one, else the source entity. */
export function cmsLinkFor(f: Finding, sourceGuid: string, targetGuid: string): string | undefined {
  if (f.locale === "*") return undefined;
  const pick = (): { guid: string; id: number } | undefined => {
    if (typeof f.targetID === "number") return { guid: targetGuid, id: f.targetID };
    if (typeof f.sourceID === "number") return { guid: sourceGuid, id: f.sourceID };
    return undefined;
  };
  const target = pick();
  if (!target) return undefined;
  if (f.entity === "content") return getContentCmsLink(target.guid, f.locale, target.id);
  if (f.entity === "page" || f.entity === "zone" || f.entity === "sitemap") {
    return getPageCmsLink(target.guid, f.locale, target.id);
  }
  return undefined;
}

// ─── command ─────────────────────────────────────────────────────────────────

export interface VerifyCommandDeps {
  createAuth?: () => { init(): Promise<boolean>; validateCommand(commandType: "verify"): Promise<boolean> };
  createVerify?: (options: VerifyOptions) => { run(): Promise<VerifyReport> };
  log?: (line: string) => void;
}

function optionsFromState(channel: string | undefined): VerifyOptions {
  return {
    sourceGuid: state.sourceGuid,
    targetGuid: state.targetGuid,
    locales: (state.guidLocaleMap.get(state.sourceGuid) || state.locale || []).slice(),
    channel: channel ? String(channel) : undefined,
    models: state.models || "",
    pages: state.pages || "",
    containers: state.containers || "",
    jsonSummary: state.jsonSummary || "",
    rootPath: state.rootPath,
  };
}

/**
 * The `verify` command handler: prime state the same way every other command does, authenticate,
 * validate read access to both instances, run, and return the exit code (the caller exits).
 */
export async function runVerifyCommand(argv: any, deps: VerifyCommandDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  resetState();
  argv = normalizeArgv(argv);

  const envPriming = primeFromEnv();
  if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
    log(ansiColors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
  }

  const startedAt = new Date();
  // --channel has no default for verify: unset means "every channel".
  const explicitChannel: string | undefined = argv.channel ? String(argv.channel) : undefined;

  const abort = (reason: string): number => {
    const options = optionsFromState(explicitChannel);
    const report = buildErrorReport({
      source: state.sourceGuid,
      target: state.targetGuid,
      options: new Verify(options).optionsSummary,
      error: reason,
      run: emptyRunInfo(startedAt),
    });
    printVerifyReport(report, { log });
    const reportPath =
      options.jsonSummary ||
      defaultReportPath(state.rootPath, state.sourceGuid || "unknown", state.targetGuid || "unknown", startedAt);
    writeVerifyReport(reportPath, report);
    return EXIT_CANNOT_VERIFY;
  };

  try {
    setState(argv);
  } catch (error: any) {
    return abort(error?.message || String(error));
  }

  if (!state.sourceGuid || !state.targetGuid) {
    return abort("verify requires both --sourceGuid and --targetGuid (or AGILITY_GUID / AGILITY_TARGET_GUID in .env)");
  }
  if (state.sourceGuid === state.targetGuid) {
    return abort("verify requires two different instances (sourceGuid equals targetGuid)");
  }

  const auth = deps.createAuth ? deps.createAuth() : new Auth();
  try {
    if (!(await auth.init())) {
      return abort("Authentication failed — could not resolve API keys for the requested instances");
    }
    if (!(await auth.validateCommand("verify"))) {
      return abort("Command validation failed — no read access to both instances, or a required setting is missing");
    }
  } catch (error: any) {
    return abort(`Authentication failed: ${error?.message || error}`);
  }

  const options = optionsFromState(explicitChannel);
  const verify = deps.createVerify ? deps.createVerify(options) : new Verify(options);
  const report = await verify.run();
  return report.exitCode;
}
