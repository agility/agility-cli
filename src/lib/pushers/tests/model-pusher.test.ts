import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-model-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-model-u", targetGuid: "tgt-model-u", token: "test-token" });
  initializeGuidLogger("src-model-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let modelCounter = 0;

function makeModel(overrides: Record<string, any> = {}): any {
  modelCounter++;
  return {
    id: modelCounter,
    referenceName: `model-${modelCounter}`,
    displayName: `Model ${modelCounter}`,
    lastModifiedDate: new Date(2020, 0, 1).toISOString(),
    fields: [],
    ...overrides,
  };
}

function makeApiClient(saveModelImpl?: jest.Mock, getContentModulesImpl?: jest.Mock): any {
  return {
    modelMethods: {
      saveModel: saveModelImpl ?? jest.fn().mockResolvedValue(makeModel({ id: 999 })),
      getContentModules: getContentModulesImpl ?? jest.fn().mockResolvedValue([]),
    },
  };
}

// ─── pushModels — empty sourceData guard ──────────────────────────────────────

describe("pushModels — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushModels } = await import("../model-pusher");
    const result = await pushModels([], []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns success with zeros when sourceData is null", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushModels } = await import("../model-pusher");
    const result = await pushModels(null as any, []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });
});

// ─── pushModels — result shape ────────────────────────────────────────────────

describe("pushModels — result shape", () => {
  it("result has status, successful, failed, skipped fields", async () => {
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient());

    const { pushModels } = await import("../model-pusher");
    const result = await pushModels([], []);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });
});

// ─── pushModels — existsInTargetWithoutMapping ────────────────────────────────

describe("pushModels — model exists in target but no mapping and is default", () => {
  it("skips model that already exists in target by referenceName but has no mapping", async () => {
    const saveModel = jest.fn().mockResolvedValue(makeModel({ id: 999 }));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import("../model-pusher");

    const now = new Date().toISOString();
    const sourceModel = makeModel({ referenceName: "agilitycodetemplate", lastModifiedDate: now });
    const targetModel = makeModel({ id: 42, referenceName: "agilitycodetemplate", lastModifiedDate: now });

    const result = await pushModels([sourceModel], [targetModel]);

    // Should skip because it already exists in target
    expect(result.successful).toBe(0);
    expect(saveModel).not.toHaveBeenCalled();
  });
});

// ─── pushModels — shouldCreateStub path ───────────────────────────────────────

