import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-gallery-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-gal-u", targetGuid: "tgt-gal-u", token: "test-token" });
  initializeGuidLogger("src-gal-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let galleryCounter = 0;

function makeGallery(overrides: Record<string, any> = {}): any {
  galleryCounter++;
  return {
    mediaGroupingID: galleryCounter,
    name: `Gallery ${galleryCounter}`,
    description: null,
    groupingTypeID: 1,
    groupingType: null,
    modifiedBy: null,
    modifiedByName: null,
    modifiedOn: null,
    isDeleted: false,
    isFolder: false,
    metaData: {},
    ...overrides,
  };
}

function makeApiClient(saveGalleryImpl?: jest.Mock): any {
  return {
    assetMethods: {
      saveGallery: saveGalleryImpl ?? jest.fn().mockResolvedValue(makeGallery()),
    },
  };
}

// ─── pushGalleries — empty sourceData guard ───────────────────────────────────

describe("pushGalleries — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushGalleries } = await import("../gallery-pusher");
    const result = await pushGalleries([], []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns success with zeros when sourceData is null", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushGalleries } = await import("../gallery-pusher");
    const result = await pushGalleries(null as any, []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });

  it('logs "No galleries found" when empty', async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const consoleSpy = jest.spyOn(console, "log");
    const { pushGalleries } = await import("../gallery-pusher");
    await pushGalleries([], []);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No galleries"));
  });
});

// ─── pushGalleries — skip when gallery already exists in target by name ────────

describe("pushGalleries — skip when gallery exists in target by name", () => {
  it("skips gallery that already exists in target by name when no mapping exists", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushGalleries } = await import("../gallery-pusher");

    const sourceGallery = makeGallery({ name: "Shared Gallery" });
    const targetGallery = makeGallery({ name: "Shared Gallery" });

    const result = await pushGalleries([sourceGallery], [targetGallery]);

    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
  });
});

// ─── pushGalleries — create new gallery ───────────────────────────────────────

describe("pushGalleries — create new gallery", () => {
  it("calls saveGallery when gallery does not exist in target", async () => {
    const saveMock = jest.fn().mockResolvedValue(makeGallery({ mediaGroupingID: 999 }));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveMock));

    const { pushGalleries } = await import("../gallery-pusher");

    const sourceGallery = makeGallery({ name: "Brand New Gallery" });

    const result = await pushGalleries([sourceGallery], []);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("marks as failed and returns error status when saveGallery throws", async () => {
    const saveMock = jest.fn().mockRejectedValue(new Error("API error creating gallery"));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveMock));

    const { pushGalleries } = await import("../gallery-pusher");

    const sourceGallery = makeGallery({ name: "Error Gallery" });

    const result = await pushGalleries([sourceGallery], []);

    expect(result.failed).toBe(1);
    expect(result.status).toBe("error");
    expect(result.successful).toBe(0);
    // PROD-2629: the failure must carry a detail for the ERROR SUMMARY / --jsonSummary
    expect(result.failureDetails).toEqual([
      expect.objectContaining({ name: "Error Gallery", type: "gallery", error: expect.stringContaining("API error") }),
    ]);
  });
});

// ─── pushGalleries — result shape ──────────────────────────────────────────────

describe("pushGalleries — result shape", () => {
  it("returns status, successful, failed, skipped fields", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushGalleries } = await import("../gallery-pusher");
    const result = await pushGalleries([], []);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });
});

// ─── pushGalleries — change detection ─────────────────────────────────────────

