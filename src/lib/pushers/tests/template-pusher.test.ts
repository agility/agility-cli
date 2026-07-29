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
    new SectionMapper("src-tpl-u", "tgt-tpl-u").addMapping(sourceTpl.contentSectionDefinitions[0], {
      pageItemTemplateID: 999,
      pageItemTemplateReferenceName: "Main",
    });

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
