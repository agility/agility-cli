import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, initializeGuidLogger } from "core/state";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { SectionMapper } from "lib/mappers/section-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-tpl-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src-tpl-u", targetGuid: "tgt-tpl-u", token: "test-token" });
  initializeGuidLogger("src-tpl-u", "push");
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let templateCounter = 0;

function makeTemplate(overrides: Record<string, any> = {}): any {
  templateCounter++;
  return {
    pageTemplateID: templateCounter,
    pageTemplateName: `Template ${templateCounter}`,
    referenceName: `template-${templateCounter}`,
    contentSectionDefinitions: [],
    lastModifiedDate: new Date(2020, 0, 1).toISOString(),
    ...overrides,
  };
}

// ─── pushTemplates — empty sourceData guard ───────────────────────────────────

describe("pushTemplates — empty sourceData guard", () => {
  it("returns success with zeros when sourceData is empty", async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([], [], "en-us");

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns success with zeros when sourceData is null", async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates(null as any, [], "en-us");

    expect(result.status).toBe("success");
    expect(result.successful).toBe(0);
  });

  it('logs "No templates found" when empty', async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const consoleSpy = jest.spyOn(console, "log");
    const { pushTemplates } = await import("../template-pusher");
    await pushTemplates([], [], "en-us");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No sourceTemplates found to process."));
  });
});

// ─── pushTemplates — throw when template exists in target by name ──────────────

describe("pushTemplates — throw when template exists in target by name (no mapping)", () => {
  it("throws a mapping inconsistency error and does not save", async () => {
    const savePageTemplate = jest.fn().mockResolvedValue(makeTemplate());
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import("../template-pusher");

    const sourceTpl = makeTemplate({ pageTemplateName: "SharedTemplate" });
    const targetTpl = makeTemplate({ pageTemplateName: "SharedTemplate" });

    await expect(pushTemplates([sourceTpl], [targetTpl], "en-us")).rejects.toThrow(
      `Page template validation failed: mapping inconsistency for template "SharedTemplate"`
    );
    expect(savePageTemplate).not.toHaveBeenCalled();
  });
});

// ─── pushTemplates — create path ──────────────────────────────────────────────

describe("pushTemplates — create new template", () => {
  it("calls savePageTemplate when no existing mapping and not in target by name", async () => {
    const savedTpl = makeTemplate({ pageTemplateID: 99 });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import("../template-pusher");

    const sourceTpl = makeTemplate({ pageTemplateName: "UniqueNewTemplate" });

    const result = await pushTemplates([sourceTpl], [], "en-us");

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("counts as failed when savePageTemplate throws", async () => {
    const savePageTemplate = jest.fn().mockRejectedValue(new Error("API error"));
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import("../template-pusher");

    const sourceTpl = makeTemplate({ pageTemplateName: "ErrorTemplate" });

    const result = await pushTemplates([sourceTpl], [], "en-us");

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.status).toBe("error");
  });
});

// ─── pushTemplates — result shape ────────────────────────────────────────────

describe("pushTemplates — result shape", () => {
  it("returns status, successful, failed, skipped fields", async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([], [], "en-us");

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("successful");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });
});

// ─── pushTemplates — overwrite mode ──────────────────────────────────────────

describe("pushTemplates — overwrite mode", () => {
  it("calls savePageTemplate for new template regardless of overwrite setting", async () => {
    state.overwrite = false;

    const savedTpl = makeTemplate({ pageTemplateID: 88 });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import("../template-pusher");

    // Template not in target, no mapping — goes through create path
    const sourceTpl = makeTemplate({ pageTemplateName: "NewUniqueTemplate2" });

    const result = await pushTemplates([sourceTpl], [], "en-us");

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
  });
});

// ─── pushTemplates — PROD-2350: section ID mapping ───────────────────────────

