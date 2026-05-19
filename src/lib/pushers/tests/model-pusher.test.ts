import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState, state, initializeGuidLogger } from 'core/state';
import * as stateModule from 'core/state';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-model-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: 'src-model-u', targetGuid: 'tgt-model-u', token: 'test-token' });
  initializeGuidLogger('src-model-u', 'push');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let modelCounter = 0;

function makeModel(overrides: Record<string, any> = {}): any {
  modelCounter++;
  return {
    id: modelCounter,
    referenceName: `model-${modelCounter}`,
    displayName: `Model ${modelCounter}`,
    lastModifiedDate: new Date(2020, 0, 1).toISOString(),
    fields: [],
    ...overrides,
  };
}

function makeApiClient(saveModelImpl?: jest.Mock): any {
  return {
    modelMethods: {
      saveModel: saveModelImpl ?? jest.fn().mockResolvedValue(makeModel({ id: 999 })),
    },
  };
}

// ─── pushModels — empty sourceData guard ──────────────────────────────────────

describe('pushModels — empty sourceData guard', () => {
  it('returns success with zeros when sourceData is empty', async () => {
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient());

    const { pushModels } = await import('../model-pusher');
    const result = await pushModels([], []);

    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('returns success with zeros when sourceData is null', async () => {
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient());

    const { pushModels } = await import('../model-pusher');
    const result = await pushModels(null as any, []);

    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
  });
});

// ─── pushModels — result shape ────────────────────────────────────────────────

describe('pushModels — result shape', () => {
  it('result has status, successful, failed, skipped fields', async () => {
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient());

    const { pushModels } = await import('../model-pusher');
    const result = await pushModels([], []);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('successful');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('skipped');
  });
});

// ─── pushModels — existsInTargetWithoutMapping ────────────────────────────────

describe('pushModels — model exists in target but no mapping', () => {
  it('skips model that already exists in target by referenceName but has no mapping', async () => {
    const saveModel = jest.fn().mockResolvedValue(makeModel({ id: 999 }));
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import('../model-pusher');

    const now = new Date().toISOString();
    const sourceModel = makeModel({ referenceName: 'shared-model', lastModifiedDate: now });
    const targetModel = makeModel({ id: 42, referenceName: 'shared-model', lastModifiedDate: now });

    const result = await pushModels([sourceModel], [targetModel]);

    // Should skip because it already exists in target
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(saveModel).not.toHaveBeenCalled();
  });
});

// ─── pushModels — shouldCreateStub path ───────────────────────────────────────

describe('pushModels — create stub path', () => {
  it('calls saveModel to create a stub when model has no mapping and does not exist in target', async () => {
    const createdStub = makeModel({ id: 777 });
    const saveModel = jest.fn().mockResolvedValue(createdStub);
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import('../model-pusher');

    const sourceModel = makeModel({ referenceName: 'brand-new-model' });

    const result = await pushModels([sourceModel], []);

    // saveModel called once for the stub, then once more for updateExistingModel
    expect(saveModel).toHaveBeenCalledTimes(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('counts model as failed when saveModel throws during stub creation', async () => {
    const saveModel = jest.fn().mockRejectedValue(new Error('API error'));
    jest.spyOn(stateModule, 'getApiClient').mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import('../model-pusher');

    const sourceModel = makeModel({ referenceName: 'failing-model' });

    const result = await pushModels([sourceModel], []);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
  });
});
