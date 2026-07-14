import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-cont-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-cont-u", targetGuid: "tgt-cont-u", token: "test-token" });
  initializeGuidLogger("src-cont-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let containerCounter = 0;

function makeContainer(overrides: Record<string, any> = {}): any {
  containerCounter++;
  return {
    contentViewID: containerCounter,
    referenceName: `container-${containerCounter}`,
    contentDefinitionID: containerCounter + 100,
    title: `Container ${containerCounter}`,
    contentViewName: `Container ${containerCounter}`,
    lastModifiedDate: new Date().toISOString(),
    ...overrides,
  };
}

// ─── pushContainers — empty sourceData guard ──────────────────────────────────

describe("pushContainers — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty", async () => {
    const { pushContainers } = await import("../container-pusher");
    const result = await pushContainers([], []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns success with zeros when sourceData is null", async () => {
    const { pushContainers } = await import("../container-pusher");
    const result = await pushContainers(null as any, []);

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });
});

// ─── pushContainers — special containers are skipped ──────────────────────────

describe("pushContainers — built-in Agility containers are skipped", () => {
  it.each([
    "AgilityCSSFiles",
    "AgilityJavascriptFiles",
    "AgilityGlobalCodeTemplates",
    "AgilityModuleCodeTemplates",
    "AgilityPageCodeTemplates",
  ])("skips %s without calling the API", async (referenceName) => {
    const saveContainer = jest.fn().mockResolvedValue(makeContainer());
    state.cachedApiClient = {
      containerMethods: { saveContainer },
    } as any;

    const { pushContainers } = await import("../container-pusher");

    const specialContainer = makeContainer({ referenceName });

    const result = await pushContainers([specialContainer], []);

    expect(saveContainer).not.toHaveBeenCalled();
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// ─── pushContainers — shouldCreate path: no model mapping ─────────────────────

describe("pushContainers — create path: no model mapping", () => {
  it("skips container when no target model mapping found", async () => {
    const saveContainer = jest.fn().mockResolvedValue(makeContainer());
    state.cachedApiClient = {
      containerMethods: { saveContainer },
    } as any;

    const { pushContainers } = await import("../container-pusher");

    // Container with contentDefinitionID that has no model mapping
    const sourceContainer = makeContainer({ contentDefinitionID: 9999 });

    const result = await pushContainers([sourceContainer], []);

    // No model mapping found → skipped
    expect(result.skipped).toBe(1);
    expect(saveContainer).not.toHaveBeenCalled();
  });
});

// ─── pushContainers — special case: contentDefinitionID === 1 ─────────────────

describe("pushContainers — RichTextArea special case", () => {
  it("attempts to create container when contentDefinitionID is 1 (RichTextArea)", async () => {
    const newContainer = makeContainer({ contentViewID: 500, contentDefinitionID: 1 });
    const saveContainer = jest.fn().mockResolvedValue(newContainer);
    state.cachedApiClient = {
      containerMethods: { saveContainer },
    } as any;

    const { pushContainers } = await import("../container-pusher");

    const sourceContainer = makeContainer({ contentDefinitionID: 1 });

    const result = await pushContainers([sourceContainer], []);

    // With contentDefinitionID=1 the targetModelID is set to 1 (always valid)
    expect(saveContainer).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("counts as failed when saveContainer throws", async () => {
    const saveContainer = jest.fn().mockRejectedValue(new Error("API error"));
    state.cachedApiClient = {
      containerMethods: { saveContainer },
    } as any;

    const { pushContainers } = await import("../container-pusher");

    const sourceContainer = makeContainer({ contentDefinitionID: 1 });

    const result = await pushContainers([sourceContainer], []);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.status).toBe("error");
  });
});

// ─── pushContainers — PROD-2307 adopt-by-referenceName ────────────────────────

describe("pushContainers — adopt existing target container by referenceName (PROD-2307)", () => {
  it("adopts an unmapped target container that matches by referenceName instead of creating", async () => {
    const saveContainer = jest.fn();
    state.cachedApiClient = { containerMethods: { saveContainer } } as any;

    const { ContainerMapper } = await import("lib/mappers/container-mapper");
    const addMappingSpy = jest.spyOn(ContainerMapper.prototype, "addMapping");

    const { pushContainers } = await import("../container-pusher");

    // Source has no mapping row (fresh cache); target already has a same-named container.
    const source = makeContainer({ referenceName: "AdoptMe", contentDefinitionID: 500 });
    const target = makeContainer({ referenceName: "AdoptMe", contentDefinitionID: 500 });

    const result = await pushContainers([source], [target]);

    // Adopted, not created.
    expect(saveContainer).not.toHaveBeenCalled();
    expect(addMappingSpy).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("matches referenceName case-insensitively", async () => {
    const saveContainer = jest.fn();
    state.cachedApiClient = { containerMethods: { saveContainer } } as any;

    const { pushContainers } = await import("../container-pusher");

    const source = makeContainer({ referenceName: "MixedCase", contentDefinitionID: 500 });
    const target = makeContainer({ referenceName: "mixedcase", contentDefinitionID: 500 });

    const result = await pushContainers([source], [target]);

    expect(saveContainer).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("still creates when no target container matches by referenceName", async () => {
    const created = makeContainer({ contentViewID: 777, contentDefinitionID: 1 });
    const saveContainer = jest.fn().mockResolvedValue(created);
    state.cachedApiClient = { containerMethods: { saveContainer } } as any;

    const { pushContainers } = await import("../container-pusher");

    // contentDefinitionID=1 → RichTextArea special case makes targetModelID valid, so create proceeds.
    const source = makeContainer({ referenceName: "BrandNew", contentDefinitionID: 1 });
    const nonMatch = makeContainer({ referenceName: "SomethingElse" });

    const result = await pushContainers([source], [nonMatch]);

    expect(saveContainer).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
  });

  it("does not write a mapping during preflight (dry run), but still records the adopt as a skip", async () => {
    state.preflight = true;
    const saveContainer = jest.fn();
    state.cachedApiClient = { containerMethods: { saveContainer } } as any;

    const { ContainerMapper } = await import("lib/mappers/container-mapper");
    const addMappingSpy = jest.spyOn(ContainerMapper.prototype, "addMapping");

    const { pushContainers } = await import("../container-pusher");

    const source = makeContainer({ referenceName: "PreflightAdopt", contentDefinitionID: 500 });
    const target = makeContainer({ referenceName: "PreflightAdopt", contentDefinitionID: 500 });

    const result = await pushContainers([source], [target]);

    expect(saveContainer).not.toHaveBeenCalled();
    expect(addMappingSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});

// ─── pushContainers — result shape ────────────────────────────────────────────

describe("pushContainers — result shape", () => {
  it("result has status, successful, failed, skipped fields", async () => {
    const { pushContainers } = await import("../container-pusher");
    const result = await pushContainers([], []);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });
});
