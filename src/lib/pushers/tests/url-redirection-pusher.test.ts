import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import { preflightReport } from "lib/preflight/preflight-report";

// Mock the API module — keep MAX_URL_REDIRECTION_BATCH_SIZE from the real module.
const { MAX_URL_REDIRECTION_BATCH_SIZE: REAL_BATCH_SIZE } = jest.requireActual("../url-redirection-api");

const mockSaveUrlRedirections = jest.fn();

jest.mock("../url-redirection-api", () => ({
  MAX_URL_REDIRECTION_BATCH_SIZE: REAL_BATCH_SIZE,
  saveUrlRedirections: (...args: any[]) => mockSaveUrlRedirections(...args),
}));

// Mock the UrlRedirectionMapper class so we can capture calls to getMapping / addMapping.
let mockGetMapping: jest.Mock;
let mockAddMapping: jest.Mock;

jest.mock("lib/mappers/url-redirection-mapper", () => {
  return {
    UrlRedirectionMapper: jest.fn().mockImplementation(() => ({
      get getMapping() {
        return mockGetMapping;
      },
      get addMapping() {
        return mockAddMapping;
      },
    })),
  };
});

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-redir-pusher-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-guid-u", targetGuid: "tgt-guid-u" });
  initializeGuidLogger("src-guid-u", "push", "urlRedirection");

  preflightReport.reset();

  mockGetMapping = jest.fn().mockReturnValue(null);
  mockAddMapping = jest.fn();
  mockSaveUrlRedirections.mockReset();

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSourceItem(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    originUrl: "/source-url",
    destinationUrl: "/destination",
    statusCode: 301,
    ...overrides,
  };
}

function makeTargetItem(overrides: Record<string, any> = {}): any {
  return {
    id: 10,
    originUrl: "/target-url",
    destinationUrl: "/destination",
    statusCode: 301,
    ...overrides,
  };
}

// ─── empty sourceData guard ───────────────────────────────────────────────────

describe("pushUrlRedirections — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");
    const result = await pushUrlRedirections([], []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
  });

  it("returns success with zeros when sourceData is null", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");
    const result = await pushUrlRedirections(null as any, []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });
});

// ─── map-on-adopt: unmapped source whose originUrl matches target (case-insensitive) ─────────

describe("pushUrlRedirections — map-on-adopt via originUrl match", () => {
  it("calls addMapping with the target id when originUrl matches case-insensitively", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 1, originUrl: "~/A ", destinationUrl: "/same", statusCode: 301 });
    const target = makeTargetItem({ id: 20, originUrl: "~/a", destinationUrl: "/same", statusCode: 301 });

    // No existing mapping for source id 1.
    mockGetMapping.mockReturnValue(null);
    // Expect: identical after normalization → SKIP.
    mockSaveUrlRedirections.mockResolvedValue({ created: [], updated: [], skipped: [] });

    const result = await pushUrlRedirections([source], [target]);

    // Identical: the hashes of both sides are recorded with the adopted mapping.
    expect(mockAddMapping).toHaveBeenCalledWith(1, 20, source.originUrl, expect.objectContaining({ fingerprintVersion: 1 }));
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
  });

  it("queues an UPDATE when originUrl matches but destinationUrl differs", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 2, originUrl: "/shared", destinationUrl: "/new-dest", statusCode: 301 });
    const target = makeTargetItem({ id: 21, originUrl: "/shared", destinationUrl: "/old-dest", statusCode: 301 });

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockResolvedValue({ created: [], updated: [{ index: 0, urlRedirectionID: 21 }], skipped: [] });

    const result = await pushUrlRedirections([source], [target]);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    const [, payloads] = mockSaveUrlRedirections.mock.calls[0];
    expect(payloads[0].urlRedirectionID).toBe(21);
    expect(result.successful).toBe(1);
  });

  it("queues an UPDATE when originUrl matches but statusCode differs", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 3, originUrl: "/page", destinationUrl: "/new", statusCode: 302 });
    const target = makeTargetItem({ id: 22, originUrl: "/page", destinationUrl: "/new", statusCode: 301 });

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockResolvedValue({ created: [], updated: [{ index: 0, urlRedirectionID: 22 }], skipped: [] });

    const result = await pushUrlRedirections([source], [target]);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    const [, payloads] = mockSaveUrlRedirections.mock.calls[0];
    expect(payloads[0].urlRedirectionID).toBe(22);
    expect(result.successful).toBe(1);
  });
});

