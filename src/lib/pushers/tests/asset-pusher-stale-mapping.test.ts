import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";
import { AssetMapper } from "lib/mappers/asset-mapper";

// PROD-2627: a mapped target asset that is missing or sits at a different path must not be
// uploaded again as a second copy, and a source asset must never end up with two records.

jest.mock("axios", () => ({ post: jest.fn() }));
const axios = require("axios");

const SRC = "src-stale-u";
const TGT = "tgt-stale-u";
const SRC_CDN = "https://cdn.example.com/src-container";
const TGT_CDN = "https://cdn.example.com/tgt-container";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-asset-stale-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // fresh mapping files for every test
  fs.rmSync(path.join(tmpDir, "mappings"), { recursive: true, force: true });
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: SRC, targetGuid: TGT, token: "test-token" });
  initializeGuidLogger(SRC, "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  axios.post.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function asset(side: "source" | "target", mediaID: number, relPath: string, dateModified: string): any {
  const cdn = side === "source" ? SRC_CDN : TGT_CDN;
  return {
    mediaID,
    fileName: path.basename(relPath),
    originKey: relPath,
    originUrl: `${cdn}/${relPath}`,
    edgeUrl: `${cdn}/${relPath}`,
    containerEdgeUrl: cdn,
    containerOriginUrl: cdn,
    dateModified,
    mediaGroupingID: 0,
    mediaGroupingName: null,
  };
}

// the pusher reads the source file from the local cache before uploading
function writeLocalFile(relPath: string) {
  const file = path.join(tmpDir, SRC, "assets", relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
}

function mockApi() {
  const api: any = {
    assetMethods: {
      getDefaultContainer: jest.fn().mockResolvedValue({ containerID: 1 }),
      getGalleryByName: jest.fn().mockResolvedValue(null),
      moveFile: jest.fn().mockResolvedValue({}),
    },
    _options: { baseUrl: "https://mgmt.example.com", token: "t" },
  };
  jest.spyOn(stateModule, "getApiClient").mockReturnValue(api);
  return api;
}

function records(): any[] {
  return (new AssetMapper(SRC, TGT) as any).mappings;
}

async function preflightEntries() {
  const { preflightReport } = await import("lib/preflight/preflight-report");
  return preflightReport.getEntries().filter((e) => e.phase === "Assets");
}

const OLD = "2024-01-01T00:00:00Z";
const NEW = "2024-06-01T00:00:00Z";

// ─── mapped target asset is gone ──────────────────────────────────────────────

describe("pushAssets — mapped target asset no longer exists (PROD-2627)", () => {
  it("is skipped when the source is unchanged: the target-side deletion is left alone", async () => {
    new AssetMapper(SRC, TGT).addMapping(asset("source", 7, "a/gone.png", OLD), asset("target", 8, "a/gone.png", OLD));
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 7, "a/gone.png", OLD)], []);

    expect(axios.post).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(records()[0].targetMediaID).toBe(8);
  });

  it("is a conflict without --overwrite when the source changed: no upload, record unchanged", async () => {
    const src = asset("source", 1536, "keno/NASPL_KENO.html", NEW);
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1536, "keno/NASPL_KENO.html", OLD), asset("target", 212, "keno/NASPL_KENO.html", OLD));
    writeLocalFile("keno/NASPL_KENO.html");
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([src], []);

    expect(axios.post).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(212);
  });

  it("is reported as a preflight conflict", async () => {
    // seed before enabling preflight: preflight never persists mapping files
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1, "a/x.png", OLD), asset("target", 2, "a/x.png", OLD));
    state.preflight = true;
    const { preflightReport } = await import("lib/preflight/preflight-report");
    preflightReport.reset();
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    await pushAssets([asset("source", 1, "a/x.png", NEW)], []);

    const [entry] = await preflightEntries();
    expect(entry.action).toBe("conflict");
    expect(entry.detail).toMatch(/mapped target asset \(ID: 2\) no longer exists on the target/);
  });

  it("with --overwrite uploads once and repoints the existing record", async () => {
    state.overwrite = true;
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1536, "keno/k.html", OLD), asset("target", 212, "keno/k.html", OLD));
    writeLocalFile("keno/k.html");
    mockApi();
    axios.post.mockResolvedValue({ data: [asset("target", 1718, "keno/k.html", NEW)] });

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 1536, "keno/k.html", OLD)], []);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(1718);
  });

  it("relinks to an unmapped target asset at the same path instead of uploading", async () => {
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1, "a/x.png", OLD), asset("target", 2, "a/x.png", OLD));
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 1, "a/x.png", OLD)], [asset("target", 9, "a/x.png", NEW)]);

    expect(axios.post).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(9);
  });
});

// ─── source and target paths differ ───────────────────────────────────────────