describe("pushTemplates — section ID mapping", () => {
  it("seeds a section mapping from the confirmed API response on create", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5001,
      pageTemplateName: "SectionSeedTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 7, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
      ],
    });

    const savedTpl = makeTemplate({
      pageTemplateID: 5002,
      pageTemplateName: "SectionSeedTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 70, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: 999 },
      ],
    });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([sourceTpl], [], "en-us");

    expect(result.successful).toBe(1);

    const sectionMapper = new SectionMapper("src-tpl-u", "tgt-tpl-u");
    const mapping = sectionMapper.getSectionMappingByID(7, "source");
    expect(mapping).not.toBeNull();
    expect(mapping!.targetPageItemTemplateID).toBe(70);
  });

  it("falls back to reference-name matching when no section mapping exists yet (bootstrap)", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5003,
      pageTemplateName: "BootstrapTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 8, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
        // Extra section vs. target so hasTemplateChanged detects a real structural diff and
        // takes the update path instead of skipping (source and target are otherwise identical).
        { pageItemTemplateID: 9, pageItemTemplateReferenceName: "Extra", itemOrder: 1, contentViewID: -1 },
      ],
    });
    const targetTpl = makeTemplate({
      pageTemplateID: 5004,
      pageTemplateName: "BootstrapTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 80, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: 444 },
      ],
    });

    // Establish the template-level mapping (source<->target) but no section mapping yet —
    // simulates a sync that predates the SectionMapper being introduced.
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTpl);

    const savedTpl = { ...targetTpl };
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    await pushTemplates([sourceTpl], [targetTpl], "en-us");

    const payload = savePageTemplate.mock.calls[0][2];
    const mainSection = payload.contentSectionDefinitions.find(
      (s: any) => s.pageItemTemplateReferenceName === "Main"
    );
    // Bootstrap fallback (name match) preserved the target's existing section identity —
    // it did NOT send -1, which would have caused the API to create a duplicate section.
    expect(mainSection.pageItemTemplateID).toBe(80);
    expect(mainSection.contentViewID).toBe(444);
  });

  it("uses the persisted section mapping instead of name matching after a source rename", async () => {
    const sourceTplBefore = makeTemplate({
      pageTemplateID: 5005,
      pageTemplateName: "RenameTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 9, pageItemTemplateReferenceName: "OldName", itemOrder: 0, contentViewID: -1 },
      ],
    });
    const targetTplBefore = makeTemplate({
      pageTemplateID: 5006,
      pageTemplateName: "RenameTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 90, pageItemTemplateReferenceName: "OldName", itemOrder: 0, contentViewID: 777 },
      ],
    });

    // Establish both the template-level and section-level mappings as they'd exist after an
    // earlier successful push (before the rename happened).
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTplBefore, targetTplBefore);
    new SectionMapper("src-tpl-u", "tgt-tpl-u").addMapping(
      sourceTplBefore.contentSectionDefinitions[0],
      targetTplBefore.contentSectionDefinitions[0]
    );

    // Source renames the section (same pageItemTemplateID: 9); target hasn't been pushed yet,
    // so the live target template still reports the old name.
    const sourceTplRenamed = {
      ...sourceTplBefore,
      contentSectionDefinitions: [
        { pageItemTemplateID: 9, pageItemTemplateReferenceName: "NewName", itemOrder: 0, contentViewID: -1 },
      ],
    };
    const targetTplCurrent = targetTplBefore;

    const savedTpl = {
      ...targetTplCurrent,
      contentSectionDefinitions: [
        { pageItemTemplateID: 90, pageItemTemplateReferenceName: "NewName", itemOrder: 0, contentViewID: 777 },
      ],
    };
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    await pushTemplates([sourceTplRenamed], [targetTplCurrent], "en-us");

    const payload = savePageTemplate.mock.calls[0][2];
    // A name match against the stale target ("OldName") would have missed and sent -1,
    // creating a duplicate section instead of updating the existing one.
    expect(payload.contentSectionDefinitions[0].pageItemTemplateID).toBe(90);
    expect(payload.contentSectionDefinitions[0].contentViewID).toBe(777);

    // The mapping is refreshed with the new name so future lookups stay correct.
    const refreshed = new SectionMapper("src-tpl-u", "tgt-tpl-u").getSectionMappingByID(9, "source");
    expect(refreshed!.targetPageItemTemplateID).toBe(90);
    expect(refreshed!.sourceReferenceName).toBe("NewName");
  });
});

// ─── pushTemplates — section ID mapping backfill on skip ─────────────────────