describe("pushGalleries — mapped gallery: what changed decides update, skip or conflict", () => {
  async function run(sourceChanged: boolean, targetChanged: boolean, overwrite = false) {
    const { GalleryMapper } = await import("lib/mappers/gallery-mapper");
    const source = makeGallery({ name: "Mapped Gallery" });
    const target = makeGallery({ name: "Mapped Gallery", mediaGroupingID: 500 });
    jest.spyOn(GalleryMapper.prototype, "getGalleryMapping").mockReturnValue({ targetMediaGroupingID: 500 } as any);
    jest.spyOn(GalleryMapper.prototype, "hasSourceChanged").mockReturnValue(sourceChanged);
    jest.spyOn(GalleryMapper.prototype, "hasTargetChanged").mockReturnValue(targetChanged);
    jest.spyOn(GalleryMapper.prototype, "addMapping").mockImplementation(() => {});
    const saveMock = jest.fn().mockResolvedValue(target);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveMock));
    setState({ overwrite });

    const { pushGalleries } = await import("../gallery-pusher");
    const result = await pushGalleries([source], [target]);
    return { result, saved: saveMock.mock.calls.length };
  }

  it("updates when only the source changed", async () => {
    const { result, saved } = await run(true, false);
    expect(saved).toBe(1);
    expect(result.successful).toBe(1);
  });

  it("skips when neither changed, even with --overwrite", async () => {
    expect((await run(false, false)).saved).toBe(0);
    expect((await run(false, false, true)).saved).toBe(0);
  });

  it("keeps a target-only edit (a conflict) unless --overwrite", async () => {
    const kept = await run(false, true);
    expect(kept.saved).toBe(0);
    expect(kept.result.skipped).toBe(1);
    expect((await run(false, true, true)).saved).toBe(1);
  });

  it("keeps an edit on both sides (a conflict) unless --overwrite", async () => {
    expect((await run(true, true)).saved).toBe(0);
    expect((await run(true, true, true)).saved).toBe(1);
  });
});

// ─── pushGalleries — target-only change is kept with a warning ────────────────

describe("pushGalleries — mapped gallery changed on the target", () => {
  async function run(sourceChanged: boolean, targetChanged: boolean, overwrite = false) {
    const { GalleryMapper } = await import("lib/mappers/gallery-mapper");
    const { keptTargetChanges } = await import("../kept-target-changes");
    const { preflightReport } = await import("lib/preflight/preflight-report");
    keptTargetChanges.reset();
    preflightReport.reset();
    const source = makeGallery({ name: "Mapped Gallery", mediaGroupingID: 11 });
    const target = makeGallery({ name: "Mapped Gallery", mediaGroupingID: 500 });
    jest.spyOn(GalleryMapper.prototype, "getGalleryMapping").mockReturnValue({ targetMediaGroupingID: 500 } as any);
    jest.spyOn(GalleryMapper.prototype, "hasSourceChanged").mockReturnValue(sourceChanged);
    jest.spyOn(GalleryMapper.prototype, "hasTargetChanged").mockReturnValue(targetChanged);
    jest.spyOn(GalleryMapper.prototype, "addMapping").mockImplementation(() => {});
    const saveMock = jest.fn().mockResolvedValue(target);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveMock));
    setState({ overwrite, preflight: !overwrite });

    const { pushGalleries } = await import("../gallery-pusher");
    const result = await pushGalleries([source], [target]);
    const entries = preflightReport.getEntries().filter((e) => e.phase === "Galleries");
    return { result, saved: saveMock.mock.calls.length, entries, kept: keptTargetChanges };
  }

  it("target-only change without --overwrite is a skip that records a kept change", async () => {
    const { result, saved, entries, kept } = await run(false, true);

    expect(saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(entries).toEqual([
      expect.objectContaining({
        action: "skip",
        name: "Mapped Gallery",
        detail: expect.stringMatching(/kept the target's version/),
      }),
    ]);
    expect(kept.getEntries()).toEqual([
      expect.objectContaining({ type: "gallery", name: "Mapped Gallery", sourceID: 11, targetID: 500 }),
    ]);
  });

  it("change on both sides without --overwrite is still a conflict and records nothing", async () => {
    const { saved, entries, kept } = await run(true, true);

    expect(saved).toBe(0);
    expect(entries).toEqual([expect.objectContaining({ action: "conflict", name: "Mapped Gallery" })]);
    expect(kept.hasEntries()).toBe(false);
  });

  it("target-only change with --overwrite updates and records nothing", async () => {
    const { result, saved, kept } = await run(false, true, true);

    expect(saved).toBe(1);
    expect(result.successful).toBe(1);
    expect(kept.hasEntries()).toBe(false);
  });
});