// ─── mapped item — identical → skip ──────────────────────────────────────────

describe("pushUrlRedirections — mapped item, identical target → skip", () => {
  it("skips and makes no API call when source and mapped target are identical", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 5, originUrl: "/mapped", destinationUrl: "/dest", statusCode: 301 });
    const target = makeTargetItem({ id: 50, originUrl: "/mapped", destinationUrl: "/dest", statusCode: 301 });

    mockGetMapping.mockReturnValue({
      sourceUrlRedirectionID: 5,
      targetUrlRedirectionID: 50,
      originUrl: "/mapped",
    });

    const result = await pushUrlRedirections([source], [target]);

    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
  });
});

// ─── mapped item whose mapped target no longer exists → CREATE ────────────────

describe("pushUrlRedirections — mapped target deleted on the target", () => {
  const orphanMapping = { sourceUrlRedirectionID: 6, targetUrlRedirectionID: 99, originUrl: "/orphan" };

  it("is a conflict without --overwrite: nothing is sent", async () => {
    setState({ preflight: true });
    const { pushUrlRedirections } = await import("../url-redirection-pusher");
    const source = makeSourceItem({ id: 6, originUrl: "/orphan", destinationUrl: "/dest", statusCode: 301 });
    mockGetMapping.mockReturnValue(orphanMapping);

    const result = await pushUrlRedirections([source], []);

    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(preflightReport.getEntries()).toEqual([
      expect.objectContaining({ action: "conflict", name: "/orphan", detail: expect.stringContaining("no longer exists") }),
    ]);
  });

  it("with --overwrite sends a CREATE (urlRedirectionID=0)", async () => {
    setState({ overwrite: true });
    const { pushUrlRedirections } = await import("../url-redirection-pusher");
    const source = makeSourceItem({ id: 6, originUrl: "/orphan", destinationUrl: "/dest", statusCode: 301 });
    mockGetMapping.mockReturnValue(orphanMapping);
    mockSaveUrlRedirections.mockResolvedValue({ created: [{ index: 0, urlRedirectionID: 100 }], updated: [], skipped: [] });

    const result = await pushUrlRedirections([source], []);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    const [, payloads] = mockSaveUrlRedirections.mock.calls[0];
    expect(payloads[0].urlRedirectionID).toBe(0);
    expect(result.successful).toBe(1);
  });
});

// ─── new item (no mapping, no origin match) → CREATE ─────────────────────────

describe("pushUrlRedirections — new item → create", () => {
  it("sends a CREATE for an item with no mapping and no matching target", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 7, originUrl: "/brand-new", destinationUrl: "/dest", statusCode: 302 });

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockResolvedValue({ created: [{ index: 0, urlRedirectionID: 200 }], updated: [], skipped: [] });

    const result = await pushUrlRedirections([source], []);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    const [, payloads] = mockSaveUrlRedirections.mock.calls[0];
    expect(payloads[0].urlRedirectionID).toBe(0);
    expect(payloads[0].httpCode).toBe(302);
    expect(result.successful).toBe(1);
  });

  it("defaults httpCode to 301 when statusCode is undefined", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 8, originUrl: "/no-code", destinationUrl: "/dest", statusCode: undefined });

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockResolvedValue({ created: [{ index: 0, urlRedirectionID: 201 }], updated: [], skipped: [] });

    await pushUrlRedirections([source], []);

    const [, payloads] = mockSaveUrlRedirections.mock.calls[0];
    expect(payloads[0].httpCode).toBe(301);
  });
});

