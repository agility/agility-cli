import { resetState } from 'core/state';
import { getFetchApiStatus, waitForFetchApiSync } from '../get-fetch-api-status';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeStatus(overrides: Partial<{ inProgress: boolean }>  = {}): any {
  return {
    inProgress: false,
    itemsAffected: 0,
    lastContentVersionID: 100,
    lastDeletedContentVersionID: 0,
    lastDeletedPageVersionID: 0,
    pushType: 1,
    ...overrides
  };
}

function makeApiClient(statusOrFn: any) {
  const fn = typeof statusOrFn === 'function'
    ? statusOrFn
    : jest.fn().mockResolvedValue(statusOrFn);
  return {
    instanceMethods: { getFetchApiStatus: fn }
  };
}

// ─── getFetchApiStatus ─────────────────────────────────────────────────────────

describe('getFetchApiStatus', () => {
  it('returns the status from the API client', async () => {
    const status = makeStatus();
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(status));

    const result = await getFetchApiStatus('my-guid');

    expect(result).toBe(status);
  });

  it('passes guid, mode and waitForCompletion to the API client', async () => {
    const mockFn = jest.fn().mockResolvedValue(makeStatus());
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    await getFetchApiStatus('abc', 'preview', true);

    expect(mockFn).toHaveBeenCalledWith('abc', 'preview', true);
  });

  it('defaults mode to fetch and waitForCompletion to false', async () => {
    const mockFn = jest.fn().mockResolvedValue(makeStatus());
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    await getFetchApiStatus('abc');

    expect(mockFn).toHaveBeenCalledWith('abc', 'fetch', false);
  });

  it('propagates API errors', async () => {
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
      instanceMethods: { getFetchApiStatus: jest.fn().mockRejectedValue(new Error('network')) }
    });

    await expect(getFetchApiStatus('abc')).rejects.toThrow('network');
  });
});

// ─── waitForFetchApiSync — sync not in progress ────────────────────────────────

describe('waitForFetchApiSync — sync already complete', () => {
  it('returns immediately when inProgress is false', async () => {
    const status = makeStatus({ inProgress: false });
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(status));

    const result = await waitForFetchApiSync('my-guid');

    expect(result.status).toBe(status);
    expect(result.logLines).toHaveLength(0);
  });

  it('makes only one API call when sync is already complete', async () => {
    const mockFn = jest.fn().mockResolvedValue(makeStatus({ inProgress: false }));
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    await waitForFetchApiSync('my-guid');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

// ─── waitForFetchApiSync — sync in progress ───────────────────────────────────

describe('waitForFetchApiSync — sync in progress', () => {
  it('waits for completion and returns two log lines', async () => {
    const inProgressStatus = makeStatus({ inProgress: true });
    const completedStatus = makeStatus({ inProgress: false });
    const mockFn = jest.fn()
      .mockResolvedValueOnce(inProgressStatus) // initial check (waitForCompletion=false)
      .mockResolvedValueOnce(completedStatus);  // wait call (waitForCompletion=true)
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    const result = await waitForFetchApiSync('my-guid');

    expect(result.status).toBe(completedStatus);
    expect(result.logLines).toHaveLength(2);
  });

  it('calls API with waitForCompletion=true on second call', async () => {
    const mockFn = jest.fn()
      .mockResolvedValueOnce(makeStatus({ inProgress: true }))
      .mockResolvedValueOnce(makeStatus({ inProgress: false }));
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    await waitForFetchApiSync('my-guid', 'fetch');

    expect(mockFn).toHaveBeenNthCalledWith(2, 'my-guid', 'fetch', true);
  });

  it('suppresses console.log when silent=true but still returns logLines', async () => {
    const mockFn = jest.fn()
      .mockResolvedValueOnce(makeStatus({ inProgress: true }))
      .mockResolvedValueOnce(makeStatus({ inProgress: false }));
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));
    const consoleSpy = jest.spyOn(console, 'log');

    const result = await waitForFetchApiSync('my-guid', 'fetch', true);

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(result.logLines).toHaveLength(2);
  });

  it('outputs to console.log when silent=false', async () => {
    const mockFn = jest.fn()
      .mockResolvedValueOnce(makeStatus({ inProgress: true }))
      .mockResolvedValueOnce(makeStatus({ inProgress: false }));
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await waitForFetchApiSync('my-guid', 'fetch', false);

    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('uses preview mode when specified', async () => {
    const mockFn = jest.fn()
      .mockResolvedValueOnce(makeStatus({ inProgress: true }))
      .mockResolvedValueOnce(makeStatus({ inProgress: false }));
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(mockFn));

    await waitForFetchApiSync('my-guid', 'preview');

    expect(mockFn).toHaveBeenNthCalledWith(1, 'my-guid', 'preview', false);
    expect(mockFn).toHaveBeenNthCalledWith(2, 'my-guid', 'preview', true);
  });
});
