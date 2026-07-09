import { resetState, setState, state } from "core/state";
import * as fs from "fs";

const mockDataFolderPath = "/tmp/agility-mock-assets";

let exportFilesMock: jest.Mock;
let downloadFileMock: jest.Mock;

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: exportFilesMock,
    downloadFile: downloadFileMock,
    getDataFolderPath: jest.fn().mockReturnValue(mockDataFolderPath),
  })),
}));

jest.mock("lib/shared/get-all-channels", () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: "website" }]),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import { downloadAllAssets } from "lib/downloaders/download-assets";

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

function makeAsset(
  overrides: Partial<{ mediaID: number; originUrl: string; dateModified: string; fileName: string; size: number }> = {}
) {
  const fileName = overrides.fileName ?? "file1.jpg";
  return {
    mediaID: 1,
    originUrl: `https://cdn.agilitycms.com/guid/assets/${fileName}`,
    dateModified: "2024-01-01T00:00:00.000Z",
    fileName,
    size: 1024,
    ...overrides,
  };
}

const UNCHANGED_DATE = "2024-01-01T00:00:00.000Z";

const jsonPathFor = (mediaID: number) => `${mockDataFolderPath}/${mediaID}.json`;
const binaryPathFor = (fileName: string) => `${mockDataFolderPath}/${fileName}`;

beforeEach(() => {
  resetState();
  exportFilesMock = jest.fn();
  downloadFileMock = jest.fn();

  (fs.existsSync as jest.Mock).mockReset();
  (fs.readFileSync as jest.Mock).mockReset();

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("downloadAllAssets", () => {
  describe("guard clause: no logger for GUID", () => {
    it("returns early without throwing when getLoggerForGuid returns null", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: { getMediaList: jest.fn() },
      });

      await expect(downloadAllAssets("test-guid-u")).resolves.toBeUndefined();
    });

    it("logs a warning when no logger is found for the GUID", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(null);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: { getMediaList: jest.fn() },
      });

      await downloadAllAssets("test-guid-u");

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("No logger found for GUID test-guid-u"));
    });
  });

  describe("guard clause: logger present, API propagates error", () => {
    it("throws when the API client call rejects", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockRejectedValue(new Error("API unavailable")),
        },
      });

      await expect(downloadAllAssets("test-guid-u")).rejects.toThrow("API unavailable");
    });
  });

  describe("empty assets list", () => {
    it("returns without error when API returns zero assets", async () => {
      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 0, assetMedias: [] }),
        },
      });

      await expect(downloadAllAssets("test-guid-u")).resolves.toBeUndefined();
    });
  });

  describe("PROD-2201: missing-binary re-download (skip-decision fix)", () => {
    it("re-downloads an asset whose metadata is unchanged but binary is missing on disk", async () => {
      const asset = makeAsset({ mediaID: 1, dateModified: UNCHANGED_DATE, fileName: "file1.jpg" });
      const logger = makeMockLogger();

      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(logger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 1, assetMedias: [asset] }),
        },
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === jsonPathFor(asset.mediaID)) return true; // metadata JSON present
        if (filePath === binaryPathFor(asset.fileName)) return false; // binary missing
        return false;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ dateModified: UNCHANGED_DATE }));

      downloadFileMock.mockResolvedValue(true);

      await downloadAllAssets("test-guid-u");

      expect(downloadFileMock).toHaveBeenCalledWith(asset.originUrl, binaryPathFor(asset.fileName));
      expect(logger.asset.skipped).not.toHaveBeenCalled();
    });

    it("skips an asset whose metadata is unchanged and binary is present on disk", async () => {
      const asset = makeAsset({ mediaID: 2, dateModified: UNCHANGED_DATE, fileName: "file2.jpg" });
      const logger = makeMockLogger();

      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(logger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 1, assetMedias: [asset] }),
        },
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === jsonPathFor(asset.mediaID)) return true; // metadata JSON present
        if (filePath === binaryPathFor(asset.fileName)) return true; // binary present
        return false;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ dateModified: UNCHANGED_DATE }));

      await downloadAllAssets("test-guid-u");

      expect(downloadFileMock).not.toHaveBeenCalled();
      expect(logger.asset.skipped).toHaveBeenCalledWith(asset);
    });
  });

  describe("PROD-2201: metadata-written-after-binary (ordering fix)", () => {
    it("does not write metadata JSON when downloadFile fails", async () => {
      const asset = makeAsset({ mediaID: 3, fileName: "file3.jpg" });
      const logger = makeMockLogger();

      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(logger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 1, assetMedias: [asset] }),
        },
      });

      // Local metadata doesn't exist yet, so the asset is treated as a new file
      // and always queued for download regardless of dateModified/binary checks.
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      downloadFileMock.mockResolvedValue(false);

      await downloadAllAssets("test-guid-u");

      expect(downloadFileMock).toHaveBeenCalledWith(asset.originUrl, binaryPathFor(asset.fileName));
      expect(exportFilesMock).not.toHaveBeenCalledWith("assets", asset.mediaID.toString(), asset);
      expect(logger.asset.error).toHaveBeenCalled();
    });

    it("writes metadata JSON only after downloadFile resolves successfully", async () => {
      const asset = makeAsset({ mediaID: 4, fileName: "file4.jpg" });
      const logger = makeMockLogger();

      jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(logger);
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        assetMethods: {
          getMediaList: jest.fn().mockResolvedValue({ totalCount: 1, assetMedias: [asset] }),
        },
      });

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const callOrder: string[] = [];
      downloadFileMock.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        callOrder.push("downloadFile");
        return true;
      });
      exportFilesMock.mockImplementation((...args: any[]) => {
        if (args[0] === "assets" && args[1] === asset.mediaID.toString()) {
          callOrder.push("exportFiles");
        }
      });

      await downloadAllAssets("test-guid-u");

      expect(exportFilesMock).toHaveBeenCalledWith("assets", asset.mediaID.toString(), asset);
      expect(callOrder).toEqual(["downloadFile", "exportFiles"]);
      expect(logger.asset.downloaded).toHaveBeenCalledWith(asset);
    });
  });
});