describe("pushTemplates — section ID mapping backfill when skipping up-to-date templates", () => {
  it("backfills a section mapping on skip when none exists yet", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5007,
      pageTemplateName: "SkipBackfillTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 11, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
      ],
    });
    const targetTpl = makeTemplate({
      pageTemplateID: 5008,
      pageTemplateName: "SkipBackfillTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 110, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: 555 },
      ],
    });

    // Structurally identical -> hasTemplateChanged is false -> shouldSkip path, no section
    // mapping pre-populated (simulates a sync predating SectionMapper).
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTpl);

    const savePageTemplate = jest.fn();
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([sourceTpl], [targetTpl], "en-us");

    expect(result.skipped).toBe(1);
    expect(savePageTemplate).not.toHaveBeenCalled();

    const mapping = new SectionMapper("src-tpl-u", "tgt-tpl-u").getSectionMappingByID(11, "source");
    expect(mapping).not.toBeNull();
    expect(mapping!.targetPageItemTemplateID).toBe(110);
  });

  it("does not overwrite an existing section mapping on skip", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5009,
      pageTemplateName: "SkipNoOverwriteTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 12, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
      ],
    });
    const targetTpl = makeTemplate({
      pageTemplateID: 5010,
      pageTemplateName: "SkipNoOverwriteTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 120, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: 666 },
      ],
    });

    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTpl);
    // Pre-seed a stale mapping pointing at a different target ID than the current name match
    // would find — proves the skip path only creates a mapping when one is missing, it never
    // refreshes an existing one.
    // Partial on purpose: addMapping reads only the ID and reference name, so the other 26
    // ContentSectionDefinition fields would be noise. Cast so this stays honest under
    // `npm run type-check:tests` rather than silently untyped.
    new SectionMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl.contentSectionDefinitions[0], {
      pageItemTemplateID: 999,
      pageItemTemplateReferenceName: "Main",
    } as any);

    const savePageTemplate = jest.fn();
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    await pushTemplates([sourceTpl], [targetTpl], "en-us");

    const mapping = new SectionMapper("src-tpl-u", "tgt-tpl-u").getSectionMappingByID(12, "source");
    expect(mapping!.targetPageItemTemplateID).toBe(999);
  });

  it("throws when the skip path finds mismatched section counts", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5011,
      pageTemplateName: "SkipMismatchTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 13, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
        { pageItemTemplateID: 14, pageItemTemplateReferenceName: "Sidebar", itemOrder: 1, contentViewID: -1 },
      ],
    });
    const targetTpl = makeTemplate({
      pageTemplateID: 5012,
      pageTemplateName: "SkipMismatchTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 130, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: 555 },
      ],
    });

    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTpl);

    // Force the "up to date" path even though the section arrays don't actually match, to
    // exercise the defensive validation (this shouldn't happen in practice since
    // hasTemplateChanged would normally catch this itself).
    jest.spyOn(TemplateMapper.prototype, "hasTemplateChanged").mockReturnValue(false);

    const savePageTemplate = jest.fn();
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");

    await expect(pushTemplates([sourceTpl], [targetTpl], "en-us")).rejects.toThrow(
      /marked up to date, but has 2 section\(s\) on the source and 1 on the target/
    );
  });

  it("throws when the skip path finds a source section with no matching target name", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 5013,
      pageTemplateName: "SkipNameMismatchTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 15, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
      ],
    });
    const targetTpl = makeTemplate({
      pageTemplateID: 5014,
      pageTemplateName: "SkipNameMismatchTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 150, pageItemTemplateReferenceName: "SomethingElse", itemOrder: 0, contentViewID: 555 },
      ],
    });

    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTpl);
    jest.spyOn(TemplateMapper.prototype, "hasTemplateChanged").mockReturnValue(false);

    const savePageTemplate = jest.fn();
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");

    await expect(pushTemplates([sourceTpl], [targetTpl], "en-us")).rejects.toThrow(
      /source section "Main" has no matching section on the target/
    );
  });
});

// ─── PROD-2603: mapping points at a target template that no longer exists ──────

