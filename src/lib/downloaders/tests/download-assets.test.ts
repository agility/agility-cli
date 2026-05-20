import { resetState, setState, state } from 'core/state';

jest.mock('core/fileOperations', () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    downloadFile: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue('/tmp/agility-mock-assets'),
  })),
}));

jest.mock('lib/shared/get-all-channels', () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: 'website' }]),
}));

import { downloadAllAssets } from 'lib/downloaders/download-assets';

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    changeDetectionSummary: jest.fn(),
    asset: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
  };
}

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── downloadAllAssets guard clause ───────────────────────────────────────────

describe('downloadAllAssets', () => {
  describe('guard clause: no logger for GUID', () => {
    it('returns early without throwing when getLoggerForGuid returns null', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(null);
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: { getMediaList: jest.fn() },
      });

      await expect(downloadAllAssets('test-guid-u')).resolves.toBeUndefined();
    });

    it('logs a warning when no logger is found for the GUID', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(null);
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: { getMediaList: jest.fn() },
      });

      await downloadAllAssets('test-guid-u');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No logger found for GUID test-guid-u')
      );
    });
  });

  describe('guard clause: logger present, API propagates error', () => {
    it('throws when the API client call rejects', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(makeMockLogger());
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockRejectedValue(new Error('API unavailable')),
        },
      });

      await expect(downloadAllAssets('test-guid-u')).rejects.toThrow('API unavailable');
    });
  });

  describe('empty assets list', () => {
    it('returns without error when API returns zero assets', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(makeMockLogger());
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 0, assetMedias: [] }),
        },
      });

      await expect(downloadAllAssets('test-guid-u')).resolves.toBeUndefined();
    });
  });
});
