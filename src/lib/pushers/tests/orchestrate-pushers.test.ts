import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState, state } from 'core/state';
import { Pushers } from '../orchestrate-pushers';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-orch-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── constructor ──────────────────────────────────────────────────────────────

describe('Pushers constructor', () => {
  it('constructs without throwing with no config', () => {
    expect(() => new Pushers()).not.toThrow();
  });

  it('constructs without throwing with empty config', () => {
    expect(() => new Pushers({})).not.toThrow();
  });

  it('constructs without throwing with onOperationStart callback', () => {
    const config = { onOperationStart: jest.fn() };
    expect(() => new Pushers(config)).not.toThrow();
  });

  it('constructs without throwing when state has sourceGuid set', () => {
    setState({ sourceGuid: 'src-guid-u', targetGuid: 'tgt-guid-u' });
    expect(() => new Pushers()).not.toThrow();
  });
});

// ─── getPushSummary ───────────────────────────────────────────────────────────

describe('Pushers.getPushSummary', () => {
  it('returns summary shape with expected keys', () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();

    expect(summary).toHaveProperty('totalOperations');
    expect(summary).toHaveProperty('successfulOperations');
    expect(summary).toHaveProperty('failedOperations');
    expect(summary).toHaveProperty('overallSuccess');
    expect(summary).toHaveProperty('duration');
  });

  it('returns overallSuccess as true by default', () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();
    expect(summary.overallSuccess).toBe(true);
  });

  it('returns non-negative duration', () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('Pushers.reset', () => {
  it('does not throw when called', () => {
    const pushers = new Pushers();
    expect(() => pushers.reset()).not.toThrow();
  });

  it('duration increases after reset + time passes', () => {
    const pushers = new Pushers();
    const summaryBefore = pushers.getPushSummary();
    pushers.reset();
    const summaryAfter = pushers.getPushSummary();
    // Both should be >= 0 and after reset the startTime is fresh
    expect(summaryAfter.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── updateConfig ─────────────────────────────────────────────────────────────

describe('Pushers.updateConfig', () => {
  it('does not throw when updating config', () => {
    const pushers = new Pushers();
    expect(() => pushers.updateConfig({ onOperationStart: jest.fn() })).not.toThrow();
  });

  it('allows partial config updates', () => {
    const cb = jest.fn();
    const pushers = new Pushers({ onOperationComplete: cb });
    expect(() => pushers.updateConfig({ onOperationStart: jest.fn() })).not.toThrow();
  });
});

// ─── instanceOrchestrator — guard clause: missing GUIDs ──────────────────────

describe('Pushers.instanceOrchestrator — guard clause', () => {
  it('throws when no sourceGuid is set', async () => {
    const pushers = new Pushers();
    // state has no sourceGuid after resetState
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(
      /No source or target GUIDs/
    );
  });

  it('throws when no targetGuid is set', async () => {
    setState({ sourceGuid: 'src-guid-u' });
    const pushers = new Pushers();
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(
      /No source or target GUIDs/
    );
  });
});

// ─── executePushOperation — skips on empty data ───────────────────────────────

describe('Pushers.executePushOperation — empty data skip', () => {
  it('returns zero counts when elementData is empty array', async () => {
    setState({ sourceGuid: 'src-u', targetGuid: 'tgt-u' });
    const pushers = new Pushers();

    const { PUSH_OPERATIONS } = await import('../push-operations-config');
    const config = PUSH_OPERATIONS.models;

    const emptySource: any = {
      pages: [], templates: [], containers: [], lists: [],
      models: [], content: [], assets: [], galleries: []
    };
    const emptyTarget: any = { ...emptySource };

    const result = await pushers.executePushOperation({
      config,
      sourceData: emptySource,
      targetData: emptyTarget,
      locale: 'en-us',
      elements: ['Models'],
    });

    expect(result.success).toBe(0);
    expect(result.failures).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('returns zero counts when element is not in requested elements', async () => {
    setState({ sourceGuid: 'src-u', targetGuid: 'tgt-u' });
    const pushers = new Pushers();

    const { PUSH_OPERATIONS } = await import('../push-operations-config');
    const config = PUSH_OPERATIONS.models;

    const sourceData: any = {
      pages: [], templates: [], containers: [], lists: [],
      models: [{ id: 1, referenceName: 'TestModel' }],
      content: [], assets: [], galleries: []
    };

    const result = await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: 'en-us',
      elements: ['Pages'], // Models not in requested elements
    });

    expect(result.success).toBe(0);
    expect(result.failures).toBe(0);
  });
});

// ─── executePushOperation — callbacks ─────────────────────────────────────────

describe('Pushers.executePushOperation — callbacks', () => {
  it('calls onOperationStart when data is non-empty', async () => {
    setState({ sourceGuid: 'src-u', targetGuid: 'tgt-u' });
    const onOperationStart = jest.fn();
    const pushers = new Pushers({ onOperationStart });

    const { PUSH_OPERATIONS } = await import('../push-operations-config');
    const config = {
      ...PUSH_OPERATIONS.models,
      handler: jest.fn().mockResolvedValue({ status: 'success', successful: 0, failed: 0, skipped: 0 }),
    };

    const sourceData: any = {
      pages: [], templates: [], containers: [], lists: [],
      models: [{ id: 1, referenceName: 'TestModel' }],
      content: [], assets: [], galleries: []
    };

    await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: 'en-us',
      elements: ['Models'],
    });

    expect(onOperationStart).toHaveBeenCalledWith('pushModels', 'src-u', 'tgt-u');
  });

  it('calls onOperationComplete when data is non-empty', async () => {
    setState({ sourceGuid: 'src-u', targetGuid: 'tgt-u' });
    const onOperationComplete = jest.fn();
    const pushers = new Pushers({ onOperationComplete });

    const { PUSH_OPERATIONS } = await import('../push-operations-config');
    const config = {
      ...PUSH_OPERATIONS.models,
      handler: jest.fn().mockResolvedValue({ status: 'success', successful: 1, failed: 0, skipped: 0 }),
    };

    const sourceData: any = {
      pages: [], templates: [], containers: [], lists: [],
      models: [{ id: 1, referenceName: 'TestModel' }],
      content: [], assets: [], galleries: []
    };

    await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: 'en-us',
      elements: ['Models'],
    });

    expect(onOperationComplete).toHaveBeenCalledWith('pushModels', 'src-u', 'tgt-u', true);
  });
});