describe("pushTemplates — stale mapping to a deleted target template (PROD-2603)", () => {
  it("is a conflict without --overwrite: no save, record left alone, template held back for pages", async () => {
    const sourceTpl = makeTemplate({ pageTemplateID: 20, pageTemplateName: "LeftSideBarTemplate" });
    const deadTargetTpl = makeTemplate({ pageTemplateID: 2, pageTemplateName: "LeftSideBarTemplate" });
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, deadTargetTpl);

    const savePageTemplate = jest.fn();
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");

    // target template 2 is gone from the pulled target data
    const result = await pushTemplates([sourceTpl], [], "en-us");
    expect(savePageTemplate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);

    const record = new TemplateMapper("src-tpl-u", "tgt-tpl-u").getTemplateMappingByPageTemplateID(20, "source")!;
    expect(record.targetPageTemplateID).toBe(2);

    const { getHeldBackTemplate } = await import("core/state");
    expect(getHeldBackTemplate("LeftSideBarTemplate")).toMatch(/is missing on the target and was not recreated/);
  });

  it("is reported as a preflight conflict without --overwrite", async () => {
    const sourceTpl = makeTemplate({ pageTemplateID: 30, pageTemplateName: "GoneTemplate" });
    const deadTargetTpl = makeTemplate({ pageTemplateID: 3, pageTemplateName: "GoneTemplate" });
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, deadTargetTpl);

    state.preflight = true;
    state.cachedApiClient = { pageMethods: { savePageTemplate: jest.fn() } } as any;
    const { preflightReport } = await import("lib/preflight/preflight-report");
    preflightReport.reset();

    const { pushTemplates } = await import("../template-pusher");
    await pushTemplates([sourceTpl], [], "en-us");

    expect(preflightReport.hasConflicts()).toBe(true);
    const entry = preflightReport.getEntries().find((e) => e.name === "GoneTemplate");
    expect(entry?.phase).toBe("Templates");
    expect(entry?.action).toBe("conflict");
    expect(entry?.detail).toMatch(/ID: 3\) no longer exists on the target/);
  });

  it("with --overwrite recreates the template once and repoints the record instead of appending a second one", async () => {
    const sourceTpl = makeTemplate({ pageTemplateID: 40, pageTemplateName: "RecreatedTemplate" });
    const deadTargetTpl = makeTemplate({ pageTemplateID: 4, pageTemplateName: "RecreatedTemplate" });
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, deadTargetTpl);

    state.overwrite = true;
    const savedTpl = makeTemplate({ pageTemplateID: 41, pageTemplateName: "RecreatedTemplate" });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");

    const result = await pushTemplates([sourceTpl], [], "en-us");
    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(savePageTemplate.mock.calls[0][2].pageTemplateID).toBe(-1);
    expect(result.successful).toBe(1);

    const { getHeldBackTemplate } = await import("core/state");
    expect(getHeldBackTemplate("RecreatedTemplate")).toBeUndefined();

    const mapper = new TemplateMapper("src-tpl-u", "tgt-tpl-u");
    const record = mapper.getTemplateMappingByPageTemplateID(40, "source")!;
    expect(record.targetPageTemplateID).toBe(41);
    expect(mapper.getTemplateMappingByPageTemplateID(4, "target")).toBeNull();

    // second run: the recreated template is now present on the target and structurally identical -> skip
    savePageTemplate.mockClear();
    const second = await pushTemplates([sourceTpl], [savedTpl], "en-us");
    expect(savePageTemplate).not.toHaveBeenCalled();
    expect(second.skipped).toBe(1);
  });
});

// ─── pushTemplates — saved template visible later in the run ─────────────────

