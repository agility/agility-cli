import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-asset-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-guid-u", targetGuid: "tgt-guid-u", token: "test-token" });
  initializeGuidLogger("src-guid-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMedia(overrides: Record<string, any> = {}): any {
  return {
    mediaID: 1,
    fileName: "test.jpg",
    originUrl: "https://example.com/assets/test.jpg",
    originKey: "/assets/test.jpg",
    mediaGroupingID: 0,
    mediaGroupingName: null,
    ...overrides,
  };
}

function makeMockApiClient(overrides: Record<string, any> = {}): any {
  return {
    assetMethods: {
      getDefaultContainer: jest.fn().mockResolvedValue({ containerID: 1, name: "default" }),
      getGalleryByName: jest.fn().mockResolvedValue(null),
      ...overrides,
    },
  };
}

// ─── pushAssets — empty sourceData guard ─────────────────────────────────────

describe("pushAssets — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty array", async () => {
    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([], []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns success with zeros when sourceData is null/undefined coerced to empty", async () => {
    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets(null as any, []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });

  it('logs "No assets found" when sourceData is empty', async () => {
    const consoleSpy = jest.spyOn(console, "log");
    const { pushAssets } = await import("../asset-pusher");
    await pushAssets([], []);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No assets"));
  });
});

// ─── pushAssets — API error fetching default container ───────────────────────

describe("pushAssets — API error on getDefaultContainer", () => {
  it("returns error status when getDefaultContainer throws", async () => {
    const mockApiClient = makeMockApiClient({
      getDefaultContainer: jest.fn().mockRejectedValue(new Error("Network error")),
    });
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(mockApiClient);

    const { pushAssets } = await import("../asset-pusher");
    const media = makeMedia();

    const result = await pushAssets([media], []);

    expect(result.status).toBe("error");
    expect(result.successful).toBe(0);
  });

  it("calls console.error when getDefaultContainer throws", async () => {
    const consoleSpy = jest.spyOn(console, "error");
    const mockApiClient = makeMockApiClient({
      getDefaultContainer: jest.fn().mockRejectedValue(new Error("timeout")),
    });
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(mockApiClient);

    const { pushAssets } = await import("../asset-pusher");
    await pushAssets([makeMedia()], []);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error fetching default asset container"),
      expect.any(String)
    );
  });
});

// ─── pushAssets — skip when asset exists in target by originKey ───────────────

describe("pushAssets — skip when asset exists in target by originKey", () => {
  it("skips asset that matches target by originKey (no mapping exists)", async () => {
    const mockApiClient = makeMockApiClient();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(mockApiClient);

    const { pushAssets } = await import("../asset-pusher");

    const originKey = "/assets/shared.jpg";
    const sourceAsset = makeMedia({ originKey, mediaID: 10 });
    const targetAsset = makeMedia({ originKey, mediaID: 20 });

    const result = await pushAssets([sourceAsset], [targetAsset]);

    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// ─── pushAssets — onProgress callback ────────────────────────────────────────

describe("pushAssets — onProgress callback", () => {
  it("calls onProgress once per asset processed", async () => {
    // Asset will fail (no local file), but onProgress still fires
    const mockApiClient = makeMockApiClient();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(mockApiClient);

    const { pushAssets } = await import("../asset-pusher");

    const onProgress = jest.fn();
    const media = makeMedia({
      originUrl: "https://example.com/nonexistent-file.jpg",
      originKey: "/nonexistent-file.jpg",
    });

    await pushAssets([media], [], onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1, expect.any(String));
  });

  it("calls onProgress with correct total count for multiple assets", async () => {
    const mockApiClient = makeMockApiClient();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(mockApiClient);

    const { pushAssets } = await import("../asset-pusher");

    const onProgress = jest.fn();
    const originKey1 = "/a1.jpg";
    const originKey2 = "/a2.jpg";
    const src1 = makeMedia({ mediaID: 1, originKey: originKey1, originUrl: "https://example.com/a1.jpg" });
    const src2 = makeMedia({ mediaID: 2, originKey: originKey2, originUrl: "https://example.com/a2.jpg" });

    // Put matching assets in target so they get skipped
    const tgt1 = makeMedia({ mediaID: 11, originKey: originKey1 });
    const tgt2 = makeMedia({ mediaID: 12, originKey: originKey2 });

    await pushAssets([src1, src2], [tgt1, tgt2], onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    // Second call should have total = 2
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, expect.any(String));
  });
});

// ─── pushAssets — result shape ────────────────────────────────────────────────

describe("pushAssets — result shape", () => {
  it("returns status, successful, failed, skipped fields", async () => {
    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([], []);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });
});
