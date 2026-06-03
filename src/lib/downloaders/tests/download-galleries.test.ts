import { resetState, state } from 'core/state';

jest.mock('core/fileOperations', () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    readJsonFile: jest.fn().mockReturnValue(null),
    getDataFolderPath: jest.fn().mockReturnValue('/tmp/agility-mock-galleries'),
  })),
}));

jest.mock('lib/shared/get-all-channels', () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: 'website' }]),
}));

import { downloadAllGalleries } from 'lib/downloaders/download-galleries';

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    gallery: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
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

// ─── downloadAllGalleries guard clause ────────────────────────────────────────

describe('downloadAllGalleries', () => {
  describe('guard clause: no logger for GUID', () => {
    it('returns early without throwing when getLoggerForGuid returns null', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(null);
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: { getGalleries: jest.fn() },
      });

      await expect(downloadAllGalleries('test-guid-u')).resolves.toBeUndefined();
    });

    it('logs a warning when no logger is found', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(null);
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: { getGalleries: jest.fn() },
      });

      await downloadAllGalleries('test-guid-u');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No logger found for GUID test-guid-u')
      );
    });
  });

  describe('with logger present', () => {
    it('returns early without throwing when getGalleries throws (graceful inner error)', async () => {
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(makeMockLogger());
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getGalleries: jest.fn().mockRejectedValue(new Error('Gallery API error')),
        },
      });

      // The function has an inner try-catch that catches the getGalleries error and returns
      await expect(downloadAllGalleries('test-guid-u')).resolves.toBeUndefined();
    });

    it('processes an empty gallery list without error', async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(mockLogger);
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getGalleries: jest.fn().mockResolvedValue({ assetMediaGroupings: [] }),
        },
      });

      await expect(downloadAllGalleries('test-guid-u')).resolves.toBeUndefined();
      expect(mockLogger.summary).toHaveBeenCalledWith('pull', 0, 0, 0);
    });

    it('downloads a gallery that does not exist locally', async () => {
      const { fileOperations } = require('core/fileOperations');
      const mockLogger = makeMockLogger();
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(mockLogger);

      const mockGallery = { mediaGroupingID: 1, name: 'Gallery One', modifiedOn: '2025-01-01T00:00:00Z' };
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getGalleries: jest.fn().mockResolvedValue({ assetMediaGroupings: [mockGallery] }),
        },
      });
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: jest.fn(),
        readJsonFile: jest.fn().mockReturnValue(null), // no local copy
        getDataFolderPath: jest.fn().mockReturnValue('/tmp/agility-mock-galleries'),
      }));

      await downloadAllGalleries('test-guid-u');

      expect(mockLogger.gallery.downloaded).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith('pull', 1, 0, 0);
    });

    it('skips a gallery that is up to date locally', async () => {
      const { fileOperations } = require('core/fileOperations');
      const mockLogger = makeMockLogger();
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(mockLogger);

      const sameDate = '2025-01-01T00:00:00Z';
      const mockGallery = { mediaGroupingID: 2, name: 'Gallery Two', modifiedOn: sameDate };
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getGalleries: jest.fn().mockResolvedValue({ assetMediaGroupings: [mockGallery] }),
        },
      });
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: jest.fn(),
        readJsonFile: jest.fn().mockReturnValue({ mediaGroupingID: 2, modifiedOn: sameDate }),
        getDataFolderPath: jest.fn().mockReturnValue('/tmp/agility-mock-galleries'),
      }));

      await downloadAllGalleries('test-guid-u');

      expect(mockLogger.gallery.skipped).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith('pull', 0, 1, 0);
    });

    it('downloads a gallery when remote is newer than local', async () => {
      const { fileOperations } = require('core/fileOperations');
      const mockLogger = makeMockLogger();
      jest.spyOn(require('core/state'), 'getLoggerForGuid').mockReturnValue(mockLogger);

      const remoteDate = '2025-06-01T00:00:00Z';
      const localDate = '2025-01-01T00:00:00Z';
      const mockGallery = { mediaGroupingID: 3, name: 'Gallery Three', modifiedOn: remoteDate };
      jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
        assetMethods: {
          getGalleries: jest.fn().mockResolvedValue({ assetMediaGroupings: [mockGallery] }),
        },
      });
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: jest.fn(),
        readJsonFile: jest.fn().mockReturnValue({ mediaGroupingID: 3, modifiedOn: localDate }),
        getDataFolderPath: jest.fn().mockReturnValue('/tmp/agility-mock-galleries'),
      }));

      await downloadAllGalleries('test-guid-u');

      expect(mockLogger.gallery.downloaded).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith('pull', 1, 0, 0);
    });
  });
});
