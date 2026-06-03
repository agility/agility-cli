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
