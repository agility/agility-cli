import { resetState, setState } from 'core/state';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

import { publishBatch } from 'lib/publishers/batch-publisher';

// ─── publishBatch ─────────────────────────────────────────────────────────────

describe('publishBatch', () => {
  describe('guard clause: no API client', () => {
    it('returns success:false with an error message when getApiClient throws', async () => {
      // resetState leaves token null and mgmtApiOptions undefined → getApiClient throws
      const result = await publishBatch(42);
      expect(result.success).toBe(false);
      expect(result.batchId).toBe('42');
      expect(result.error).toBeDefined();
    });
  });

  describe('guard clause: targetGuid array is empty', () => {
    it('returns success:false with error message when targetGuid is []', async () => {
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: { publishBatch: jest.fn() },
      });

      const result = await publishBatch(10);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Target GUID not available in state');
    });
  });

  describe('happy path', () => {
    it('returns success:true with stringified batchId when API resolves', async () => {
      setState({ targetGuid: 'test-guid-u' });
      const mockPublishBatch = jest.fn().mockResolvedValue({ status: 'ok' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: { publishBatch: mockPublishBatch },
      });

      const result = await publishBatch(99);
      expect(result.success).toBe(true);
      expect(result.batchId).toBe('99');
      expect(result.error).toBeUndefined();
    });

    it('calls batchMethods.publishBatch with correct batchId, targetGuid, and true', async () => {
      setState({ targetGuid: 'my-guid' });
      const mockPublishBatch = jest.fn().mockResolvedValue({});
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: { publishBatch: mockPublishBatch },
      });

      await publishBatch(7);
      expect(mockPublishBatch).toHaveBeenCalledWith(7, 'my-guid', true);
    });
  });

  describe('API error handling', () => {
    it('returns success:false with the error message when API rejects', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: {
          publishBatch: jest.fn().mockRejectedValue(new Error('Batch API failure')),
        },
      });

      const result = await publishBatch(5);
      expect(result.success).toBe(false);
      expect(result.batchId).toBe('5');
      expect(result.error).toBe('Batch API failure');
    });

    it('returns "Unknown batch publishing error" when error has no message', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: {
          publishBatch: jest.fn().mockRejectedValue({}),
        },
      });

      const result = await publishBatch(3);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown batch publishing error');
    });
  });

  describe('return shape', () => {
    it.each([1, 100, 99999])('always returns batchId as string for input %i', async (id) => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        batchMethods: { publishBatch: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishBatch(id);
      expect(result.batchId).toBe(String(id));
    });
  });
});