describe("pushAssets — asset moved to another folder (PROD-2627)", () => {
  it("moved on the target: conflict without --overwrite, no copy uploaded", async () => {
    // recorded at the last sync: both in folder a. The target has since moved it to folder b.
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1614, "a/bg.png", OLD), asset("target", 131, "a/bg.png", OLD));
    const api = mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 1614, "a/bg.png", OLD)], [asset("target", 131, "b/bg.png", NEW)]);

    expect(axios.post).not.toHaveBeenCalled();
    expect(api.assetMethods.moveFile).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(131);
  });

  it("moved on the target is reported as a preflight conflict naming both folders", async () => {
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1614, "a/bg.png", OLD), asset("target", 131, "a/bg.png", OLD));
    state.preflight = true;
    const { preflightReport } = await import("lib/preflight/preflight-report");
    preflightReport.reset();
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    await pushAssets([asset("source", 1614, "a/bg.png", OLD)], [asset("target", 131, "b/bg.png", NEW)]);

    const [entry] = await preflightEntries();
    expect(entry.action).toBe("conflict");
    expect(entry.detail).toMatch(/in b on the target but a on the source \(moved on the target\)/);
  });

  it("moved on the source: moves the target asset, then uploads in place", async () => {
    // recorded: both in folder a. The source has since moved it to folder b.
    new AssetMapper(SRC, TGT).addMapping(asset("source", 131, "a/bg.png", OLD), asset("target", 1614, "a/bg.png", OLD));
    writeLocalFile("b/bg.png");
    const api = mockApi();
    axios.post.mockResolvedValue({ data: [asset("target", 1614, "b/bg.png", NEW)] });

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 131, "b/bg.png", NEW)], [asset("target", 1614, "a/bg.png", OLD)]);

    expect(api.assetMethods.moveFile).toHaveBeenCalledWith(1614, "b", TGT);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain("folderPath=b");
    expect(result.successful).toBe(1);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(1614);
    expect(records()[0].targetUrl).toBe(`${TGT_CDN}/b/bg.png`);
  });

  it("moved on the target with --overwrite: moves it back to the source folder", async () => {
    state.overwrite = true;
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1614, "a/bg.png", OLD), asset("target", 131, "a/bg.png", OLD));
    writeLocalFile("a/bg.png");
    const api = mockApi();
    axios.post.mockResolvedValue({ data: [asset("target", 131, "a/bg.png", NEW)] });

    const { pushAssets } = await import("../asset-pusher");
    await pushAssets([asset("source", 1614, "a/bg.png", OLD)], [asset("target", 131, "b/bg.png", NEW)]);

    expect(api.assetMethods.moveFile).toHaveBeenCalledWith(131, "a", TGT);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(131);
  });

  it("ignores gallery paths, whose MediaGroupings/{id} differs per instance", async () => {
    new AssetMapper(SRC, TGT).addMapping(
      asset("source", 1, "MediaGroupings/11/ss.png", OLD),
      asset("target", 2, "MediaGroupings/2/ss.png", OLD)
    );
    const api = mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets(
      [asset("source", 1, "MediaGroupings/11/ss.png", OLD)],
      [asset("target", 2, "MediaGroupings/2/ss.png", OLD)]
    );

    expect(api.assetMethods.moveFile).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("renamed on one side: conflict without --overwrite", async () => {
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1, "a/old.png", OLD), asset("target", 2, "a/old.png", OLD));
    const api = mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 1, "a/new.png", NEW)], [asset("target", 2, "a/old.png", OLD)]);

    expect(axios.post).not.toHaveBeenCalled();
    expect(api.assetMethods.moveFile).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("same path: normal update still uploads in place", async () => {
    new AssetMapper(SRC, TGT).addMapping(asset("source", 1, "a/x.png", OLD), asset("target", 2, "a/x.png", OLD));
    writeLocalFile("a/x.png");
    const api = mockApi();
    axios.post.mockResolvedValue({ data: [asset("target", 2, "a/x.png", NEW)] });

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets([asset("source", 1, "a/x.png", NEW)], [asset("target", 2, "a/x.png", OLD)]);

    expect(api.assetMethods.moveFile).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(records()).toHaveLength(1);
  });
});

// ─── duplicate records from earlier versions ──────────────────────────────────

describe("pushAssets — duplicate records left by earlier versions (PROD-2627)", () => {
  function seedDuplicates() {
    const mapper = new AssetMapper(SRC, TGT) as any;
    mapper.mappings = [
      { sourceMediaID: 1614, targetMediaID: 131, sourceDateModified: OLD, targetDateModified: OLD, sourceUrl: `${SRC_CDN}/a/bg.png`, targetUrl: `${TGT_CDN}/a/bg.png` },
      { sourceMediaID: 1614, targetMediaID: 1775, sourceDateModified: OLD, targetDateModified: OLD, sourceUrl: `${SRC_CDN}/a/bg.png`, targetUrl: `${TGT_CDN}/a/bg.png` },
    ].map((m) => ({ sourceGuid: SRC, targetGuid: TGT, ...m }));
    mapper.saveMapping();
  }

  it("collapses them to the live same-path pair and then skips", async () => {
    seedDuplicates();
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    const result = await pushAssets(
      [asset("source", 1614, "a/bg.png", OLD)],
      [asset("target", 131, "b/bg.png", OLD), asset("target", 1775, "a/bg.png", OLD)]
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(records()).toHaveLength(1);
    expect(records()[0].targetMediaID).toBe(1775);
  });

  it("leaves records alone on a scoped run", async () => {
    seedDuplicates();
    state.pages = "/some-page";
    mockApi();

    const { pushAssets } = await import("../asset-pusher");
    await pushAssets(
      [asset("source", 1614, "a/bg.png", OLD)],
      [asset("target", 131, "b/bg.png", OLD), asset("target", 1775, "a/bg.png", OLD)]
    );

    expect(records()).toHaveLength(2);
  });
});
