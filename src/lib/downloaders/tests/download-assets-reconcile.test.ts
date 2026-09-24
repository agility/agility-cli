import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, state } from "core/state";
import { getAssetFilePath } from "lib/assets/asset-utils";

jest.mock("lib/shared/get-all-channels", () => ({ getAllChannels: jest.fn().mockResolvedValue([{ channel: "website" }]) }));

let tmp: string;
jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn((folder?: string) => (folder ? path.join(tmp, folder) : tmp)),
    downloadFile: jest.fn().mockResolvedValue({ headers: {} }),
  })),
}));

import { downloadAllAssets } from "lib/downloaders/download-assets";

function makeMockLogger() {
  return {
    startTimer: jest.fn(), endTimer: jest.fn(), summary: jest.fn(), info: jest.fn(), warning: jest.fn(), error: jest.fn(),
    changeDetectionSummary: jest.fn(),
    asset: { downloaded: jest.fn(), skipped: jest.fn(), error: jest.fn() },
  };
}

const GHOST_URL = "https://cdn.example.com/inst/assets/images/ghost.png";
const LIVE = { mediaID: 1, fileName: "live.png", originUrl: "https://cdn.example.com/inst/assets/images/live.png", dateModified: "2025-01-01T00:00:00" };

function seedCache() {
  const assets = path.join(tmp, "assets");
  fs.mkdirSync(assets, { recursive: true });
  // ghost asset: metadata JSON at the root + its binary under the derived path
  fs.writeFileSync(path.join(assets, "99.json"), JSON.stringify({ mediaID: 99, originUrl: GHOST_URL }));
  const ghostBinary = path.join(assets, getAssetFilePath(GHOST_URL));
  fs.mkdirSync(path.dirname(ghostBinary), { recursive: true });
  fs.writeFileSync(ghostBinary, "png");
  // stale paged dump from an earlier, longer listing
  fs.mkdirSync(path.join(assets, "json"), { recursive: true });
  fs.writeFileSync(path.join(assets, "json", "5.json"), "{}");
  return { assets, ghostBinary };
}

beforeEach(() => {
  resetState();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agility-asset-ghost-"));
  state.guidLocaleMap.set("test-guid-u", ["en-us"]);
  jest.spyOn(require("core/state"), "getLoggerForGuid").mockReturnValue(makeMockLogger());
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("downloadAllAssets — removes local assets deleted upstream (PROD-2614)", () => {
  it("deletes the ghost's metadata JSON, its binary and stale page dumps once the full list is in hand", async () => {
    const { assets, ghostBinary } = seedCache();
    jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
      assetMethods: { getMediaList: jest.fn().mockResolvedValue({ totalCount: 1, assetMedias: [LIVE] }) },
    });

    await downloadAllAssets("test-guid-u");

    expect(fs.existsSync(path.join(assets, "99.json"))).toBe(false);
    expect(fs.existsSync(ghostBinary)).toBe(false);
    expect(fs.existsSync(path.join(assets, "json", "5.json"))).toBe(false);
  });

  it("does NOT delete anything when the collected list is shorter than totalCount", async () => {
    const { assets, ghostBinary } = seedCache();
    jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
      // totalCount says 600 but the (mocked) pages only ever return one asset
      assetMethods: { getMediaList: jest.fn().mockResolvedValue({ totalCount: 600, assetMedias: [LIVE] }) },
    });

    await downloadAllAssets("test-guid-u");

    expect(fs.existsSync(path.join(assets, "99.json"))).toBe(true);
    expect(fs.existsSync(ghostBinary)).toBe(true);
  });
});