// ─── response handling: created, updated, skipped ─────────────────────────────

describe("pushUrlRedirections — response handling", () => {
  it("calls addMapping for created and updated items and counts skipped from response", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const s1 = makeSourceItem({ id: 10, originUrl: "/a" });
    const s2 = makeSourceItem({ id: 11, originUrl: "/b" });
    const s3 = makeSourceItem({ id: 12, originUrl: "/c" });

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockResolvedValue({
      created: [{ index: 0, urlRedirectionID: 12, originUrl: "/a" }],
      updated: [{ index: 1, urlRedirectionID: 5 }],
      skipped: [{ index: 2, reason: "collision" }],
    });

    const result = await pushUrlRedirections([s1, s2, s3], []);

    // addMapping called for created (source 10 → target 12) and updated (source 11 → target 5).
    expect(mockAddMapping).toHaveBeenCalledWith(10, 12, "/a", expect.objectContaining({ fingerprintVersion: 1 }));
    expect(mockAddMapping).toHaveBeenCalledWith(11, 5, "/b", expect.objectContaining({ fingerprintVersion: 1 }));

    expect(result.successful).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.status).toBe("success");
  });
});

// ─── batching: 251 items → two API calls ─────────────────────────────────────

describe("pushUrlRedirections — batching", () => {
  it("splits 251 pending creates into two API calls (250 + 1)", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const sources = Array.from({ length: 251 }, (_, i) =>
      makeSourceItem({ id: i + 1, originUrl: `/url-${i}`, destinationUrl: `/dest-${i}` })
    );

    mockGetMapping.mockReturnValue(null);
    // Each batch call returns empty arrays; successful count will be 0 because no items in created/updated.
    mockSaveUrlRedirections.mockResolvedValue({ created: [], updated: [], skipped: [] });

    await pushUrlRedirections(sources, []);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(2);
    const [, firstBatch] = mockSaveUrlRedirections.mock.calls[0];
    const [, secondBatch] = mockSaveUrlRedirections.mock.calls[1];
    expect(firstBatch).toHaveLength(250);
    expect(secondBatch).toHaveLength(1);
  });
});

// ─── API rejects → batch failed ───────────────────────────────────────────────

describe("pushUrlRedirections — API error", () => {
  it("counts the whole batch as failed and returns status error when API rejects", async () => {
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const sources = [
      makeSourceItem({ id: 20, originUrl: "/fail-1" }),
      makeSourceItem({ id: 21, originUrl: "/fail-2" }),
    ];

    mockGetMapping.mockReturnValue(null);
    mockSaveUrlRedirections.mockRejectedValue(new Error("API unavailable"));

    const result = await pushUrlRedirections(sources, []);

    expect(result.failed).toBe(2);
    expect(result.successful).toBe(0);
    expect(result.status).toBe("error");
    // PROD-2629: one detail per item in the failed batch
    expect(result.failureDetails).toEqual([
      expect.objectContaining({ name: "/fail-1", type: "urlRedirection", error: "API unavailable" }),
      expect.objectContaining({ name: "/fail-2", type: "urlRedirection", error: "API unavailable" }),
    ]);
  });
});

// ─── preflight mode ───────────────────────────────────────────────────────────

