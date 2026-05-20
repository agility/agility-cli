import { resetState, setState, state } from 'core/state';
import { Downloader, DownloadResults, DownloaderConfig } from 'lib/downloaders/orchestrate-downloaders';

// Mock the operations registry to prevent real API calls
jest.mock('lib/downloaders/download-operations-config', () => ({
  DownloadOperationsRegistry: {
    getOperationsForElements: jest.fn().mockReturnValue([]),
  },
}));

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  // Mock logger functions that are called inside guidDownloader
  jest.spyOn(require('core/state'), 'initializeGuidLogger').mockReturnValue({
    logOperationHeader: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    endTimer: jest.fn(),
  });
  jest.spyOn(require('core/state'), 'finalizeGuidLogger').mockReturnValue(null);

  // Reset mock to return no operations by default
  const { DownloadOperationsRegistry } = require('lib/downloaders/download-operations-config');
  DownloadOperationsRegistry.getOperationsForElements.mockReturnValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Downloader constructor ────────────────────────────────────────────────────

describe('Downloader constructor', () => {
  it('constructs without throwing when no config is supplied', () => {
    expect(() => new Downloader()).not.toThrow();
  });

  it('constructs without throwing when an empty config object is supplied', () => {
    expect(() => new Downloader({})).not.toThrow();
  });

  it('constructs without throwing when callbacks are provided', () => {
    const config: DownloaderConfig = {
      onOperationStart: jest.fn(),
      onOperationComplete: jest.fn(),
    };
    expect(() => new Downloader(config)).not.toThrow();
  });
});

// ─── Downloader.reset ─────────────────────────────────────────────────────────

describe('Downloader.reset', () => {
  it('does not throw', () => {
    const downloader = new Downloader();
    expect(() => downloader.reset()).not.toThrow();
  });
});

// ─── Downloader.updateConfig ──────────────────────────────────────────────────

describe('Downloader.updateConfig', () => {
  it('accepts a partial config without throwing', () => {
    const downloader = new Downloader();
    expect(() => downloader.updateConfig({ onOperationStart: jest.fn() })).not.toThrow();
  });

  it('accepts an empty object without throwing', () => {
    const downloader = new Downloader();
    expect(() => downloader.updateConfig({})).not.toThrow();
  });
});

// ─── Downloader.instanceOrchestrator — guard clause ──────────────────────────

describe('Downloader.instanceOrchestrator guard clause', () => {
  it('throws when no GUIDs are in state (both sourceGuid and targetGuid empty)', async () => {
    const downloader = new Downloader();
    await expect(downloader.instanceOrchestrator(false)).rejects.toThrow(
      'No GUIDs available for download operation'
    );
  });
});

// ─── Downloader.guidDownloader ────────────────────────────────────────────────

describe('Downloader.guidDownloader', () => {
  it('returns a DownloadResults object with the correct guidProcessed', async () => {
    const downloader = new Downloader();
    const result = await downloader.guidDownloader('test-guid-u', false);

    expect(result).toHaveProperty('guidProcessed', 'test-guid-u');
  });

  it('returns empty successful and failed arrays when no operations are registered', async () => {
    const downloader = new Downloader();
    const result = await downloader.guidDownloader('test-guid-u', false);

    expect(result.successful).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('returns a non-negative totalDuration', async () => {
    const downloader = new Downloader();
    const result = await downloader.guidDownloader('test-guid-u', false);

    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('records successful operations in results.successful', async () => {
    const { DownloadOperationsRegistry } = require('lib/downloaders/download-operations-config');
    DownloadOperationsRegistry.getOperationsForElements.mockReturnValue([
      {
        name: 'mockOp',
        description: 'test op',
        elements: ['Models'],
        handler: jest.fn().mockResolvedValue(undefined),
      },
    ]);

    const downloader = new Downloader();
    const result = await downloader.guidDownloader('test-guid-u', false);

    expect(result.successful).toHaveLength(1);
    expect(result.successful[0]).toContain('mockOp');
  });

  it('records failed operations in results.failed when handler throws', async () => {
    const { DownloadOperationsRegistry } = require('lib/downloaders/download-operations-config');
    DownloadOperationsRegistry.getOperationsForElements.mockReturnValue([
      {
        name: 'failOp',
        description: 'failing op',
        elements: ['Models'],
        handler: jest.fn().mockRejectedValue(new Error('handler exploded')),
      },
    ]);

    const downloader = new Downloader();
    const result = await downloader.guidDownloader('test-guid-u', false);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].operation).toBe('failOp');
    expect(result.failed[0].error).toBe('handler exploded');
  });

  it('calls onOperationStart and onOperationComplete callbacks', async () => {
    const { DownloadOperationsRegistry } = require('lib/downloaders/download-operations-config');
    DownloadOperationsRegistry.getOperationsForElements.mockReturnValue([
      {
        name: 'callbackOp',
        description: 'callback test',
        elements: ['Models'],
        handler: jest.fn().mockResolvedValue(undefined),
      },
    ]);

    const onStart = jest.fn();
    const onComplete = jest.fn();
    const downloader = new Downloader({ onOperationStart: onStart, onOperationComplete: onComplete });

    await downloader.guidDownloader('test-guid-u', false);

    expect(onStart).toHaveBeenCalledWith('callbackOp', 'test-guid-u');
    expect(onComplete).toHaveBeenCalledWith('callbackOp', 'test-guid-u', true);
  });

  it('calls onOperationComplete with false on handler failure', async () => {
    const { DownloadOperationsRegistry } = require('lib/downloaders/download-operations-config');
    DownloadOperationsRegistry.getOperationsForElements.mockReturnValue([
      {
        name: 'badOp',
        description: 'bad op',
        elements: ['Models'],
        handler: jest.fn().mockRejectedValue(new Error('fail')),
      },
    ]);

    const onComplete = jest.fn();
    const downloader = new Downloader({ onOperationComplete: onComplete });

    await downloader.guidDownloader('test-guid-u', false);

    expect(onComplete).toHaveBeenCalledWith('badOp', 'test-guid-u', false);
  });
});

// ─── Downloader.instanceOrchestrator — parallel execution ─────────────────────

describe('Downloader.instanceOrchestrator with GUIDs set', () => {
  it('processes all GUIDs and returns one result per GUID', async () => {
    setState({ sourceGuid: 'guid-a-u,guid-b-u' });

    const downloader = new Downloader();
    const results = await downloader.instanceOrchestrator(false);

    expect(results).toHaveLength(2);
    const processedGuids = results.map((r: DownloadResults) => r.guidProcessed);
    expect(processedGuids).toContain('guid-a-u');
    expect(processedGuids).toContain('guid-b-u');
  });

  it('uses sequential mode when state.local is true', async () => {
    setState({ sourceGuid: 'guid-local-u', local: true });

    const downloader = new Downloader();
    const results = await downloader.instanceOrchestrator(false);

    expect(results).toHaveLength(1);
    expect(results[0].guidProcessed).toBe('guid-local-u');
  });

  it('includes targetGuid in the GUIDs to process', async () => {
    setState({ targetGuid: 'target-guid-u' });

    const downloader = new Downloader();
    const results = await downloader.instanceOrchestrator(false);

    expect(results).toHaveLength(1);
    expect(results[0].guidProcessed).toBe('target-guid-u');
  });

  it('combines sourceGuid and targetGuid', async () => {
    setState({ sourceGuid: 'src-u', targetGuid: 'tgt-u' });

    const downloader = new Downloader();
    const results = await downloader.instanceOrchestrator(false);

    expect(results).toHaveLength(2);
  });
});
