import { resetState, state } from "core/state";

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-containers"),
  })),
}));

import { downloadAllContainers } from "lib/downloaders/download-containers";

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    changeDetectionSummary: jest.fn(),
    container: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
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

// ─── downloadAllContainers guard clause ───────────────────────────────────────

describe("downloadAllContainers", () => {
  describe("guard clause: no logger for GUID", () => {
    it("returns early without throwing when getLoggerForGuid returns null", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        containerMethods: { getContainerList: jest.fn() },
      });

      await expect(downloadAllContainers("test-guid-u")).resolves.toBeUndefined();
    });

    it("logs a warning when no logger is found", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        containerMethods: { getContainerList: jest.fn() },
      });

      await downloadAllContainers("test-guid-u");

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("No logger found for GUID test-guid-u"));
    });
  });

  describe("guard clause: logger present, API propagates error", () => {
    it("throws when containerMethods.getContainerList rejects", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        containerMethods: {
          getContainerList: jest.fn().mockRejectedValue(new Error("Container API error")),
        },
      });

      await expect(downloadAllContainers("test-guid-u")).rejects.toThrow("Container API error");
    });
  });

  describe("empty containers list", () => {
    it("returns early without error when API returns empty array", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        containerMethods: {
          getContainerList: jest.fn().mockResolvedValue([]),
        },
      });

      await expect(downloadAllContainers("test-guid-u")).resolves.toBeUndefined();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("No containers found"));
    });
  });
});