describe("pushUrlRedirections — preflight mode", () => {
  it("records create/update/skip entries in the preflightReport with phase 'URL Redirections'", async () => {
    setState({ preflight: true });
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    // s1: no mapping, no target match → CREATE
    const s1 = makeSourceItem({ id: 30, originUrl: "/new-redir", destinationUrl: "/dest", statusCode: 301 });
    // s2: no mapping, target matches by origin URL exactly, identical → SKIP (recorded before pending loop)
    const s2 = makeSourceItem({ id: 31, originUrl: "/existing", destinationUrl: "/same", statusCode: 301 });
    const t2 = makeTargetItem({ id: 31, originUrl: "/existing", destinationUrl: "/same", statusCode: 301 });
    // s3: no mapping, target matches but different → UPDATE (queued in pending, recorded in preflight loop)
    const s3 = makeSourceItem({ id: 32, originUrl: "/changed", destinationUrl: "/new-dest", statusCode: 301 });
    const t3 = makeTargetItem({ id: 32, originUrl: "/changed", destinationUrl: "/old-dest", statusCode: 301 });

    mockGetMapping.mockReturnValue(null);

    const result = await pushUrlRedirections([s1, s2, s3], [t2, t3]);

    // No API calls in preflight mode.
    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();

    const entries = preflightReport.getEntries();
    // One skip recorded directly; two (create + update) recorded in the preflight pending loop.
    expect(entries.length).toBe(3);

    const phases = entries.map((e) => e.phase);
    expect(phases.every((p) => p === "URL Redirections")).toBe(true);

    const actions = entries.map((e) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
    expect(actions).toContain("skip");

    // In preflight the skip counts toward skipped; create/update count toward successful.
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(2); // create + update counted as successful in preflight
  });

  it("does not write to the API in preflight mode", async () => {
    setState({ preflight: true });
    const { pushUrlRedirections } = await import("../url-redirection-pusher");

    const source = makeSourceItem({ id: 40, originUrl: "/preflight-only" });
    mockGetMapping.mockReturnValue(null);

    await pushUrlRedirections([source], []);

    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
  });
});

// ─── PROD-3078: which side changed, from the hashes stored at the last sync ──────────

describe("pushUrlRedirections — sync fingerprints (PROD-3078)", () => {
  // The state both sides agreed on at the last sync.
  const synced = { id: 1, originUrl: "/old", destinationUrl: "/new", statusCode: 301 };
  const syncedTarget = { ...synced, id: 10 };

  async function setup(mapping: Record<string, any> | null) {
    const mod = await import("../url-redirection-pusher");
    const { keptTargetChanges } = await import("../kept-target-changes");
    keptTargetChanges.reset();
    mockGetMapping.mockReturnValue(mapping);
    mockSaveUrlRedirections.mockResolvedValue({ created: [], updated: [{ index: 0, urlRedirectionID: 10 }], skipped: [] });
    return { ...mod, keptTargetChanges };
  }

  async function recorded() {
    const { redirectionHash } = await import("../url-redirection-pusher");
    const h = redirectionHash(synced as any);
    return {
      sourceUrlRedirectionID: 1,
      targetUrlRedirectionID: 10,
      originUrl: "/old",
      sourceHash: h,
      targetHash: redirectionHash(syncedTarget as any),
      fingerprintVersion: 1,
    };
  }

  it("ignores the ID, origin URL case and originLocales order", async () => {
    const { redirectionHash } = await import("../url-redirection-pusher");
    expect(redirectionHash({ ...synced, originLocales: ["fr", "en"] } as any)).toBe(
      redirectionHash({ ...synced, id: 99, originUrl: " /OLD ", originLocales: ["en", "fr"] } as any)
    );
  });

  it("source changed only: updates and records the new hash for both sides", async () => {
    const { pushUrlRedirections, redirectionHash } = await setup(await recorded());
    const source = { ...synced, destinationUrl: "/newer" };

    const result = await pushUrlRedirections([source as any], [syncedTarget as any]);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    const h = redirectionHash(source as any);
    expect(mockAddMapping).toHaveBeenCalledWith(1, 10, "/old", { sourceHash: h, targetHash: h, fingerprintVersion: 1 });
  });

  it("target changed only: keeps the target, warns, and leaves the record alone", async () => {
    setState({ preflight: true });
    const { pushUrlRedirections, keptTargetChanges } = await setup(await recorded());
    const target = { ...syncedTarget, destinationUrl: "/edited-on-target" };

    const result = await pushUrlRedirections([synced as any], [target as any]);

    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
    expect(mockAddMapping).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(keptTargetChanges.getEntries()).toEqual([
      expect.objectContaining({ type: "urlRedirection", name: "/old", sourceID: 1, targetID: 10 }),
    ]);
    expect(preflightReport.getEntries()).toEqual([expect.objectContaining({ action: "skip" })]);
  });

  it("target changed only, with --overwrite: the source replaces it", async () => {
    setState({ overwrite: true });
    const { pushUrlRedirections, keptTargetChanges } = await setup(await recorded());
    const target = { ...syncedTarget, destinationUrl: "/edited-on-target" };

    await pushUrlRedirections([synced as any], [target as any]);

    expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    expect(mockSaveUrlRedirections.mock.calls[0][1][0]).toEqual(expect.objectContaining({ urlRedirectionID: 10, destinationUrl: "/new" }));
    expect(keptTargetChanges.hasEntries()).toBe(false);
  });

  it("both changed: a conflict, nothing sent, record left alone", async () => {
    setState({ preflight: true });
    const { pushUrlRedirections, keptTargetChanges } = await setup(await recorded());

    const result = await pushUrlRedirections(
      [{ ...synced, destinationUrl: "/source-edit" } as any],
      [{ ...syncedTarget, destinationUrl: "/target-edit" } as any]
    );

    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
    expect(mockAddMapping).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(keptTargetChanges.hasEntries()).toBe(false);
    expect(preflightReport.hasConflicts()).toBe(true);
  });

  it("both changed, with --overwrite: the source wins", async () => {
    setState({ overwrite: true });
    const { pushUrlRedirections } = await setup(await recorded());

    await pushUrlRedirections(
      [{ ...synced, destinationUrl: "/source-edit" } as any],
      [{ ...syncedTarget, destinationUrl: "/target-edit" } as any]
    );

    expect(mockSaveUrlRedirections.mock.calls[0][1][0].destinationUrl).toBe("/source-edit");
    expect(preflightReport.hasConflicts()).toBe(false);
  });

  it("both changed to the same value: skipped, and the hashes refreshed", async () => {
    const { pushUrlRedirections, redirectionHash } = await setup(await recorded());
    const source = { ...synced, destinationUrl: "/same-edit" };

    const result = await pushUrlRedirections([source as any], [{ ...syncedTarget, destinationUrl: "/same-edit" } as any]);

    expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    const h = redirectionHash(source as any);
    expect(mockAddMapping).toHaveBeenCalledWith(1, 10, "/old", { sourceHash: h, targetHash: h, fingerprintVersion: 1 });
  });

  describe("mapping from an older CLI, with no hashes", () => {
    const unrecorded = { sourceUrlRedirectionID: 1, targetUrlRedirectionID: 10, originUrl: "/old" };

    it("in sync: skipped, and the hashes are recorded", async () => {
      const { pushUrlRedirections } = await setup(unrecorded);

      await pushUrlRedirections([synced as any], [syncedTarget as any]);

      expect(mockSaveUrlRedirections).not.toHaveBeenCalled();
      expect(mockAddMapping).toHaveBeenCalledWith(1, 10, "/old", expect.objectContaining({ fingerprintVersion: 1 }));
    });

    it("different: the source wins, as before, labelled as having no sync record", async () => {
      setState({ preflight: true });
      const { pushUrlRedirections, keptTargetChanges } = await setup(unrecorded);

      await pushUrlRedirections([synced as any], [{ ...syncedTarget, destinationUrl: "/edited-on-target" } as any]);

      expect(keptTargetChanges.hasEntries()).toBe(false);
      expect(preflightReport.getEntries()).toEqual([
        expect.objectContaining({ action: "update", detail: expect.stringContaining("no sync record yet") }),
      ]);
    });

    it("hashes from another fingerprint version count as missing", async () => {
      const { pushUrlRedirections } = await setup({ ...(await recorded()), fingerprintVersion: 0 });

      await pushUrlRedirections([synced as any], [{ ...syncedTarget, destinationUrl: "/edited-on-target" } as any]);

      expect(mockSaveUrlRedirections).toHaveBeenCalledTimes(1);
    });
  });
});
