import { resetState, state } from "core/state";

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-models"),
  })),
}));

jest.mock("lib/shared/get-all-channels", () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: "website" }]),
}));

import { downloadAllModels } from "lib/downloaders/download-models";

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    changeDetectionSummary: jest.fn(),
    model: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
  };
}

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── downloadAllModels ────────────────────────────────────────────────────────

describe("downloadAllModels", () => {
  describe("guard clause: API propagates error", () => {
    it("throws when getContentModules rejects", async () => {
      // download-models.ts calls logger.startTimer() before the API, so provide a mock logger
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockRejectedValue(new Error("Model API error")),
          getPageModules: jest.fn().mockResolvedValue([]),
        },
      });

      await expect(downloadAllModels("test-guid-u")).rejects.toThrow("Model API error");
    });

    it("throws when getPageModules rejects", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockResolvedValue([]),
          getPageModules: jest.fn().mockRejectedValue(new Error("Page modules error")),
        },
      });

      await expect(downloadAllModels("test-guid-u")).rejects.toThrow("Page modules error");
    });
  });

  describe("empty models list", () => {
    it("returns without error when both model lists are empty", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockResolvedValue([]),
          getPageModules: jest.fn().mockResolvedValue([]),
        },
      });

      await expect(downloadAllModels("test-guid-u")).resolves.toBeUndefined();
    });
  });

  describe("download flow", () => {
    it("calls getContentModel for each downloadable model", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const modelSummary = { id: 42, lastModifiedDate: "2025-01-01T00:00:00Z" };
      const modelDetails = { id: 42, referenceName: "blogPost", fields: [] };
      const getContentModel = jest.fn().mockResolvedValue(modelDetails);

      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockResolvedValue([modelSummary]),
          getPageModules: jest.fn().mockResolvedValue([]),
          getContentModel,
        },
      });

      await downloadAllModels("test-guid-u");

      expect(getContentModel).toHaveBeenCalledWith(42, "test-guid-u");
      expect(mockLogger.model.downloaded).toHaveBeenCalledWith(modelDetails);
    });

    it("records a model error when getContentModel returns null", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const modelSummary = { id: 10, lastModifiedDate: "2025-01-01T00:00:00Z" };

      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockResolvedValue([modelSummary]),
          getPageModules: jest.fn().mockResolvedValue([]),
          getContentModel: jest.fn().mockResolvedValue(null),
        },
      });

      await downloadAllModels("test-guid-u");

      expect(mockLogger.model.error).toHaveBeenCalled();
    });

    it("calls endTimer and summary after processing", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const modelSummary = { id: 5, lastModifiedDate: "2025-01-01T00:00:00Z" };
      const modelDetails = { id: 5, referenceName: "article", fields: [] };
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        modelMethods: {
          getContentModules: jest.fn().mockResolvedValue([modelSummary]),
          getPageModules: jest.fn().mockResolvedValue([]),
          getContentModel: jest.fn().mockResolvedValue(modelDetails),
        },
      });

      await downloadAllModels("test-guid-u");

      expect(mockLogger.endTimer).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith("pull", 1, 0, 0);
    });
  });
});
