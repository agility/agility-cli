import * as fs from 'fs';

import { state, resetState, setState } from 'core/state';
import { fileOperations } from 'core';
import { Logs } from 'core/logs';
import { ContentBatchProcessor } from 'lib/pushers/content-pusher/content-batch-processor';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';
import { getContentItemsFromFileSystem } from 'lib/getters/filesystem/get-content-items';
import { getModelsFromFileSystem } from 'lib/getters/filesystem/get-models';
import { getContainersFromFileSystem } from 'lib/getters/filesystem/get-containers';
import { filterContentItemsForProcessing } from 'lib/pushers/content-pusher/util/filter-content-items-for-processing';
import { pushModels } from 'lib/pushers/model-pusher';
import { pushContainers } from 'lib/pushers/container-pusher';

import { MockApiClient } from './helpers/mock-api-client';
import { discoverScenarios, copyScenarioState, LoadedScenario } from './helpers/scenario-loader';
import { assertScenarioOutcome, readItemMappings, readModelMappings, readContainerMappings } from './helpers/assertions';
import { applyModelsWithDepsFilter } from './helpers/dependency-filter';

// Module-mock the network/polling boundary so processBatches never reaches a real API.
jest.mock('lib/pushers/batch-polling', () => ({
  pollBatchUntilComplete: jest.fn(),
  extractContentBatchResults: jest.fn(),
}));

import { pollBatchUntilComplete, extractContentBatchResults } from 'lib/pushers/batch-polling';
const mockPoll = pollBatchUntilComplete as jest.Mock;
const mockExtract = extractContentBatchResults as jest.Mock;

const scenarios = discoverScenarios();

function makeLogger(): any {
  return {
    log: jest.fn(),
    setGuid: jest.fn(),
    getGuid: jest.fn(),
    content: {
      created: jest.fn(),
      error: jest.fn(),
      skipped: jest.fn(),
    },
    model: {
      downloaded: jest.fn(),
      created: jest.fn(),
      updated: jest.fn(),
      uploaded: jest.fn(),
      skipped: jest.fn(),
      error: jest.fn(),
    },
    container: {
      downloaded: jest.fn(),
      created: jest.fn(),
      updated: jest.fn(),
      uploaded: jest.fn(),
      skipped: jest.fn(),
      error: jest.fn(),
    },
  };
}

describe.each(scenarios)('sync scenario: $config.name', (scenario: LoadedScenario) => {
  let tmpDir: string;
  let mockApi: MockApiClient;

  beforeEach(() => {
    resetState();
    tmpDir = copyScenarioState(scenario);
    setState({
      rootPath: tmpDir,
      sourceGuid: scenario.config.sourceGuid,
      targetGuid: scenario.config.targetGuid,
      locale: scenario.config.locale,
    });

    const overrides = scenario.config.state;
    if (overrides?.availableLocales) state.availableLocales = overrides.availableLocales;
    if (overrides?.overwrite !== undefined) state.overwrite = overrides.overwrite;

    mockApi = new MockApiClient();
    mockPoll.mockResolvedValue({});
    mockExtract.mockImplementation((_completedBatch: any, includedItems: any[]) => {
      const lastSave = mockApi.capturedSaveCalls[mockApi.capturedSaveCalls.length - 1];
      const payloads = lastSave?.payloads ?? [];
      return {
        successfulItems: mockApi.buildSuccessfulItems(includedItems, payloads),
        failedItems: [],
      };
    });

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces the expected mappings and API calls', async () => {
    const { sourceGuid, targetGuid, locale } = scenario.config;
    const logger = makeLogger() as Logs;

    if (scenario.config.pushes === 'models' || scenario.config.pushes === 'containers') {
      // Both pushers read state.cachedApiClient and state.loggerRegistry, so register both.
      state.cachedApiClient = mockApi.asApiClient();
      if (!state.loggerRegistry) state.loggerRegistry = new Map();
      state.loggerRegistry.set(sourceGuid, logger);

      if (scenario.config.pushes === 'models') {
        const sourceModels = getModelsFromFileSystem(new fileOperations(sourceGuid));
        const targetModels = getModelsFromFileSystem(new fileOperations(targetGuid));
        await pushModels(sourceModels, targetModels);
      } else {
        const sourceContainers = getContainersFromFileSystem(new fileOperations(sourceGuid));
        const targetContainers = getContainersFromFileSystem(new fileOperations(targetGuid));
        await pushContainers(sourceContainers, targetContainers);
      }

      assertScenarioOutcome({
        expectations: scenario.config.expect,
        mockApi,
        itemMappings: [],
        modelMappings: readModelMappings(tmpDir, sourceGuid, targetGuid),
        containerMappings: readContainerMappings(tmpDir, sourceGuid, targetGuid),
      });
      return;
    }

    const sourceFileOps = new fileOperations(sourceGuid, locale);
    const sourceItems = getContentItemsFromFileSystem(sourceFileOps);

    // Selective-sync filter: prune by ModelDependencyTree when --models-with-deps is in play.
    const dependencyFilteredItems = scenario.config.modelsWithDeps
      ? applyModelsWithDepsFilter({
          sourceGuid,
          locale,
          modelsWithDeps: scenario.config.modelsWithDeps,
          contentItems: sourceItems,
        })
      : sourceItems;

    const referenceMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);

    // Same orchestration as a real push: filter for change first, then batch-process the survivors.
    const { itemsToProcess } = await filterContentItemsForProcessing({
      contentItems: dependencyFilteredItems,
      apiClient: mockApi.asApiClient(),
      targetGuid,
      locale,
      referenceMapper,
      targetData: [],
      logger,
    });

    const processor = new ContentBatchProcessor({
      apiClient: mockApi.asApiClient(),
      sourceGuid,
      targetGuid,
      locale,
      referenceMapper,
      batchSize: scenario.config.batchSize ?? 100,
    });

    if (itemsToProcess.length > 0) {
      await processor.processBatches(itemsToProcess, logger, 'content');
    }

    const itemMappings = readItemMappings(tmpDir, sourceGuid, targetGuid, locale);

    assertScenarioOutcome({
      expectations: scenario.config.expect,
      mockApi,
      itemMappings,
    });
  });
});
