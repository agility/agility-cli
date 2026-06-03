import { resetState, setState, state, getApiKeysForGuid, getLoggerForGuid } from "core/state";

// Mock only the functions that hit the network or keychain
jest.mock("lib/shared/get-all-channels", () => ({
  getAllChannels: jest.fn().mockResolvedValue([{ channel: "website" }]),
}));

jest.mock("lib/downloaders/sync-token-handler", () => ({
  handleSyncToken: jest.fn().mockResolvedValue(false),
}));

jest.mock("core/auth", () => ({
  Auth: jest.fn().mockImplementation(() => ({
    determineFetchUrl: jest.fn().mockReturnValue("https://api.aglty.io"),
  })),
}));

jest.mock("@agility/content-sync", () => ({
  getSyncClient: jest.fn().mockReturnValue({
    runSync: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the store-interface-filesystem (CJS require'd inside source)
jest.mock(
  "lib/downloaders/store-interface-filesystem",
  () => ({
    initializeProgress: jest.fn(),
    getAndClearSavedItemStats: jest.fn().mockReturnValue({
      summary: { totalItems: 0 },
      itemsByType: {},
      recentActivity: [],
    }),
  }),
  { virtual: true }
);

jest.mock("core/fileOperations", () => ({
  fileOperations: jest.fn().mockImplementation(() => ({
    createFolder: jest.fn(),
    exportFiles: jest.fn(),
    getDataFolderPath: jest.fn().mockReturnValue("/tmp/agility-mock-sync"),
    getDataFilePath: jest.fn().mockReturnValue("/tmp/agility-mock-sync/state/sync.json"),
  })),
}));

// Spy on getApiKeysForGuid and getLoggerForGuid from actual state module
jest.spyOn(require("core/state"), "getApiKeysForGuid").mockReturnValue({
  previewKey: "mock-preview-key",
  fetchKey: "mock-fetch-key",
});

import { downloadAllSyncSDK, downloadSyncSDKByLocaleAndChannel } from "lib/downloaders/download-sync-sdk";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── downloadSyncSDKByLocaleAndChannel ────────────────────────────────────────

describe("downloadSyncSDKByLocaleAndChannel", () => {
  beforeEach(() => {
    state.guidLocaleMap.set("test-guid-u", ["en-us"]);
    // Re-apply API key mock after restoreAllMocks
    jest.spyOn(require("core/state"), "getApiKeysForGuid").mockReturnValue({
      previewKey: "mock-preview-key",
      fetchKey: "mock-fetch-key",
    });
  });

  it("completes without throwing given valid guid, channel, and locale", async () => {
    await expect(downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us")).resolves.not.toThrow();
  });

  it("calls getSyncClient with the expected guid", async () => {
    const agilitySync = require("@agility/content-sync");
    agilitySync.getSyncClient.mockClear();

    await downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us");

    expect(agilitySync.getSyncClient).toHaveBeenCalledWith(expect.objectContaining({ guid: "test-guid-u" }));
  });

  it("calls syncClient.runSync()", async () => {
    const agilitySync = require("@agility/content-sync");
    const mockRunSync = jest.fn().mockResolvedValue(undefined);
    agilitySync.getSyncClient.mockReturnValue({ runSync: mockRunSync });

    await downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us");

    expect(mockRunSync).toHaveBeenCalledTimes(1);
  });

  it("passes isPreview=true in the agilityConfig", async () => {
    const agilitySync = require("@agility/content-sync");
    agilitySync.getSyncClient.mockClear();

    await downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us");

    expect(agilitySync.getSyncClient).toHaveBeenCalledWith(expect.objectContaining({ isPreview: true }));
  });

  it("configures the store with an interface and options", async () => {
    const agilitySync = require("@agility/content-sync");
    agilitySync.getSyncClient.mockClear();

    await downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us");

    const calledConfig = agilitySync.getSyncClient.mock.calls[agilitySync.getSyncClient.mock.calls.length - 1][0];
    expect(calledConfig).toHaveProperty("store");
    expect(calledConfig.store).toHaveProperty("interface");
    expect(calledConfig.store).toHaveProperty("options");
  });

  it("propagates errors from runSync", async () => {
    const agilitySync = require("@agility/content-sync");
    agilitySync.getSyncClient.mockReturnValue({
      runSync: jest.fn().mockRejectedValue(new Error("sync failed")),
    });

    await expect(downloadSyncSDKByLocaleAndChannel("test-guid-u", "website", "en-us")).rejects.toThrow("sync failed");
  });
});

// ─── downloadAllSyncSDK ───────────────────────────────────────────────────────

describe("downloadAllSyncSDK", () => {
  beforeEach(() => {
    jest.spyOn(require("core/state"), "getApiKeysForGuid").mockReturnValue({
      previewKey: "mock-preview-key",
      fetchKey: "mock-fetch-key",
    });
  });

  it("completes without throwing when guidLocaleMap has entries", async () => {
    state.guidLocaleMap.set("test-guid-u", ["en-us"]);

    await expect(downloadAllSyncSDK("test-guid-u")).resolves.not.toThrow();
  });

  it("launches one download per channel×locale combination", async () => {
    const { getAllChannels } = require("lib/shared/get-all-channels");
    getAllChannels.mockResolvedValue([{ channel: "website" }, { channel: "mobile" }]);
    state.guidLocaleMap.set("test-guid-u", ["en-us", "fr-fr"]);

    const agilitySync = require("@agility/content-sync");
    const mockRunSync = jest.fn().mockResolvedValue(undefined);
    agilitySync.getSyncClient.mockReturnValue({ runSync: mockRunSync });

    await downloadAllSyncSDK("test-guid-u");

    // 2 channels × 2 locales = 4 runSync calls
    expect(mockRunSync).toHaveBeenCalledTimes(4);
  });
});