describe("pushModels — create stub path", () => {
  it("calls saveModel to create a stub when model has no mapping and does not exist in target", async () => {
    const createdStub = makeModel({ id: 777 });
    const saveModel = jest.fn().mockResolvedValue(createdStub);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import("../model-pusher");

    const sourceModel = makeModel({ referenceName: "brand-new-model" });

    const result = await pushModels([sourceModel], []);

    // saveModel called once for the stub, then once more for updateExistingModel
    expect(saveModel).toHaveBeenCalledTimes(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("counts model as failed when saveModel throws during stub creation", async () => {
    const saveModel = jest.fn().mockRejectedValue(new Error("API error"));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import("../model-pusher");

    const sourceModel = makeModel({ referenceName: "failing-model" });

    const result = await pushModels([sourceModel], []);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
  });
});

// ─── pushModels — source-side rename orphans a mapping and halts the sync (PROD-1439) ──────

describe("pushModels — source-side rename orphans a mapping and halts the sync (PROD-1439)", () => {
  it('throws "Model validation failed" (and writes nothing) when a renamed model loses its mapping to a reused-name sibling', async () => {
    const { ModelMapper } = await import("lib/mappers/model-mapper");

    // Seed the mapping exactly as it looked BEFORE the rename:
    //   source model 248 ("ContactUsSendMessageForm") -> target model 118.
    const seeder = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    seeder.addMapping(
      {
        id: 248,
        referenceName: "ContactUsSendMessageForm",
        lastModifiedDate: new Date(2025, 0, 1).toISOString(),
      } as any,
      {
        id: 118,
        referenceName: "ContactUsSendMessageForm",
        lastModifiedDate: new Date(2025, 0, 1).toISOString(),
      } as any
    );

    const saveModel = jest.fn().mockResolvedValue(makeModel({ id: 999 }));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import("../model-pusher");

    // On the source: model 248 was renamed to "...Legacy", and a NEW model 254 reused the old name.
    const renamedModel = makeModel({
      id: 248,
      referenceName: "ContactUsSendMessageFormLegacy",
      lastModifiedDate: new Date(2025, 11, 4).toISOString(),
    });
    const reusedNameModel = makeModel({
      id: 254,
      referenceName: "ContactUsSendMessageForm",
      lastModifiedDate: new Date(2025, 11, 4).toISOString(),
    });
    // Target still only has the original "ContactUsSendMessageForm" (id 118), no "...Legacy".
    const targetModel = makeModel({
      id: 118,
      referenceName: "ContactUsSendMessageForm",
      lastModifiedDate: new Date(2025, 0, 1).toISOString(),
    });

    // 248 is classified for update; processing the reused-name sibling reassigns (steals) the
    // shared target-118 mapping, leaving 248 with no mapping. The integrity gate must detect this
    // and stop the whole sync with a "Model validation failed" error — before any model is written.
    await expect(pushModels([renamedModel, reusedNameModel], [targetModel])).rejects.toThrow(/Model validation failed/);

    expect(saveModel).not.toHaveBeenCalled();
  });
});

// ─── PROD-2211: honest failure reporting ──────────────────────────────────────

describe("pushModels — failed update is reported as failed, not success (PROD-2211)", () => {
  it("counts a model whose field-update genuinely fails as failed", async () => {
    // Stub create succeeds; the follow-up field update is rejected (e.g. 404). Must be a failure.
    const saveModel = jest
      .fn()
      .mockResolvedValueOnce(makeModel({ id: 55, referenceName: "FooterLinks" }))
      .mockRejectedValue(new Error("Unable to save the model."));
    // Re-query returns the stub (0 fields) — does NOT match the source field count, so no recovery.
    const getContentModules = jest
      .fn()
      .mockResolvedValue([makeModel({ id: 55, referenceName: "FooterLinks", fields: [] })]);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel, getContentModules));

    const { pushModels } = await import("../model-pusher");
    const sourceModel = makeModel({
      id: 410,
      referenceName: "FooterLinks",
      contentDefinitionTypeID: 1,
      fields: [{ name: "a" }, { name: "b" }],
    });

    const result = await pushModels([sourceModel], []);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failureDetails?.some((f) => f.name === "FooterLinks")).toBe(true);
  });
});

// ─── PROD-2211: false-negative create recovery ────────────────────────────────

describe("pushModels — false-negative create recovery (PROD-2211)", () => {
  it("recovers as success + writes a mapping when the create throws but the model exists on target", async () => {
    const sourceModel = makeModel({ id: 700, referenceName: "RetailerLocatorSearchPanel", contentDefinitionTypeID: 1 });
    // Stub create rejects (false-negative); the follow-up update then succeeds normally.
    const saveModel = jest
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue(makeModel({ id: 8, referenceName: "RetailerLocatorSearchPanel" }));
    const getContentModules = jest
      .fn()
      .mockResolvedValue([
        makeModel({ id: 8, referenceName: "RetailerLocatorSearchPanel", contentDefinitionTypeID: 1 }),
      ]);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel, getContentModules));

    const { ModelMapper } = await import("lib/mappers/model-mapper");
    const { pushModels } = await import("../model-pusher");

    const result = await pushModels([sourceModel], []);

    expect(getContentModules).toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.successful).toBe(1);
    const mapper = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    expect(mapper.getModelMappingByID(700, "source")?.targetID).toBe(8);
  });

  it("stays failed when the create throws and only a different-typed same-name model exists", async () => {
    const sourceModule = makeModel({ id: 800, referenceName: "PromoBanner", contentDefinitionTypeID: 2 });
    const saveModel = jest.fn().mockRejectedValue(new Error("Unable to save the model."));
    // Only a same-name Content List (type 1) exists — not a match for the Module (type 2).
    const getContentModules = jest
      .fn()
      .mockResolvedValue([makeModel({ id: 9, referenceName: "PromoBanner", contentDefinitionTypeID: 1 })]);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel, getContentModules));

    const { pushModels } = await import("../model-pusher");
    const result = await pushModels([sourceModule], []);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
  });

  it("recovers a failed UPDATE when the saved field set matches the source", async () => {
    // Mapping exists (model already on target); the update throws but the fields were persisted.
    const { ModelMapper } = await import("lib/mappers/model-mapper");
    const seeder = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    seeder.addMapping(
      { id: 300, referenceName: "Header", lastModifiedDate: new Date(2024, 0, 1).toISOString() } as any,
      { id: 30, referenceName: "Header", lastModifiedDate: new Date(2024, 0, 1).toISOString() } as any
    );

    const saveModel = jest.fn().mockRejectedValue(new Error("Unable to save the model."));
    // Re-query shows the target now has the same field count as the source → recovered.
    const getContentModules = jest
      .fn()
      .mockResolvedValue([makeModel({ id: 30, referenceName: "Header", fields: [{ name: "x" }, { name: "y" }] })]);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel, getContentModules));

    const { pushModels } = await import("../model-pusher");
    const sourceModel = makeModel({
      id: 300,
      referenceName: "Header",
      lastModifiedDate: new Date(2025, 0, 1).toISOString(), // newer than mapping → triggers update
      fields: [{ name: "x" }, { name: "y" }],
    });

    const targetModel = makeModel({
      id: 30,
      referenceName: "Header",
      lastModifiedDate: new Date(2024, 0, 1).toISOString(),
    });

    const result = await pushModels([sourceModel], [targetModel]);

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ─── PROD-2211: adopt existing target model without a mapping ─────────────────

