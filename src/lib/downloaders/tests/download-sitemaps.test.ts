import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, state } from "core/state";

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-sitemaps/sitemap.json"),
  })),
}));

jest.mock("lib/shared/get-all-channels", () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: "website" }]),
}));

import { downloadAllSitemaps } from "lib/downloaders/download-sitemaps";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMockLogger() {
  return {
    startTimer: jest.fn(),
    endTimer: jest.fn(),
    summary: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    sitemap: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
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

// ─── downloadAllSitemaps guard clause ─────────────────────────────────────────

describe("downloadAllSitemaps", () => {
  describe("guard clause: no logger for GUID", () => {
    it("returns early without throwing when getLoggerForGuid returns null", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: { getSitemap: jest.fn() },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllSitemaps("test-guid-u")).resolves.toBeUndefined();
    });

    it("logs a warning when no logger is found", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: { getSitemap: jest.fn() },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllSitemaps("test-guid-u");

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("No logger found for GUID test-guid-u"));
    });
  });

  describe("guard clause: API error propagates", () => {
    it("throws when getSitemap rejects", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getSitemap: jest.fn().mockRejectedValue(new Error("Sitemap API error")),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllSitemaps("test-guid-u")).rejects.toThrow("Sitemap API error");
    });
  });

  describe("empty sitemap", () => {
    it("returns without error and calls sitemap.skipped when getSitemap returns null", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getSitemap: jest.fn().mockResolvedValue(null),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllSitemaps("test-guid-u")).resolves.toBeUndefined();
      expect(mockLogger.sitemap.skipped).toHaveBeenCalled();
    });

    it("returns without error and calls sitemap.skipped when getSitemap returns an empty array", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getSitemap: jest.fn().mockResolvedValue([]),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await expect(downloadAllSitemaps("test-guid-u")).resolves.toBeUndefined();
      expect(mockLogger.sitemap.skipped).toHaveBeenCalled();
    });
  });

  describe("download decision: no local file", () => {
    it("calls sitemap.downloaded when no local file exists", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const sitemapFile = path.join(tmpDir, "sitemap-new.json");
      const { fileOperations } = require("core/fileOperations");
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: jest.fn(),
        // Return path to a non-existent file so getLocalSitemapInfo returns { exists: false }
        getDataFolderPath: jest.fn().mockReturnValue(sitemapFile),
      }));

      const mockSitemap = [{ lastModified: "2025-01-01", name: "website" }];
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getSitemap: jest.fn().mockResolvedValue(mockSitemap),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllSitemaps("test-guid-u");

      expect(mockLogger.sitemap.downloaded).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith("pull", 1, 0, 0);
    });
  });

  describe("download decision: local file is up to date", () => {
    it("calls sitemap.skipped when local file has same lastModified as remote", async () => {
      const mockLogger = makeMockLogger();
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(mockLogger);

      const sameDate = "2025-01-01T00:00:00Z";
      const sitemapFile = path.join(tmpDir, "sitemap-uptodate.json");
      // Write a local sitemap file with the same date
      fs.writeFileSync(sitemapFile, JSON.stringify({ lastModified: sameDate }));

      const { fileOperations } = require("core/fileOperations");
      fileOperations.mockImplementation(() => ({
        createFolder: jest.fn(),
        exportFiles: jest.fn(),
        getDataFolderPath: jest.fn().mockReturnValue(sitemapFile),
      }));

      const mockSitemap = [{ lastModified: sameDate, name: "website" }];
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        pageMethods: {
          getSitemap: jest.fn().mockResolvedValue(mockSitemap),
        },
      });
      state.guidLocaleMap.set("test-guid-u", ["en-us"]);

      await downloadAllSitemaps("test-guid-u");

      expect(mockLogger.sitemap.skipped).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalledWith("pull", 0, 1, 0);
    });
  });
});
