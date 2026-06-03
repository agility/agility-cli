import { resetState, state } from "core/state";

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-templates"),
  })),
}));

import { downloadAllTemplates } from "lib/downloaders/download-templates";

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    template: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
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

// ─── downloadAllTemplates ─────────────────────────────────────────────────────

describe("downloadAllTemplates", () => {
  describe("guard clause: API error propagates", () => {
    it("throws when getPageTemplates rejects", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getPageTemplates: jest.fn().mockRejectedValue(new Error("Templates API error")),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllTemplates("test-guid-u")).rejects.toThrow("Templates API error");
    });
  });

  describe("empty templates list", () => {
    it("calls template.skipped and returns when API returns empty array", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getPageTemplates: jest.fn().mockResolvedValue([]),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllTemplates("test-guid-u")).resolves.toBeUndefined();
      expect(mockLogger.template.skipped).toHaveBeenCalledWith(
        null,
        expect.stringContaining("No page templates found")
      );
    });
  });

  describe("download flow", () => {
    it("exports each template and calls template.downloaded", async () => {
      const { fileOperations } = require("core/fileOperations");
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const mockExportFiles = jest.fn();
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: mockExportFiles,
        getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-templates"),
      }));

      const templates = [
        { pageTemplateID: 1, name: "Default" },
        { pageTemplateID: 2, name: "Landing" },
      ];
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getPageTemplates: jest.fn().mockResolvedValue(templates),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllTemplates("test-guid-u");

      expect(mockExportFiles).toHaveBeenCalledTimes(2);
      expect(mockLogger.template.downloaded).toHaveBeenCalledTimes(2);
    });

    it("calls endTimer and summary after processing templates", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getPageTemplates: jest.fn().mockResolvedValue([{ pageTemplateID: 99, name: "Test" }]),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllTemplates("test-guid-u");

      expect(mockLogger.endTimer).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith("pull", 1, 0, 0);
    });

    it.each([
      { count: 1, label: "one template" },
      { count: 3, label: "three templates" },
    ])("calls template.downloaded $count time(s) for $label", async ({ count }) => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      const templates = Array.from({ length: count }, (_, i) => ({
        pageTemplateID: i + 1,
        name: `Template ${i + 1}`,
      }));
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getPageTemplates: jest.fn().mockResolvedValue(templates),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllTemplates("test-guid-u");

      expect(mockLogger.template.downloaded).toHaveBeenCalledTimes(count);
    });
  });
});