describe("pushTemplates — saved template is what the mapper returns for the rest of the run", () => {
  it("returns the saved template, so the page pusher sees zones added in the same run", async () => {
    const sourceTpl = makeTemplate({
      pageTemplateID: 7001,
      pageTemplateName: "ZoneAddedTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 1, pageItemTemplateReferenceName: "banner-zone", itemOrder: 1, contentViewID: -1 },
        { pageItemTemplateID: 2, pageItemTemplateReferenceName: "main-content-zone", itemOrder: 2, contentViewID: -1 },
      ],
    });
    const targetTplBefore = makeTemplate({
      pageTemplateID: 7002,
      pageTemplateName: "ZoneAddedTemplate",
      contentSectionDefinitions: [
        { pageItemTemplateID: 20, pageItemTemplateReferenceName: "main-content-zone", itemOrder: 1, contentViewID: -1 },
      ],
    });

    // The target template as pulled at the start of the run, before the source's new zone reached it.
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl, targetTplBefore);
    const { fileOperations } = await import("core");
    new fileOperations("tgt-tpl-u").exportFiles("templates", 7002, targetTplBefore);

    const savedTpl = {
      ...targetTplBefore,
      contentSectionDefinitions: [
        { pageItemTemplateID: 21, pageItemTemplateReferenceName: "banner-zone", itemOrder: 1, contentViewID: -1 },
        { pageItemTemplateID: 20, pageItemTemplateReferenceName: "main-content-zone", itemOrder: 2, contentViewID: -1 },
      ],
    };
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([sourceTpl], [targetTplBefore], "en-us");
    expect(result.successful).toBe(1);

    // What the page pusher reads to translate zone names.
    const mapper = new TemplateMapper("src-tpl-u", "tgt-tpl-u");
    const cached = mapper.getMappedEntity(mapper.getTemplateMappingByPageTemplateName("ZoneAddedTemplate", "source")!, "target");
    expect(cached!.contentSectionDefinitions.map((s: any) => s.pageItemTemplateReferenceName)).toEqual([
      "banner-zone",
      "main-content-zone",
    ]);
  });
});

// ─── PROD-3078: which side changed, from the hashes stored at the last sync ──────────