describe("pushModels — exists in target without mapping, non-default (PROD-2211)", () => {
  it("writes a mapping row and skips instead of silently dropping the model", async () => {
    const saveModel = jest.fn().mockResolvedValue(makeModel({ id: 999 }));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { ModelMapper } = await import("lib/mappers/model-mapper");
    const { pushModels } = await import("../model-pusher");

    const sourceModel = makeModel({ id: 501, referenceName: "Header", contentDefinitionTypeID: 1 });
    const targetModel = makeModel({ id: 10, referenceName: "Header", contentDefinitionTypeID: 1 });

    const result = await pushModels([sourceModel], [targetModel]);

    expect(saveModel).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);

    const mapper = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    expect(mapper.getModelMappingByID(501, "source")?.targetID).toBe(10);
  });

  it("does NOT adopt a same-name target model of a different type (type-blind lookup)", async () => {
    const createdStub = makeModel({ id: 888, referenceName: "PromoBanner", contentDefinitionTypeID: 2 });
    const saveModel = jest.fn().mockResolvedValue(createdStub);
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const { pushModels } = await import("../model-pusher");

    const sourceModel = makeModel({ id: 600, referenceName: "PromoBanner", contentDefinitionTypeID: 2 });
    const targetContentList = makeModel({ id: 9, referenceName: "PromoBanner", contentDefinitionTypeID: 1 });

    const result = await pushModels([sourceModel], [targetContentList]);

    expect(saveModel).toHaveBeenCalled(); // goes through create, not adopted
    expect(result.skipped).toBe(0);
  });
});

// ─── PROD-2250: mapped-before-unmapped model processing order ────────────────

