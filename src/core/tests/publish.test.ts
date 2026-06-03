import { PublishService, PublishResult } from '../publish';
import { resetState, setState, state } from '../state';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  state.cachedApiClient = undefined;
  state.mgmtApiOptions = undefined;
});

function setupStateWithTarget() {
  setState({ targetGuid: 'test-target-guid-u', token: 'test-token-value' });
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('PublishService constructor', () => {
  it('creates an instance when targetGuid and token are set', () => {
    setupStateWithTarget();
    expect(() => new PublishService()).not.toThrow();
  });

  it('creates an instance with verbose option', () => {
    setupStateWithTarget();
    expect(() => new PublishService({ verbose: true })).not.toThrow();
  });

  it('throws when targetGuid is empty array', () => {
    setState({ token: 'test-token-value' });
    expect(() => new PublishService()).toThrow('PublishService requires targetGuid to be set in state');
  });
});

// ─── publishContentBatch ──────────────────────────────────────────────────────

describe('PublishService.publishContentBatch', () => {
  it('returns empty successful and failed arrays when given an empty ID list', async () => {
    setupStateWithTarget();
    const service = new PublishService();
    const result = await service.publishContentBatch([], 'en-us');
    expect(result.successful).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('returns the expected result shape', async () => {
    setupStateWithTarget();
    const service = new PublishService();
    const result = await service.publishContentBatch([], 'en-us');
    expect(result).toHaveProperty('successful');
    expect(result).toHaveProperty('failed');
    expect(Array.isArray(result.successful)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
  });
});