describe("pushTemplates — sync fingerprints (PROD-3078)", () => {
  let nextID = 5000;

  function section(id: number, referenceName: string, itemOrder: number, overrides: Record<string, any> = {}): any {
    return {
      pageItemTemplateID: id,
      pageItemTemplateReferenceName: referenceName,
      pageItemTemplateName: referenceName,
      pageItemTemplateType: 0,
      itemOrder,
      ...overrides,
    };
  }

  /**
   * A source/target template pair as the last sync left it: mapped, sections mapped, and (unless
   * `unrecorded`) the hashes of both sides stored.
   */
  async function syncedPair(name: string, { unrecorded = false } = {}) {
    const ids = { source: nextID++, target: nextID++, sMain: nextID++, sSide: nextID++, tMain: nextID++, tSide: nextID++ };
    const source = makeTemplate({
      pageTemplateID: ids.source,
      pageTemplateName: name,
      contentSectionDefinitions: [section(ids.sMain, "Main", 1), section(ids.sSide, "Side", 2)],
    });
    const target = makeTemplate({
      pageTemplateID: ids.target,
      pageTemplateName: name,
      contentSectionDefinitions: [section(ids.tMain, "Main", 1), section(ids.tSide, "Side", 2)],
    });
    const { templateHash } = await import("lib/mappers/template-mapper");
    const { fingerprintFields } = await import("lib/shared/sync-fingerprint");
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").addMapping(
      source,
      target,
      unrecorded ? undefined : fingerprintFields(templateHash(source), templateHash(target))
    );
    const sections = new SectionMapper("src-tpl-u", "tgt-tpl-u");
    sections.addMapping(source.contentSectionDefinitions[0], target.contentSectionDefinitions[0]);
    sections.addMapping(source.contentSectionDefinitions[1], target.contentSectionDefinitions[1]);
    return { source, target };
  }

  function edit(template: any, fn: (sections: any[]) => void): any {
    const copy = JSON.parse(JSON.stringify(template));
    fn(copy.contentSectionDefinitions);
    return copy;
  }

  const record = (sourceID: number) =>
    new TemplateMapper("src-tpl-u", "tgt-tpl-u").getTemplateMappingByPageTemplateID(sourceID, "source")!;

  async function run(source: any, target: any) {
    const savePageTemplate = jest.fn().mockImplementation(async (_guid, _locale, payload) => ({
      ...payload,
      pageTemplateID: target.pageTemplateID,
      contentSectionDefinitions: payload.contentSectionDefinitions.map((s: any, i: number) => ({
        ...s,
        pageItemTemplateID: s.pageItemTemplateID > 0 ? s.pageItemTemplateID : 9000 + i,
      })),
    }));
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;
    const { keptTargetChanges } = await import("../kept-target-changes");
    const { preflightReport } = await import("lib/preflight/preflight-report");
    const { clearHeldBackTemplateRegistry } = await import("core/state");
    keptTargetChanges.reset();
    preflightReport.reset();
    clearHeldBackTemplateRegistry();
    const { pushTemplates } = await import("../template-pusher");
    const result = await pushTemplates([source], [target], "en-us");
    return { result, savePageTemplate, keptTargetChanges, preflightReport };
  }

  it("ignores IDs and section array order", async () => {
    const { templateHash } = await import("lib/mappers/template-mapper");
    const { source, target } = await syncedPair("HashShape");
    const reversed = edit(target, (s) => s.reverse());
    expect(templateHash(source)).toBe(templateHash(reversed));
  });

  it("source changed only: updates and records the source's hash for both sides", async () => {
    const { source, target } = await syncedPair("SourceOnly");
    const changed = edit(source, (s) => s.push(section(nextID++, "Footer", 3)));

    const { result, savePageTemplate } = await run(changed, target);

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    const { templateHash } = await import("lib/mappers/template-mapper");
    expect(record(source.pageTemplateID)).toEqual(
      expect.objectContaining({ sourceHash: templateHash(changed), targetHash: templateHash(changed) })
    );
  });

  it("records the target's hash from what the server saved, so its normalising isn't read as a target edit", async () => {
    const { source, target } = await syncedPair("ServerNormalises");
    const changed = edit(source, (s) => (s[0].pageItemTemplateName = "Main (source)"));
    const { templateHash } = await import("lib/mappers/template-mapper");
    const { pushTemplates } = await import("../template-pusher");
    const { keptTargetChanges } = await import("../kept-target-changes");
    keptTargetChanges.reset();
    // The server renumbers itemOrder on save, and the next pull shows the same.
    const savePageTemplate = jest.fn().mockImplementation(async (_guid, _locale, payload) => ({
      ...payload,
      pageTemplateID: target.pageTemplateID,
      contentSectionDefinitions: payload.contentSectionDefinitions.map((s: any) => ({ ...s, itemOrder: s.itemOrder * 10 })),
    }));
    state.cachedApiClient = { pageMethods: { savePageTemplate } } as any;

    await pushTemplates([changed], [target], "en-us");
    const saved = await savePageTemplate.mock.results[0].value;
    expect(record(source.pageTemplateID).targetHash).toBe(templateHash(saved));

    await pushTemplates([changed], [saved], "en-us");

    expect(keptTargetChanges.hasEntries()).toBe(false);
  });

  it("target changed only: keeps the target, warns, leaves the record alone, and doesn't hold pages back", async () => {
    const { source, target } = await syncedPair("TargetOnly");
    const before = { ...record(source.pageTemplateID) };
    const changed = edit(target, (s) => s.push(section(nextID++, "TargetExtra", 3)));

    const { result, savePageTemplate, keptTargetChanges } = await run(source, changed);

    expect(savePageTemplate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(keptTargetChanges.getEntries()).toEqual([
      expect.objectContaining({ type: "template", name: "TargetOnly", targetID: target.pageTemplateID }),
    ]);
    expect(record(source.pageTemplateID)).toEqual(before);
    // Every source zone still has a section on the kept target template
    const { getHeldBackTemplate } = await import("core/state");
    expect(getHeldBackTemplate("TargetOnly")).toBeUndefined();
  });

  it("target changed only, removing a section the source's pages use: pages are held back", async () => {
    const { source, target } = await syncedPair("TargetDroppedZone");
    const changed = edit(target, (s) => s.splice(1, 1));

    await run(source, changed);

    const { getHeldBackTemplate } = await import("core/state");
    expect(getHeldBackTemplate("TargetDroppedZone")).toMatch(/changed on the target and kept.*no section for zone\(s\) Side/);
  });

  it("a section renamed on the target still resolves through the section mapping: pages aren't held back", async () => {
    const { source, target } = await syncedPair("TargetRenamedZone");
    const changed = edit(target, (s) => (s[1].pageItemTemplateReferenceName = "Sidebar"));

    const { keptTargetChanges } = await run(source, changed);

    expect(keptTargetChanges.hasEntries()).toBe(true);
    const { getHeldBackTemplate } = await import("core/state");
    expect(getHeldBackTemplate("TargetRenamedZone")).toBeUndefined();
  });

  it("target changed only, with --overwrite: the source replaces it", async () => {
    state.overwrite = true;
    const { source, target } = await syncedPair("TargetOnlyOverwrite");
    const changed = edit(target, (s) => s.push(section(nextID++, "TargetExtra", 3)));

    const { savePageTemplate, keptTargetChanges } = await run(source, changed);

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(savePageTemplate.mock.calls[0][2].contentSectionDefinitions).toHaveLength(2);
    expect(keptTargetChanges.hasEntries()).toBe(false);
  });

  it("both changed: a preflight conflict, nothing saved, record left alone", async () => {
    const { source, target } = await syncedPair("BothChanged");
    const before = { ...record(source.pageTemplateID) };
    state.preflight = true;

    const { savePageTemplate, preflightReport, keptTargetChanges } = await run(
      edit(source, (s) => (s[0].pageItemTemplateName = "Main (source)")),
      edit(target, (s) => (s[0].pageItemTemplateName = "Main (target)"))
    );

    expect(savePageTemplate).not.toHaveBeenCalled();
    expect(preflightReport.getEntries()).toEqual([
      expect.objectContaining({ phase: "Templates", action: "conflict", name: "BothChanged" }),
    ]);
    expect(keptTargetChanges.hasEntries()).toBe(false);
    expect(record(source.pageTemplateID)).toEqual(before);
  });

  it("both changed, with --overwrite: the source wins", async () => {
    state.overwrite = true;
    const { source, target } = await syncedPair("BothChangedOverwrite");

    const { savePageTemplate } = await run(
      edit(source, (s) => (s[0].pageItemTemplateName = "Main (source)")),
      edit(target, (s) => (s[0].pageItemTemplateName = "Main (target)"))
    );

    expect(savePageTemplate.mock.calls[0][2].contentSectionDefinitions[0].pageItemTemplateName).toBe("Main (source)");
  });

  it("both changed to the same structure: skipped, and the hashes refreshed", async () => {
    const { source, target } = await syncedPair("BothSame");
    const s2 = edit(source, (s) => (s[0].pageItemTemplateName = "Main (both)"));
    const t2 = edit(target, (s) => (s[0].pageItemTemplateName = "Main (both)"));

    const { savePageTemplate, result } = await run(s2, t2);

    expect(savePageTemplate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    const { templateHash } = await import("lib/mappers/template-mapper");
    expect(record(source.pageTemplateID).sourceHash).toBe(templateHash(s2));
  });

  describe("mapping from an older CLI, with no hashes", () => {
    it("in sync: skipped, and the hashes are recorded", async () => {
      const { source, target } = await syncedPair("UnrecordedInSync", { unrecorded: true });
      expect(record(source.pageTemplateID).sourceHash).toBeUndefined();

      const { savePageTemplate } = await run(source, target);

      expect(savePageTemplate).not.toHaveBeenCalled();
      expect(record(source.pageTemplateID)).toEqual(expect.objectContaining({ fingerprintVersion: 1 }));
    });

    it("different: the source wins, as before, labelled as having no sync record", async () => {
      const { source, target } = await syncedPair("UnrecordedDiffers", { unrecorded: true });
      state.preflight = true;

      const { preflightReport, keptTargetChanges } = await run(
        source,
        edit(target, (s) => (s[0].pageItemTemplateName = "Main (target)"))
      );

      expect(keptTargetChanges.hasEntries()).toBe(false);
      expect(preflightReport.getEntries()).toEqual([
        expect.objectContaining({ action: "update", detail: expect.stringContaining("no sync record yet") }),
      ]);
    });

    it("different, in a real run: the source is saved and the hashes recorded", async () => {
      const { source, target } = await syncedPair("UnrecordedDiffersRun", { unrecorded: true });

      const { savePageTemplate } = await run(source, edit(target, (s) => (s[0].pageItemTemplateName = "Main (target)")));

      expect(savePageTemplate).toHaveBeenCalledTimes(1);
      expect(record(source.pageTemplateID)).toEqual(expect.objectContaining({ fingerprintVersion: 1 }));
    });
  });
});
