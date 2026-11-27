import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, initializeGuidLogger } from "core/state";
import * as stateModule from "core/state";
import { ModelMapper } from "lib/mappers/model-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { SectionMapper } from "lib/mappers/section-mapper";
import { preflightReport } from "../../preflight/preflight-report";
import { pushModelAvailability } from "../model-availability-pusher";

const SOURCE = "src-avail-u";
const TARGET = "tgt-avail-u";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-availability-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: SOURCE, targetGuid: TARGET, token: "test-token" });
  // Mappings and pulled rules would otherwise leak between tests (shared tmpDir, fixed guids).
  fs.rmSync(path.join(tmpDir, "mappings"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, SOURCE), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, TARGET), { recursive: true, force: true });
  preflightReport.reset();
  initializeGuidLogger(SOURCE, "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Write pulled rules for an instance; `null` leaves the folder out (rules unknown). */
function writeRules(guid: string, rules: any[] | null) {
  const folder = path.join(tmpDir, guid, "model-availability");
  fs.rmSync(folder, { recursive: true, force: true });
  if (rules === null) return;
  fs.mkdirSync(folder, { recursive: true });
  for (const rule of rules) fs.writeFileSync(path.join(folder, `${rule.modelID}.json`), JSON.stringify(rule));
}

function mapModel(sourceID: number, targetID: number, referenceName = "HeroBanner") {
  new ModelMapper(SOURCE, TARGET).addMapping(
    { id: sourceID, referenceName, lastModifiedDate: "2026-01-01" } as any,
    { id: targetID, referenceName, lastModifiedDate: "2026-01-01" } as any
  );
}

function mapTemplateAndZone() {
  new TemplateMapper(SOURCE, TARGET).addMapping(
    { pageTemplateID: 3, pageTemplateName: "Landing Page" } as any,
    { pageTemplateID: 30, pageTemplateName: "Landing Page" } as any
  );
  new SectionMapper(SOURCE, TARGET).addMapping(
    { pageItemTemplateID: 14, pageItemTemplateReferenceName: "HeroZone" } as any,
    { pageItemTemplateID: 140, pageItemTemplateReferenceName: "HeroZone" } as any
  );
}

const sourceModel = { id: 12, referenceName: "HeroBanner" } as any;

const sourceAllowedIn = {
  sitemaps: [{ sitemapID: 1, referenceName: "website", name: "Website" }],
  pageModels: [{ pageModelID: 3, name: "Landing Page" }],
  zones: [{ zoneID: 14, pageModelID: 3, pageModelName: "Landing Page", referenceName: "HeroZone", name: "Hero Zone" }],
};

function sourceRule(overrides: any = {}) {
  return {
    modelID: 12,
    modelReferenceName: "HeroBanner",
    addableBy: { permissions: ["Administrator"], users: [{ userID: 5, emailAddress: "a@example.com" }], teams: [] },
    allowedIn: sourceAllowedIn,
    ...overrides,
  };
}

function mockApi(save: jest.Mock = jest.fn().mockResolvedValue({})) {
  jest.spyOn(stateModule, "getApiClient").mockReturnValue({ modelMethods: { saveModelAvailability: save } } as any);
  return save;
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

// ─── pushModelAvailability ────────────────────────────────────────────────────

describe("pushModelAvailability", () => {
  it("sends allowedIn only, with addableBy null so the target keeps its own who rules", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(result).toMatchObject({ status: "success", successful: 1, failed: 0 });
    expect(save).toHaveBeenCalledTimes(1);
    const [modelID, body, guid] = save.mock.calls[0];
    expect(modelID).toBe(120);
    expect(guid).toBe(TARGET);
    expect(body.modelID).toBe(120);
    expect(body.addableBy).toBeNull();
    expect(body.allowedIn).toBeDefined();
  });

  it("remaps by name and never sends a source ID", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const save = mockApi();

    await pushModelAvailability([sourceModel]);

    expect(save.mock.calls[0][1].allowedIn).toEqual({
      sitemaps: [{ referenceName: "website", name: "Website" }],
      pageModels: [{ name: "Landing Page" }],
      zones: [{ pageModelName: "Landing Page", referenceName: "HeroZone", name: "Hero Zone" }],
    });
  });

  it("uses the sync's template and zone mappings for target IDs when they exist", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mapTemplateAndZone();
    const save = mockApi();

    await pushModelAvailability([sourceModel]);

    const allowedIn = save.mock.calls[0][1].allowedIn;
    expect(allowedIn.pageModels).toEqual([{ pageModelID: 30, name: "Landing Page" }]);
    expect(allowedIn.zones).toEqual([
      { zoneID: 140, pageModelID: 30, pageModelName: "Landing Page", referenceName: "HeroZone", name: "Hero Zone" },
    ]);
    // Sitemaps have no mapping: by referenceName only.
    expect(allowedIn.sitemaps).toEqual([{ referenceName: "website", name: "Website" }]);
  });

  it("skips a model whose target already has the same placement rules", async () => {
    writeRules(SOURCE, [sourceRule()]);
    // Target has its own IDs and its own who rules; only the placement names are compared.
    writeRules(TARGET, [
      {
        modelID: 120,
        addableBy: { permissions: ["Designer"], users: [], teams: [] },
        allowedIn: {
          sitemaps: [{ sitemapID: 7, referenceName: "Website", name: "Website" }],
          pageModels: [{ pageModelID: 30, name: "landing page" }],
          zones: [{ zoneID: 140, pageModelID: 30, pageModelName: "Landing Page", referenceName: "HeroZone" }],
        },
      },
    ]);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 0, skipped: 1, failed: 0 });
  });

  it("clears the target's placement rules when the source has none", async () => {
    writeRules(SOURCE, [sourceRule({ allowedIn: null })]);
    writeRules(TARGET, [{ modelID: 120, addableBy: null, allowedIn: sourceAllowedIn }]);
    mapModel(12, 120);
    const save = mockApi();

    await pushModelAvailability([sourceModel]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toEqual({
      modelID: 120,
      addableBy: null,
      allowedIn: { sitemaps: [], pageModels: [], zones: [] },
    });
  });

  it("also clears when the source model has no rules file, once the source has listed any rule", async () => {
    // Another model's rules prove the source stores them, so no file for model 12 means "no rules".
    writeRules(SOURCE, [sourceRule({ modelID: 13, modelReferenceName: "Other" })]);
    writeRules(TARGET, [{ modelID: 120, addableBy: null, allowedIn: sourceAllowedIn }]);
    mapModel(12, 120);
    const save = mockApi();

    await pushModelAvailability([sourceModel]);

    expect(save.mock.calls[0][1].allowedIn).toEqual({ sitemaps: [], pageModels: [], zones: [] });
  });

  it("never clears from a source that has no rules at all (it may not have been migrated yet)", async () => {
    // An unmigrated database answers with an empty list, exactly like one with no rules.
    writeRules(SOURCE, []);
    writeRules(TARGET, [{ modelID: 120, addableBy: null, allowedIn: sourceAllowedIn }]);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "success", successful: 0, skipped: 0, failed: 0 });
  });

  it("never clears when the target's rules are unknown", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, null);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 0, skipped: 0, failed: 0 });
    expect(result.warningDetails).toEqual([]);
  });

  it("pushes nothing and warns once when the source has rules but the target's couldn't be read", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, null);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "success", failed: 0 });
    expect(result.warningDetails).toHaveLength(1);
    expect(result.warningDetails[0].error).toMatch(/couldn't be read/);
  });

  it("does nothing when the source's rules weren't pulled (an instance without the feature)", async () => {
    writeRules(SOURCE, null);
    writeRules(TARGET, [{ modelID: 120, addableBy: null, allowedIn: sourceAllowedIn }]);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "success", successful: 0, skipped: 0, failed: 0 });
  });

  it("leaves models with no rules on either side alone, and doesn't count them", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 0, skipped: 0, failed: 0 });
  });

  it("skips a model that has rules but no target mapping (the model itself wasn't synced)", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, []);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("only touches models in the sync's scope", async () => {
    writeRules(SOURCE, [sourceRule(), sourceRule({ modelID: 13, modelReferenceName: "Other" })]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mapModel(13, 130, "Other");
    const save = mockApi();

    await pushModelAvailability([sourceModel]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe(120);
  });

  it("reports a rejected save (e.g. an unresolved zone) as a model failure with the API's reason", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mockApi(jest.fn().mockRejectedValue(httpError(400, 'Unknown zone "Landing Page" / "HeroZone".')));

    const result = await pushModelAvailability([sourceModel]);

    expect(result).toMatchObject({ status: "error", successful: 0, failed: 1 });
    expect(result.failureDetails[0]).toMatchObject({ name: "HeroBanner", type: "model", guid: SOURCE });
    expect(result.failureDetails[0].error).toContain('Unknown zone "Landing Page" / "HeroZone".');
  });

  it("counts a 404 with the API's message (a stale model mapping) as that model's failure, and carries on", async () => {
    writeRules(SOURCE, [sourceRule(), sourceRule({ modelID: 13, modelReferenceName: "Other" })]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mapModel(13, 130, "Other");
    const notFound = Object.assign(httpError(404, "Unable to save availability for model id: 120."), {
      responseData: { message: "The model with ID 120 could not be located." },
    });
    const save = mockApi(jest.fn().mockRejectedValueOnce(notFound).mockResolvedValueOnce({}));

    const result = await pushModelAvailability([sourceModel, { id: 13, referenceName: "Other" } as any]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "error", successful: 1, failed: 1 });
    expect(result.failureDetails[0]).toMatchObject({ name: "HeroBanner" });
    expect(result.warningDetails).toEqual([]);
  });

  it("reports a 403 once, not once per model, and stops", async () => {
    writeRules(SOURCE, [sourceRule(), sourceRule({ modelID: 13, modelReferenceName: "Other" })]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mapModel(13, 130, "Other");
    const save = mockApi(jest.fn().mockRejectedValue(httpError(403, "Forbidden")));

    const result = await pushModelAvailability([sourceModel, { id: 13, referenceName: "Other" } as any]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "error", failed: 1 });
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails[0].error).toMatch(/needs the Manage or Design permission/);
  });

  it.each([404, 405, 409])(
    "stops with one warning when the target answers %i (feature not available)",
    async (status) => {
      writeRules(SOURCE, [sourceRule(), sourceRule({ modelID: 13, modelReferenceName: "Other" })]);
      writeRules(TARGET, []);
      mapModel(12, 120);
      mapModel(13, 130, "Other");
      const save = mockApi(jest.fn().mockRejectedValue(httpError(status, "not available")));

      const result = await pushModelAvailability([sourceModel, { id: 13, referenceName: "Other" } as any]);

      expect(save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "success", failed: 0 });
      expect(result.warningDetails).toHaveLength(1);
      expect(result.warningDetails[0].error).toMatch(/doesn't support component availability rules yet/);
    }
  );

  it("leaves stale (deleted) source targets out of the save", async () => {
    writeRules(SOURCE, [
      sourceRule({
        allowedIn: {
          sitemaps: [...sourceAllowedIn.sitemaps, { sitemapID: 2, stale: true }],
          pageModels: [...sourceAllowedIn.pageModels, { pageModelID: 4, stale: true }],
          zones: [...sourceAllowedIn.zones, { zoneID: 15, stale: true }],
        },
      }),
    ]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(result).toMatchObject({ status: "success", successful: 1, failed: 0 });
    expect(result.warningDetails).toEqual([]);
    expect(save.mock.calls[0][1].allowedIn).toEqual({
      sitemaps: [{ referenceName: "website", name: "Website" }],
      pageModels: [{ name: "Landing Page" }],
      zones: [{ pageModelName: "Landing Page", referenceName: "HeroZone", name: "Hero Zone" }],
    });
  });

  it.each([
    ["sitemap", { sitemaps: [{ sitemapID: 2, stale: true }], pageModels: sourceAllowedIn.pageModels, zones: [] }],
    [
      "page model and zone",
      {
        sitemaps: sourceAllowedIn.sitemaps,
        pageModels: [{ pageModelID: 4, stale: true }],
        zones: [{ zoneID: 15, stale: true }],
      },
    ],
  ])(
    "skips a model with a warning when every %s in its rule is stale (sending it empty would widen it)",
    async (part, allowedIn) => {
      writeRules(SOURCE, [sourceRule({ allowedIn })]);
      writeRules(TARGET, [{ modelID: 120, addableBy: null, allowedIn: sourceAllowedIn }]);
      mapModel(12, 120);
      const save = mockApi();

      const result = await pushModelAvailability([sourceModel]);

      expect(save).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "success", successful: 0, skipped: 1, failed: 0 });
      expect(result.warningDetails).toHaveLength(1);
      expect(result.warningDetails[0]).toMatchObject({ name: "HeroBanner", type: "model" });
      expect(result.warningDetails[0].error).toContain(`every ${part} it's limited to`);
      expect(result.warningDetails[0].error).toMatch(/would allow the component everywhere/);
    }
  );

  it("still syncs the layout rule when only some page models and zones are stale", async () => {
    // A stale page model next to a live zone: the zone keeps the rule restricted.
    writeRules(SOURCE, [
      sourceRule({
        allowedIn: { sitemaps: [], pageModels: [{ pageModelID: 4, stale: true }], zones: sourceAllowedIn.zones },
      }),
    ]);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(result).toMatchObject({ successful: 1, skipped: 0 });
    expect(save.mock.calls[0][1].allowedIn).toEqual({
      sitemaps: [],
      pageModels: [],
      zones: [{ pageModelName: "Landing Page", referenceName: "HeroZone", name: "Hero Zone" }],
    });
  });

  it("ignores the target's stale entries when comparing, so a re-sync writes nothing", async () => {
    writeRules(SOURCE, [sourceRule()]);
    writeRules(TARGET, [
      {
        modelID: 120,
        addableBy: null,
        allowedIn: {
          sitemaps: [
            { sitemapID: 7, referenceName: "website" },
            { sitemapID: 8, stale: true },
          ],
          pageModels: [
            { pageModelID: 30, name: "Landing Page" },
            { pageModelID: 31, stale: true },
          ],
          zones: [
            { zoneID: 140, pageModelName: "Landing Page", referenceName: "HeroZone" },
            { zoneID: 141, stale: true },
          ],
        },
      },
    ]);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 0, skipped: 1, failed: 0 });
  });

  it("replaces a target sitemap list that holds only stale entries, which allows the component nowhere", async () => {
    // The source has no sitemap rule (anywhere); the target's only sitemap was deleted (nowhere).
    writeRules(SOURCE, [
      sourceRule({ allowedIn: { sitemaps: [], pageModels: sourceAllowedIn.pageModels, zones: [] } }),
    ]);
    writeRules(TARGET, [
      {
        modelID: 120,
        addableBy: null,
        allowedIn: {
          sitemaps: [{ sitemapID: 8, stale: true }],
          pageModels: [{ pageModelID: 30, name: "Landing Page" }],
          zones: [],
        },
      },
    ]);
    mapModel(12, 120);
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(save.mock.calls[0][1].allowedIn).toEqual({
      sitemaps: [],
      pageModels: [{ name: "Landing Page" }],
      zones: [],
    });
  });

  it("records the planned saves in preflight and writes nothing", async () => {
    writeRules(SOURCE, [sourceRule(), sourceRule({ modelID: 13, modelReferenceName: "NewModel" })]);
    writeRules(TARGET, []);
    mapModel(12, 120); // before preflight is on: preflight never writes mapping files
    setState({ preflight: true });
    const save = mockApi();

    const result = await pushModelAvailability([sourceModel, { id: 13, referenceName: "NewModel" } as any]);

    expect(save).not.toHaveBeenCalled();
    expect(result.successful).toBe(2);
    const entries = preflightReport.getEntries();
    expect(entries).toEqual([
      expect.objectContaining({ phase: "Component availability", action: "update", name: "HeroBanner" }),
      expect.objectContaining({ phase: "Component availability", action: "create", name: "NewModel" }),
    ]);
  });
});

