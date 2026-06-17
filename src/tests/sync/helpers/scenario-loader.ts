import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ScenarioStateOverrides {
  availableLocales?: string[];
  overwrite?: boolean;
}

export interface ScenarioConfig {
  name: string;
  description?: string;
  sourceGuid: string;
  targetGuid: string;
  locale: string;
  /** Per-scenario overrides applied to the global `state` object after resetState/setState. */
  state?: ScenarioStateOverrides;
  /**
   * Mirrors the --models-with-deps CLI flag. When set, the runner builds a
   * ModelDependencyTree from the source filesystem and prunes the content list
   * before the change-detection filter runs.
   */
  modelsWithDeps?: string[];
  /**
   * Which pipeline to run. Defaults to "content" (ContentBatchProcessor).
   * "models" runs pushModels, "containers" runs pushContainers.
   */
  pushes?: 'content' | 'models' | 'containers';
  /** ContentBatchProcessor batch size. Defaults to 100 — override to exercise multi-batch loops. */
  batchSize?: number;
  /**
   * Name of a sibling directory under `scenarios/` (e.g., `_base`) whose contents
   * should be copied into the test's temp dir BEFORE the scenario's own `state/`
   * is applied. Lets common fixtures (Post model, Posts container, default
   * mappings) be shared across scenarios. The scenario's `state/` files
   * override any same-path files from the base.
   */
  base?: string;
  expect: ScenarioExpectations;
}

export interface ScenarioExpectations {
  apiCalls?: {
    saveContentItems?: number;
    saveModel?: number;
    saveContainer?: number;
  };
  mappings?: {
    item?: ExpectedMapping[];
    model?: ExpectedModelMapping[];
    container?: ExpectedContainerMapping[];
  };
  noDuplicateMappingsBySourceID?: boolean;
}

export interface ExpectedMapping {
  sourceContentID: number;
  targetContentID: number | '__any__';
}

export interface ExpectedModelMapping {
  sourceID: number;
  targetID: number | '__any__';
  sourceReferenceName?: string;
}

export interface ExpectedContainerMapping {
  sourceContentViewID: number;
  targetContentViewID: number | '__any__';
  sourceReferenceName?: string;
}

export interface LoadedScenario {
  config: ScenarioConfig;
  dir: string;
}

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');

/**
 * Synchronously discover every scenario directory and load its config.
 * Runs at module load so describe.each can enumerate scenarios.
 */
export function discoverScenarios(): LoadedScenario[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];

  return fs
    .readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    // Directories starting with `_` are conventionally "not a scenario" — used
    // for shared fixtures (e.g., `_base/`) that scenarios reference via the
    // `base` field. Skipping them here keeps the discovery loop simple.
    .filter((d) => !d.name.startsWith('_'))
    .map((d) => {
      const dir = path.join(SCENARIOS_DIR, d.name);
      const configPath = path.join(dir, 'scenario.json');
      // Skip stray subdirectories that aren't scenarios (e.g., `agility-files`
      // accidentally written by another test that didn't pin its rootPath to a
      // temp dir). A real scenario always has a scenario.json next to it.
      if (!fs.existsSync(configPath)) return null;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ScenarioConfig;
      return { config, dir };
    })
    .filter((s): s is LoadedScenario => s !== null);
}

/**
 * Copy the scenario's `state/` folder into a fresh temp dir so each test
 * gets an isolated, mutable filesystem to push against.
 *
 * If the scenario declares a `base` (e.g., `_base`), that directory's contents
 * are copied first, then the scenario's own `state/` is overlaid on top. Files
 * at the same path are overwritten, so scenarios can selectively replace any
 * base fixture they need to customize.
 */
export function copyScenarioState(scenario: LoadedScenario): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `agility-sync-${scenario.config.name}-`));

  if (scenario.config.base) {
    const baseDir = path.join(SCENARIOS_DIR, scenario.config.base);
    if (!fs.existsSync(baseDir)) {
      throw new Error(`Scenario "${scenario.config.name}" declares base "${scenario.config.base}" but that directory does not exist.`);
    }
    copyRecursive(baseDir, tmp);
  }

  const stateDir = path.join(scenario.dir, 'state');
  if (fs.existsSync(stateDir)) {
    copyRecursive(stateDir, tmp);
  }
  return tmp;
}

function copyRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
