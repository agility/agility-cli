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

import { publishContentList } from 'lib/publishers/content-list-publisher';

// ─── publishContentList ───────────────────────────────────────────────────────

describe('publishContentList', () => {
  describe('guard clause: no API client', () => {
    it('returns success:false when getApiClient throws (no token set)', async () => {
      const result = await publishContentList(1, 'en-us');
      expect(result.success).toBe(false);
      expect(result.contentListId).toBe(1);
      expect(result.error).toBeDefined();
    });
  });

  describe('guard clause: targetGuid array is empty', () => {
    it('returns success:false with error message when targetGuid is []', async () => {
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: { publishContent: jest.fn() },
      });

      const result = await publishContentList(20, 'en-us');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Target GUID not available in state');
    });
  });

  describe('guard clause: empty locale', () => {
    it('returns success:false when locale is an empty string', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishContentList(30, '');
      expect(result.success).toBe(false);
      expect(result.contentListId).toBe(30);
      expect(result.error).toContain('Locale');
    });
  });

  describe('happy path', () => {
    it('returns success:true with original contentListId when API resolves', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({ ok: true }) },
      });

      const result = await publishContentList(300, 'en-us');
      expect(result.success).toBe(true);
      expect(result.contentListId).toBe(300);
      expect(result.error).toBeUndefined();
    });

    it('calls contentMethods.publishContent with (contentListId, targetGuid[0], locale)', async () => {
      setState({ targetGuid: 'list-target' });
      const mockPublish = jest.fn().mockResolvedValue({});
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: { publishContent: mockPublish },
      });

      await publishContentList(55, 'de-de');
      expect(mockPublish).toHaveBeenCalledWith(55, 'list-target', 'de-de');
    });
  });

  describe('API error handling', () => {
    it('returns success:false with the error message when API rejects', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: {
          publishContent: jest.fn().mockRejectedValue(new Error('List publish failed')),
        },
      });

      const result = await publishContentList(9, 'en-us');
      expect(result.success).toBe(false);
      expect(result.contentListId).toBe(9);
      expect(result.error).toBe('List publish failed');
    });

    it('returns "Unknown publishing error" when error has no message', async () => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: {
          publishContent: jest.fn().mockRejectedValue({}),
        },
      });

      const result = await publishContentList(11, 'en-us');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown publishing error');
    });
  });

  describe('return shape', () => {
    it.each([1, 250, 88888])('preserves contentListId %i as a number in the result', async (id) => {
      setState({ targetGuid: 'test-guid-u' });
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishContentList(id, 'en-us');
      expect(result.contentListId).toBe(id);
      expect(typeof result.contentListId).toBe('number');
    });
  });
});
