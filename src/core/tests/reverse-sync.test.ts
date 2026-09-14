/**
 * PROD-2526: reverse-sync
 *
 * A reverse sync runs the ordinary push pipeline with swapped guids (original target → original
 * source) while reusing the forward sync's mapping files. fileOperations resolves the swapped
 * pair back to the original `mappings/{origSource}-{origTarget}` directory and transposes each
 * record's source/target fields on read and write, so the files never change orientation.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileOperations, transposeMappingRecord, transposeMappingRecords } from "../fileOperations";
import { resetState, setState, enableReverseSync, getState } from "../state";
import * as stateModule from "../state";
import { ContentItemMapper } from "../../lib/mappers/content-item-mapper";
import { updateContentMappingsAfterPublish } from "../../lib/mappers/mapping-version-updater";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-reverse-sync-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

let pairCounter = 0;
let A: string; // original source
let B: string; // original target
const LOCALE = "en-us";

function freshPair(): void {
  pairCounter++;
  A = `srcguid-${pairCounter}`;
  B = `tgtguid-${pairCounter}`;
}

function readRawMappings(type: string, locale?: string): any[] {
  const file = path.join(tmpDir, "mappings", `${A}-${B}`, locale ?? "", type, "mappings.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function makeItem(contentID: number, versionID = 1): any {
  return {
    contentID,
    properties: { versionID, referenceName: "my-ref", definitionName: "MyModel", state: 2 },
    fields: { title: `Item ${contentID}` },
  };
}

// ─── transposeMappingRecord ──────────────────────────────────────────────────

describe("transposeMappingRecord", () => {
  // One representative record per mapper interface in src/lib/mappers.
  const samples: Record<string, Record<string, any>> = {
    model: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceID: 1,
      targetID: 2,
      sourceReferenceName: "Post",
      targetReferenceName: "Post",
      sourceLastModifiedDate: "2026-01-01",
      targetLastModifiedDate: "2026-01-02",
    },
    container: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceContentViewID: 10,
      targetContentViewID: 20,
      sourceReferenceName: "posts",
      targetReferenceName: "posts",
      sourceLastModifiedDate: "x",
      targetLastModifiedDate: "y",
    },
    contentItem: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceContentID: 100,
      targetContentID: 200,
      sourceVersionID: 1,
      targetVersionID: 5,
    },
    page: {
      sourceGuid: "A",
      targetGuid: "B",
      sourcePageID: 3,
      targetPageID: 4,
      sourceVersionID: 1,
      targetVersionID: 2,
      sourcePageTemplateName: "TwoCol",
      targetPageTemplateName: "TwoCol",
    },
    asset: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceMediaID: 7,
      targetMediaID: 8,
      sourceUrl: "https://a/img.png",
      targetUrl: "https://b/img.png",
      sourceContainerEdgeUrl: "https://a-edge",
      targetContainerEdgeUrl: "https://b-edge",
      sourceContainerOriginUrl: "https://a-origin",
      targetContainerOriginUrl: "https://b-origin",
      sourceDateModified: "d1",
      targetDateModified: "d2",
    },
    gallery: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceMediaGroupingID: 11,
      targetMediaGroupingID: 12,
      sourceModifiedOn: "m1",
      targetModifiedOn: "m2",
    },
    template: {
      sourceGuid: "A",
      targetGuid: "B",
      sourcePageTemplateID: 21,
      targetPageTemplateID: 22,
      sourcePageTemplateName: "Main",
      targetPageTemplateName: "Main",
    },
    section: {
      sourceGuid: "A",
      targetGuid: "B",
      sourcePageItemTemplateID: 31,
      targetPageItemTemplateID: 32,
      sourceReferenceName: "hero",
      targetReferenceName: "hero",
    },
    urlRedirection: {
      sourceGuid: "A",
      targetGuid: "B",
      sourceUrlRedirectionID: 41,
      targetUrlRedirectionID: 42,
      originUrl: "/old-path",
    },
  };

  for (const [name, record] of Object.entries(samples)) {
    it(`swaps every source*/target* pair for a ${name} record`, () => {
      const t = transposeMappingRecord(record);
      for (const key of Object.keys(record)) {
        if (key.startsWith("source")) {
          expect(t[`target${key.slice(6)}`]).toEqual(record[key]);
        } else if (key.startsWith("target")) {
          expect(t[`source${key.slice(6)}`]).toEqual(record[key]);
        } else {
          expect(t[key]).toEqual(record[key]);
        }
      }
      expect(Object.keys(t).sort()).toEqual(Object.keys(record).sort());
    });

    it(`is an involution for a ${name} record (transpose twice = identity)`, () => {
      expect(transposeMappingRecord(transposeMappingRecord(record))).toEqual(record);
    });
  }

  it("leaves direction-agnostic fields untouched", () => {
    const t = transposeMappingRecord(samples.urlRedirection);
    expect(t.originUrl).toBe("/old-path");
    expect(t.sourceUrlRedirectionID).toBe(42);
    expect(t.targetUrlRedirectionID).toBe(41);
  });

  it("does not mutate its input", () => {
    const record = { ...samples.contentItem };
    const copy = { ...record };
    transposeMappingRecord(record);
    expect(record).toEqual(copy);
  });

  it("passes through null / non-object values", () => {
    expect(transposeMappingRecord(null as any)).toBeNull();
    expect(transposeMappingRecord(5 as any)).toBe(5);
  });

  it("transposeMappingRecords maps over an array and tolerates non-arrays", () => {
    const out = transposeMappingRecords([samples.contentItem, samples.page]);
    expect(out[0].sourceContentID).toBe(200);
    expect(out[1].sourcePageID).toBe(4);
    expect(transposeMappingRecords(undefined as any)).toBeUndefined();
  });
});

// ─── enableReverseSync ───────────────────────────────────────────────────────

describe("enableReverseSync", () => {
  it("throws when either guid is missing", () => {
    setState({ sourceGuid: "onlysource" });
    expect(() => enableReverseSync()).toThrow(/both --sourceGuid and --targetGuid/);
  });

  it("throws when source and target are the same instance", () => {
    setState({ sourceGuid: "same", targetGuid: "same" });
    expect(() => enableReverseSync()).toThrow(/two different instances/);
  });

  it("records the original pair, swaps the guids, and marks the run as a reverse sync", () => {
    setState({ sourceGuid: "orig-source", targetGuid: "orig-target" });
    enableReverseSync();
    const s = getState();
    expect(s.mappingPair).toEqual({ sourceGuid: "orig-source", targetGuid: "orig-target" });
    expect(s.sourceGuid).toBe("orig-target");
    expect(s.targetGuid).toBe("orig-source");
    expect(s.reverseSync).toBe(true);
    expect(s.isSync).toBe(true);
  });

  it("resetState clears reverse sync state", () => {
    setState({ sourceGuid: "orig-source", targetGuid: "orig-target" });
    enableReverseSync();
    resetState();
    const s = getState();
    expect(s.reverseSync).toBe(false);
    expect(s.mappingPair).toBeUndefined();
  });
});

// ─── fileOperations mapping path resolution ─────────────────────────────────

describe("fileOperations mapping paths under reverse sync", () => {
  beforeEach(() => freshPair());

  it("resolves to the original pair directory and never creates a reversed one", () => {
    // Forward sync writes a mapping.
    new fileOperations(B).saveMappingFile(
      [{ sourceGuid: A, targetGuid: B, sourceID: 1, targetID: 2 }],
      "models",
      A,
      B
    );

    setState({ sourceGuid: A, targetGuid: B });
    enableReverseSync();

    const ops = new fileOperations(getState().targetGuid);
    const swappedSource = getState().sourceGuid; // B
    const swappedTarget = getState().targetGuid; // A

    expect(ops.getMappingFilePath(swappedSource, swappedTarget)).toBe(path.join(tmpDir, "mappings", `${A}-${B}`));
    expect(ops.getMappingFilePath(swappedSource, swappedTarget, LOCALE)).toBe(
      path.join(tmpDir, "mappings", `${A}-${B}`, LOCALE)
    );

    ops.saveMappingFile([{ sourceGuid: B, targetGuid: A, sourceID: 9, targetID: 8 }], "models", swappedSource, swappedTarget);

    expect(fs.existsSync(path.join(tmpDir, "mappings", `${B}-${A}`))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "mappings", `${A}-${B}`, "models", "mappings.json"))).toBe(true);
  });

  it("transposes records on read and back on write, leaving the file in original orientation", () => {
    new fileOperations(B).saveMappingFile(
      [{ sourceGuid: A, targetGuid: B, sourceID: 1, targetID: 2, sourceReferenceName: "Post", targetReferenceName: "Post" }],
      "models",
      A,
      B
    );

    setState({ sourceGuid: A, targetGuid: B });
    enableReverseSync();
    const { sourceGuid: swappedSource, targetGuid: swappedTarget } = getState();
    const ops = new fileOperations(swappedTarget);

    // Read: the pipeline sees B as "source".
    const inMemory = ops.getMappingFile("models", swappedSource, swappedTarget);
    expect(inMemory).toEqual([
      { sourceGuid: B, targetGuid: A, sourceID: 2, targetID: 1, sourceReferenceName: "Post", targetReferenceName: "Post" },
    ]);

    // Write: append a record in the pipeline's (swapped) orientation.
    inMemory.push({ sourceGuid: B, targetGuid: A, sourceID: 20, targetID: 10, sourceReferenceName: "Author", targetReferenceName: "Author" });
    ops.saveMappingFile(inMemory, "models", swappedSource, swappedTarget);

    // On disk: everything is A→B.
    expect(readRawMappings("models")).toEqual([
      { sourceGuid: A, targetGuid: B, sourceID: 1, targetID: 2, sourceReferenceName: "Post", targetReferenceName: "Post" },
      { sourceGuid: A, targetGuid: B, sourceID: 10, targetID: 20, sourceReferenceName: "Author", targetReferenceName: "Author" },
    ]);
  });

  it("is a no-op for the identity pair and for unrelated pairs even while reverse sync is on", () => {
    setState({ sourceGuid: A, targetGuid: B });
    enableReverseSync();
    const ops = new fileOperations(A);

    // The original orientation still resolves to itself (no transposition).
    expect(ops.getMappingFilePath(A, B)).toBe(path.join(tmpDir, "mappings", `${A}-${B}`));
    // mapping-reader passes empty guids to find the mappings root.
    expect(ops.getMappingFilePath("", "")).toBe(path.join(tmpDir, "mappings", "-"));
    // A pair that is not the swapped one is untouched.
    expect(ops.getMappingFilePath("other1", "other2")).toBe(path.join(tmpDir, "mappings", "other1-other2"));
  });

  it("does not transpose when reverse sync is off", () => {
    new fileOperations(B).saveMappingFile([{ sourceGuid: A, targetGuid: B, sourceID: 1, targetID: 2 }], "models", A, B);
    const ops = new fileOperations(B);
    expect(ops.getMappingFile("models", A, B)).toEqual([{ sourceGuid: A, targetGuid: B, sourceID: 1, targetID: 2 }]);
    expect(ops.getMappingFilePath(B, A)).toBe(path.join(tmpDir, "mappings", `${B}-${A}`));
  });

  it("still refuses to write mapping files in preflight mode", () => {
    setState({ sourceGuid: A, targetGuid: B, preflight: true });
    enableReverseSync();
    const { sourceGuid: swappedSource, targetGuid: swappedTarget } = getState();
    new fileOperations(swappedTarget).saveMappingFile([{ sourceID: 1, targetID: 2 }], "models", swappedSource, swappedTarget);
    expect(fs.existsSync(path.join(tmpDir, "mappings", `${A}-${B}`))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "mappings", `${B}-${A}`))).toBe(false);
  });
});

// ─── backupMappingPair ───────────────────────────────────────────────────────

describe("fileOperations.backupMappingPair", () => {
  beforeEach(() => freshPair());

  it("returns null when the pair has no mapping directory", () => {
    expect(new fileOperations(A).backupMappingPair(A, B)).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, "mappings-backups"))).toBe(false);
  });

  it("copies the whole pair directory into mappings-backups outside the mappings root", () => {
    const ops = new fileOperations(B);
    ops.saveMappingFile([{ sourceID: 1, targetID: 2 }], "models", A, B);
    ops.saveMappingFile([{ sourceContentID: 3, targetContentID: 4 }], "item", A, B, LOCALE);

    const backupDir = ops.backupMappingPair(A, B);
    expect(backupDir).not.toBeNull();
    expect(backupDir!.startsWith(path.join(tmpDir, "mappings-backups", `${A}-${B}`))).toBe(true);

    expect(JSON.parse(fs.readFileSync(path.join(backupDir!, "models", "mappings.json"), "utf8"))).toEqual([
      { sourceID: 1, targetID: 2 },
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(backupDir!, LOCALE, "item", "mappings.json"), "utf8"))).toEqual([
      { sourceContentID: 3, targetContentID: 4 },
    ]);

    // Nothing was added under mappings/ that could be mistaken for a pair.
    expect(fs.readdirSync(path.join(tmpDir, "mappings")).filter((d) => d.includes(A))).toEqual([`${A}-${B}`]);
  });
});

// ─── End-to-end through a real mapper ────────────────────────────────────────

describe("ContentItemMapper during a reverse sync", () => {
  beforeEach(() => freshPair());

  function startReverseSync(): { swappedSource: string; swappedTarget: string } {
    setState({ sourceGuid: A, targetGuid: B });
    enableReverseSync();
    return { swappedSource: getState().sourceGuid, swappedTarget: getState().targetGuid };
  }

  it("sees forward mappings from the other side and can look items up by the original target id", () => {
    new ContentItemMapper(A, B, LOCALE).addMapping(makeItem(100), makeItem(200, 5));

    const { swappedSource, swappedTarget } = startReverseSync();
    const reverse = new ContentItemMapper(swappedSource, swappedTarget, LOCALE);

    // In the reverse run, B's item 200 is the "source"; it maps to A's item 100.
    const mapping = reverse.getContentItemMappingByContentID(200, "source");
    expect(mapping).not.toBeNull();
    expect(mapping!.targetContentID).toBe(100);
    expect(mapping!.sourceGuid).toBe(B);
    expect(mapping!.targetGuid).toBe(A);
    expect(mapping!.sourceVersionID).toBe(5);
    expect(mapping!.targetVersionID).toBe(1);
  });

  it("writes a newly created mapping back into the original file in A→B orientation", () => {
    new ContentItemMapper(A, B, LOCALE).addMapping(makeItem(100), makeItem(200));

    const { swappedSource, swappedTarget } = startReverseSync();
    const reverse = new ContentItemMapper(swappedSource, swappedTarget, LOCALE);

    // Item 300 exists only in B; the reverse sync creates it in A as 400.
    reverse.addMapping(makeItem(300, 2), makeItem(400, 7));

    const raw = readRawMappings("item", LOCALE);
    expect(raw).toHaveLength(2);
    const created = raw.find((m) => m.targetContentID === 300);
    expect(created).toMatchObject({
      sourceGuid: A,
      targetGuid: B,
      sourceContentID: 400,
      targetContentID: 300,
      sourceVersionID: 7,
      targetVersionID: 2,
    });
    // The pre-existing forward record is untouched.
    expect(raw.find((m) => m.sourceContentID === 100)).toMatchObject({ targetContentID: 200, sourceGuid: A, targetGuid: B });
    expect(fs.existsSync(path.join(tmpDir, "mappings", `${B}-${A}`))).toBe(false);
  });

  it("a later forward sync reads the record the reverse sync created", () => {
    new ContentItemMapper(A, B, LOCALE).addMapping(makeItem(100), makeItem(200));
    const { swappedSource, swappedTarget } = startReverseSync();
    new ContentItemMapper(swappedSource, swappedTarget, LOCALE).addMapping(makeItem(300), makeItem(400));

    // Back to a normal forward run.
    resetState();
    setState({ rootPath: tmpDir, sourceGuid: A, targetGuid: B });
    const forward = new ContentItemMapper(A, B, LOCALE);
    const mapping = forward.getContentItemMappingByContentID(400, "source");
    expect(mapping).not.toBeNull();
    expect(mapping!.targetContentID).toBe(300);
  });

  it("post-publish version refresh updates the original source's version in the file", async () => {
    new ContentItemMapper(A, B, LOCALE).addMapping(makeItem(100, 1), makeItem(200, 5));
    const { swappedSource, swappedTarget } = startReverseSync();

    // After the reverse run auto-publishes item 100 on A (the run's "target"), the refreshed
    // version fetched from A must land in the A-side field of the on-disk record.
    const mockGetContentItem = jest.fn().mockResolvedValue(makeItem(100, 9));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue({
      contentMethods: { getContentItem: mockGetContentItem },
      pageMethods: { getPage: jest.fn() },
    } as any);

    const result = await updateContentMappingsAfterPublish([100], swappedSource, swappedTarget, LOCALE);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockGetContentItem).toHaveBeenCalledWith(100, A, LOCALE);

    const raw = readRawMappings("item", LOCALE);
    expect(raw).toEqual([
      { sourceGuid: A, targetGuid: B, sourceContentID: 100, targetContentID: 200, sourceVersionID: 9, targetVersionID: 5 },
    ]);
  });
});
