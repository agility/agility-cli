import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";
import { fileOperations } from "core/fileOperations";
import { getAssetFilePath } from "lib/shared";

jest.mock("axios", () => ({ post: jest.fn() }));
const axios = require("axios");

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-asset-retry-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test starts without the asset mapping an earlier test wrote.
  for (const entry of fs.readdirSync(tmpDir)) fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-retry-u", targetGuid: "tgt-retry-u", token: "test-token" });
  initializeGuidLogger("src-retry-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(stateModule, "getApiClient").mockReturnValue({
    _options: { baseUrl: "https://mgmt.example.com", token: "t" },
    assetMethods: {
      getDefaultContainer: jest.fn().mockResolvedValue({ containerID: 1, name: "default" }),
      getGalleryByName: jest.fn().mockResolvedValue(null),
    },
  } as any);
  axios.post.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function sourceAssetWithFile(): any {
  const media = {
    mediaID: 41,
    fileName: "banner-01.png",
    originUrl: "https://origin.example.com/src/promotions/banner-01.png",
    edgeUrl: "https://cdn.example.com/src/promotions/banner-01.png",
    originKey: "promotions/banner-01.png",
    mediaGroupingID: 0,
    mediaGroupingName: null,
  };
  const filePath = new fileOperations("src-retry-u").getDataFilePath(`assets/${getAssetFilePath(media.originUrl)}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "png-bytes");
  return media;
}

const http503 = () => Object.assign(new Error("Request failed with status code 503"), { response: { status: 503 } });

describe("pushAssets — retries a transient upload failure (PROD-3449)", () => {
  it("uploads the asset after a 503, with a fresh request body, and records no failure", async () => {
    jest.useFakeTimers();
    const { failedAssets } = await import("../../assets/failed-assets");
    failedAssets.reset();
    axios.post.mockRejectedValueOnce(http503()).mockResolvedValueOnce({
      data: [{ mediaID: 900, fileName: "banner-01.png", edgeUrl: "https://cdn.example.com/tgt/banner-01.png" }],
    });

    const { pushAssets } = await import("../asset-pusher");
    const run = pushAssets([sourceAssetWithFile()], []);
    await jest.advanceTimersByTimeAsync(2000);
    const result = await run;

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][1]).not.toBe(axios.post.mock.calls[1][1]);
    expect(result.failed).toBe(0);
    expect(result.successful).toBe(1);
    expect(failedAssets.size).toBe(0);
  });

  it("fails the asset, and records it, when every attempt gets a 503", async () => {
    jest.useFakeTimers();
    const { failedAssets } = await import("../../assets/failed-assets");
    failedAssets.reset();
    axios.post.mockRejectedValue(http503());

    const { pushAssets } = await import("../asset-pusher");
    const run = pushAssets([sourceAssetWithFile()], []);
    await jest.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000);
    const result = await run;

    expect(axios.post).toHaveBeenCalledTimes(5);
    expect(result.failed).toBe(1);
    expect(failedAssets.find("https://cdn.example.com/src/promotions/banner-01.png")).toMatchObject({ mediaID: 41 });
    failedAssets.reset();
  });

  it("doesn't hold content back when the target already has a copy of the asset", async () => {
    jest.useFakeTimers();
    const { failedAssets } = await import("../../assets/failed-assets");
    const { AssetMapper } = await import("lib/mappers/asset-mapper");
    failedAssets.reset();
    axios.post.mockRejectedValue(http503());

    const source = { ...sourceAssetWithFile(), dateModified: "2026-11-20T00:00:00Z" };
    const target = {
      mediaID: 900,
      fileName: "banner-01.png",
      originKey: source.originKey,
      originUrl: "https://origin.example.com/tgt/promotions/banner-01.png",
      edgeUrl: "https://cdn.example.com/tgt/promotions/banner-01.png",
      dateModified: "2026-11-01T00:00:00Z",
    };
    new AssetMapper("src-retry-u", "tgt-retry-u").addMapping(
      { ...source, dateModified: "2026-11-01T00:00:00Z" },
      target as any
    );

    const { pushAssets } = await import("../asset-pusher");
    const run = pushAssets([source], [target as any]);
    await jest.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000);
    const result = await run;

    expect(axios.post).toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(failedAssets.size).toBe(0);
  });

  it("doesn't hold content back for an upload the server rejects outright", async () => {
    const { failedAssets } = await import("../../assets/failed-assets");
    failedAssets.reset();
    axios.post.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 413"), { response: { status: 413 } })
    );

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([sourceAssetWithFile()], []);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(failedAssets.size).toBe(0);
  });

  it("stops retrying after five assets in a row fail even with retries", async () => {
    jest.useFakeTimers();
    axios.post.mockRejectedValue(http503());
    const assets = Array.from({ length: 7 }, (_, i) => {
      const a = sourceAssetWithFile();
      const name = `banner-${i}.png`;
      const file = new fileOperations("src-retry-u").getDataFilePath(
        `assets/${getAssetFilePath(a.originUrl.replace("banner-01.png", name))}`
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "png-bytes");
      return {
        ...a,
        mediaID: 100 + i,
        fileName: name,
        originUrl: a.originUrl.replace("banner-01.png", name),
        edgeUrl: a.edgeUrl.replace("banner-01.png", name),
        originKey: a.originKey.replace("banner-01.png", name),
      };
    });

    const { pushAssets } = await import("../asset-pusher");
    const run = pushAssets(assets, []);
    await jest.advanceTimersByTimeAsync(5 * (2000 + 4000 + 8000 + 16000));
    const result = await run;

    // 5 assets × 5 attempts, then 1 attempt each for the last 2.
    expect(axios.post).toHaveBeenCalledTimes(27);
    expect(result.failed).toBe(7);
  });
});