// ─── disabling models created this run ────────────────────────────────────────

describe("pushModelAvailability — models created this run that are disabled on the source", () => {
  const targetModel = { id: 120, referenceName: "HeroBanner", lastModifiedDate: "2026-01-01", fields: [] };

  function mockModelApi(overrides: { get?: jest.Mock; saveModel?: jest.Mock } = {}) {
    const get = overrides.get ?? jest.fn().mockResolvedValue({ ...targetModel, isVisible: true });
    const saveModel =
      overrides.saveModel ??
      jest.fn().mockImplementation(async (model: any) => ({ ...model, lastModifiedDate: "2026-05-05" }));
    jest.spyOn(stateModule, "getApiClient").mockReturnValue({
      modelMethods: { getContentModel: get, saveModel, saveModelAvailability: jest.fn() },
    } as any);
    return { get, saveModel };
  }

  it("disables them after the pages, and records the save in the model mapping", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    mapModel(12, 120);
    stateModule.registerDeferredModelDisable(12);
    const { get, saveModel } = mockModelApi();

    const result = await pushModelAvailability([{ ...sourceModel, lastModifiedDate: "2026-01-01" }]);

    expect(get).toHaveBeenCalledWith(120, TARGET);
    expect(saveModel).toHaveBeenCalledTimes(1);
    expect(saveModel.mock.calls[0][0]).toMatchObject({ id: 120, isVisible: false });
    expect(result).toMatchObject({ status: "success", successful: 1, failed: 0 });
    // Otherwise the next sync reads the model as changed on the target.
    const mapping = new ModelMapper(SOURCE, TARGET).getModelMappingByID(12, "source");
    expect(mapping?.targetLastModifiedDate).toBe("2026-05-05");
  });

  it("leaves models that weren't created this run alone", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    mapModel(12, 120);
    const { saveModel } = mockModelApi();

    await pushModelAvailability([{ ...sourceModel, isVisible: false }]);

    expect(saveModel).not.toHaveBeenCalled();
  });

  it("warns once and leaves them enabled when the target's API doesn't return isVisible", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    mapModel(12, 120);
    mapModel(13, 130, "Other");
    stateModule.registerDeferredModelDisable(12);
    stateModule.registerDeferredModelDisable(13);
    const { get, saveModel } = mockModelApi({ get: jest.fn().mockResolvedValue({ ...targetModel }) });

    const result = await pushModelAvailability([sourceModel, { id: 13, referenceName: "Other" } as any]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(saveModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "success", failed: 0 });
    expect(result.warningDetails).toHaveLength(1);
    expect(result.warningDetails[0].error).toMatch(/can't disable models yet/);
  });

  it("reports a failed disable as that model's failure", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    mapModel(12, 120);
    stateModule.registerDeferredModelDisable(12);
    mockModelApi({ saveModel: jest.fn().mockRejectedValue(new Error("boom")) });

    const result = await pushModelAvailability([sourceModel]);

    expect(result).toMatchObject({ status: "error", successful: 0, failed: 1 });
    expect(result.failureDetails[0].error).toMatch(/Failed to disable model "HeroBanner".*boom/);
  });

  it("records the planned disable in preflight and writes nothing", async () => {
    writeRules(SOURCE, []);
    writeRules(TARGET, []);
    setState({ preflight: true });
    stateModule.registerDeferredModelDisable(12);
    const { get, saveModel } = mockModelApi();

    const result = await pushModelAvailability([sourceModel]);

    expect(get).not.toHaveBeenCalled();
    expect(saveModel).not.toHaveBeenCalled();
    expect(result.successful).toBe(1);
    expect(preflightReport.getEntries()).toEqual([
      expect.objectContaining({ phase: "Component availability", action: "update", name: "HeroBanner" }),
    ]);
  });
});
