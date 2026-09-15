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

export interface SyncFixture {
  /** Files under the source guid's tree, relative to `<rootPath>/<sourceGuid>/`. */
  source: Record<string, any>;
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
      locale: this.locales,
      isSync: true,
      elements: this.elements,
      overwrite: this.overwrite,
      preflight: this.preflight,
    });
    state.cachedApiClient = this.fake.asApiClient();
    state.availableLocales = [...this.locales];

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

  /** Read a mapping file, or null when it was never written. */
  readMappings(kind: "models" | "containers" | "item" | "templates" | "pages"): any[] | null {
    const p = path.join(this.rootPath, "mappings", `${this.sourceGuid}-${this.targetGuid}`, kind, "mappings.json");
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

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  });
  return out;
}