describe("pushModels — mapped-before-unmapped ordering (PROD-2250)", () => {
  // Spies on ModelMapper#getModelMappingByID so we can observe the ORDER source
  // models are walked through the main categorization loop, without depending
  // on which downstream branch (create/update/skip) each model takes.
  function spyOnSourceMappingLookupOrder(ModelMapperClass: any): number[] {
    const callOrder: number[] = [];
    const original = ModelMapperClass.prototype.getModelMappingByID;
    jest.spyOn(ModelMapperClass.prototype, "getModelMappingByID").mockImplementation(function (
      this: any,
      id: number,
      type: "source" | "target"
    ) {
      if (type === "source") callOrder.push(id);
      return original.call(this, id, type);
    });
    return callOrder;
  }

  // Unique target IDs per saveModel call avoid mapping-row collisions — both
  // within a single run and across the tests in this describe block, since the
  // mapping file persists on disk for the shared source/target GUID pair until
  // afterAll removes tmpDir. Counter is shared (not reset per test) on purpose.
  let uniqueTargetIdCounter = 90000;
  function makeUniqueSaveModel() {
    return jest
      .fn()
      .mockImplementation(async (payload: any) =>
        makeModel({ id: ++uniqueTargetIdCounter, referenceName: payload.referenceName })
      );
  }

  it("processes already-mapped source models before brand-new unmapped ones", async () => {
    const { ModelMapper } = await import("lib/mappers/model-mapper");

    const fixedDateB = new Date(2024, 0, 1).toISOString();
    const fixedDateD = new Date(2024, 5, 1).toISOString();

    const seeder = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    const sourceB = makeModel({ id: 102, referenceName: "ModelB-Mapped", lastModifiedDate: fixedDateB });
    const targetB = makeModel({ id: 1020, referenceName: "ModelB-Mapped", lastModifiedDate: fixedDateB });
    seeder.addMapping(sourceB, targetB);
    const sourceD = makeModel({ id: 104, referenceName: "ModelD-Mapped", lastModifiedDate: fixedDateD });
    const targetD = makeModel({ id: 1040, referenceName: "ModelD-Mapped", lastModifiedDate: fixedDateD });
    seeder.addMapping(sourceD, targetD);

    const modelA = makeModel({ id: 101, referenceName: "ModelA-Unmapped" });
    const modelC = makeModel({ id: 103, referenceName: "ModelC-Unmapped" });

    const saveModel = makeUniqueSaveModel();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const callOrder = spyOnSourceMappingLookupOrder(ModelMapper);

    const { pushModels } = await import("../model-pusher");
    // Interleaved input: unmapped, mapped, unmapped, mapped.
    await pushModels([modelA, sourceB, modelC, sourceD], [targetB, targetD]);

    // The first 4 calls are the partition pass (walks input order); the last 4
    // are the main categorization loop, which walks the reordered list —
    // already-mapped models first, then the unmapped ones.
    expect(callOrder).toHaveLength(8);
    expect(callOrder.slice(0, 4)).toEqual([101, 102, 103, 104]);
    expect(callOrder.slice(-4)).toEqual([102, 104, 101, 103]);
  });

  it("preserves each group's original relative order when multiple models share mapped/unmapped status", async () => {
    const { ModelMapper } = await import("lib/mappers/model-mapper");

    const seeder = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    // Intentionally descending / non-sorted IDs so preserved order can't be mistaken for a sort.
    const mappedSources = [402, 401, 400].map((id) =>
      makeModel({ id, referenceName: `Mapped-${id}`, lastModifiedDate: new Date(2024, 0, 1).toISOString() })
    );
    const mappedTargets = mappedSources.map((s) =>
      makeModel({ id: s.id * 10, referenceName: s.referenceName, lastModifiedDate: s.lastModifiedDate })
    );
    mappedSources.forEach((s, i) => seeder.addMapping(s, mappedTargets[i]));

    const unmappedSources = [301, 305, 309].map((id) => makeModel({ id, referenceName: `Unmapped-${id}` }));

    const sourceData = [
      unmappedSources[0],
      mappedSources[0],
      unmappedSources[1],
      mappedSources[1],
      unmappedSources[2],
      mappedSources[2],
    ];

    const saveModel = makeUniqueSaveModel();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const callOrder = spyOnSourceMappingLookupOrder(ModelMapper);

    const { pushModels } = await import("../model-pusher");
    await pushModels(sourceData, mappedTargets);

    expect(callOrder.slice(-6)).toEqual([402, 401, 400, 301, 305, 309]);
  });

  it("leaves processing order unchanged on a clean run with no existing mappings", async () => {
    const { ModelMapper } = await import("lib/mappers/model-mapper");

    const sourceData = [11, 12, 13, 14].map((id) => makeModel({ id, referenceName: `Clean-${id}` }));

    const saveModel = makeUniqueSaveModel();
    jest.spyOn(stateModule, "getApiClient").mockReturnValue(makeApiClient(saveModel));

    const callOrder = spyOnSourceMappingLookupOrder(ModelMapper);

    const { pushModels } = await import("../model-pusher");
    const result = await pushModels(sourceData, []);

    // No existingMappedModels group; ordering and outcome match a plain input-order run.
    expect(callOrder.slice(-4)).toEqual([11, 12, 13, 14]);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.successful).toBe(4);
  });
});
