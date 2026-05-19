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

import { publishPage } from 'lib/publishers/page-publisher';

// ─── publishPage ──────────────────────────────────────────────────────────────

describe('publishPage', () => {
  describe('guard clause: no API client', () => {
    it('returns success:false when getApiClient throws (no token set)', async () => {
      const result = await publishPage(1, 'en-us');
      expect(result.success).toBe(false);
      expect(result.pageId).toBe(1);
      expect(result.error).toBeDefined();
    });
  });

  describe('guard clause: targetGuid array is empty', () => {
    it('returns success:false with error message when targetGuid is []', async () => {
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: { publishPage: jest.fn() },
      });

      const result = await publishPage(15, 'en-us');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Target GUID not available in state');
    });
  });

  describe('guard clause: empty locale', () => {
    it('returns success:false when locale is an empty string', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: { publishPage: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishPage(20, '');
      expect(result.success).toBe(false);
      expect(result.pageId).toBe(20);
      expect(result.error).toContain('Locale');
    });
  });

  describe('happy path', () => {
    it('returns success:true with original pageId when API resolves', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: { publishPage: jest.fn().mockResolvedValue({ ok: true }) },
      });

      const result = await publishPage(400, 'en-us');
      expect(result.success).toBe(true);
      expect(result.pageId).toBe(400);
      expect(result.error).toBeUndefined();
    });

    it('calls pageMethods.publishPage with (pageId, targetGuid[0], locale)', async () => {
      setState({ targetGuid: 'page-target' });
      const mockPublish = jest.fn().mockResolvedValue({});
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: { publishPage: mockPublish },
      });

      await publishPage(77, 'es-es');
      expect(mockPublish).toHaveBeenCalledWith(77, 'page-target', 'es-es');
    });
  });

  describe('API error handling', () => {
    it('returns success:false with the error message when API rejects', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: {
          publishPage: jest.fn().mockRejectedValue(new Error('Page publish failed')),
        },
      });

      const result = await publishPage(13, 'en-us');
      expect(result.success).toBe(false);
      expect(result.pageId).toBe(13);
      expect(result.error).toBe('Page publish failed');
    });

    it('returns "Unknown publishing error" when error has no message', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: {
          publishPage: jest.fn().mockRejectedValue({}),
        },
      });

      const result = await publishPage(14, 'en-us');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown publishing error');
    });
  });

  describe('return shape', () => {
    it.each([1, 150, 77777])('preserves pageId %i as a number in the result', async (id) => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        pageMethods: { publishPage: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishPage(id, 'en-us');
      expect(result.pageId).toBe(id);
      expect(typeof result.pageId).toBe('number');
    });
  });
});
