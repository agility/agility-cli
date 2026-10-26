import { checkPages } from "../check-page-zones";
import { checkLocaleIntegrity } from "../check-mapping-integrity";
import { FindingCollector } from "../verify-report";
import { context, item, itemMappings, LOCALE, module, page, pageMappings, section } from "./fixtures";

const SOURCE_TEMPLATE = {
  pageTemplateID: 1,
  pageTemplateName: "Standard",
  contentSectionDefinitions: [section(11, "Main", 1), section(12, "Sidebar", 2)],
};
const TARGET_TEMPLATE = {
  pageTemplateID: 101,
  pageTemplateName: "Standard",
  contentSectionDefinitions: [section(111, "Main", 1), section(112, "Sidebar", 2)],
};

const MAPPINGS_BASE = {
  models: [
    { sourceID: 1, targetID: 101, sourceReferenceName: "Hero", targetReferenceName: "Hero" },
    { sourceID: 2, targetID: 102, sourceReferenceName: "Text", targetReferenceName: "Text" },
  ],
  templates: [
    {
      sourcePageTemplateID: 1,
      targetPageTemplateID: 101,
      sourcePageTemplateName: "Standard",
      targetPageTemplateName: "Standard",
    },
  ],
  sections: [
    { sourcePageItemTemplateID: 11, targetPageItemTemplateID: 111 },
    { sourcePageItemTemplateID: 12, targetPageItemTemplateID: 112 },
  ],
};

const SOURCE_CONTENT = [item(1, {}), item(2, {}), item(3, {})];
const TARGET_CONTENT = [item(501, {}), item(502, {}), item(503, {})];
const CONTENT_MAP = itemMappings([
  [1, 501],
  [2, 502],
  [3, 503],
]);

function run(input: {
  sourceZones: Record<string, any[]>;
  targetZones: Record<string, any[]>;
  sourceTemplate?: any;
  targetTemplate?: any;
  sections?: any[];
  sourcePage?: Record<string, any>;
  targetPage?: Record<string, any>;
  sourceContent?: any[];
}) {
  const ctx = context({
    source: {
      templates: [input.sourceTemplate ?? SOURCE_TEMPLATE],
      content: input.sourceContent ?? SOURCE_CONTENT,
      pages: [page(10, input.sourceZones, input.sourcePage)],
    },
    target: {
      templates: [input.targetTemplate ?? TARGET_TEMPLATE],
      content: TARGET_CONTENT,
      pages: [page(90, input.targetZones, input.targetPage)],
    },
    mappings: {
      ...MAPPINGS_BASE,
      sections: input.sections ?? MAPPINGS_BASE.sections,
      locales: { [LOCALE]: { item: CONTENT_MAP, page: pageMappings([[10, 90]]) } },
    },
  });
  const collector = new FindingCollector();
  const pairs = checkLocaleIntegrity(ctx, collector);
  checkPages(ctx, pairs.pages, collector);
  return { findings: collector.findings, tallies: collector.talliesFor(LOCALE), collector };
}

const categories = (findings: any[]) => findings.map((f) => f.category).sort();

describe("checkPages — zones", () => {
  it("reports nothing for identical pages", () => {
    const { findings, tallies } = run({
      sourceZones: { Main: [module("Hero", 1), module("Text", 2)], Sidebar: [module("Text", 3)] },
      targetZones: { Main: [module("Hero", 501), module("Text", 502)], Sidebar: [module("Text", 503)] },
    });
    expect(findings).toEqual([]);
    expect(tallies.zone).toEqual({ checked: 2, matched: 2, mismatched: 0, missing: 0, extra: 0, known: 0 });
    expect(tallies.page.matched).toBe(1);
  });

  it("reports swapped components as an order mismatch with both sequences", () => {
    const { findings } = run({
      sourceZones: { Main: [module("Hero", 1), module("Text", 2)] },
      targetZones: { Main: [module("Text", 502), module("Hero", 501)] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "componentOrderMismatch",
      severity: "failure",
      entity: "zone",
      sourceID: 10,
      targetID: 90,
      path: "main",
      expected: ["hero#501", "text#502"],
      actual: ["text#502", "hero#501"],
    });
  });

  it("reports a component placed in another zone", () => {
    const { findings } = run({
      sourceZones: { Main: [module("Hero", 1)], Sidebar: [module("Text", 3)] },
      targetZones: { Main: [module("Hero", 501), module("Text", 503)], Sidebar: [] },
    });
    expect(categories(findings)).toEqual(["componentInWrongZone"]);
    expect(findings[0]).toMatchObject({ expected: "text#503 in sidebar", actual: "text#503 in main" });
  });

  it("reports missing and extra components", () => {
    const { findings } = run({
      sourceZones: { Main: [module("Hero", 1), module("Text", 2)] },
      targetZones: { Main: [module("Hero", 501), module("Text", 503)] },
    });
    expect(categories(findings)).toEqual(["extraComponent", "missingComponent"]);
  });

  it("pairs a renamed zone through the section-ID mapping", () => {
    const targetTemplate = {
      ...TARGET_TEMPLATE,
      contentSectionDefinitions: [section(111, "MainContent", 1), section(112, "Sidebar", 2)],
    };
    const { findings } = run({
      targetTemplate,
      sourceZones: { Main: [module("Hero", 1), module("Text", 2)] },
      targetZones: { MainContent: [module("Hero", 501), module("Text", 502)] },
    });
    expect(findings).toEqual([]);
  });

  describe("PROD-2350: zones defined in a different order on the two templates", () => {
    const targetTemplate = {
      ...TARGET_TEMPLATE,
      // Same zones, opposite itemOrder — a positional pairing would cross them over.
      contentSectionDefinitions: [section(112, "Sidebar", 1), section(111, "Main", 2)],
    };

    it("pairs each zone by section ID, not position", () => {
      const { findings } = run({
        targetTemplate,
        sourceZones: { Main: [module("Hero", 1)], Sidebar: [module("Text", 3)] },
        targetZones: { Sidebar: [module("Text", 503)], Main: [module("Hero", 501)] },
      });
      expect(findings).toEqual([]);
    });

    it("catches content a positional pairing would have crossed over", () => {
      const { findings } = run({
        targetTemplate,
        sourceZones: { Main: [module("Hero", 1)], Sidebar: [module("Text", 3)] },
        targetZones: { Sidebar: [module("Hero", 501)], Main: [module("Text", 503)] },
      });
      expect(categories(findings)).toEqual(["componentInWrongZone", "componentInWrongZone"]);
    });
  });

  it("reports an unmapped zone and never falls back to position", () => {
    const sourceTemplate = {
      ...SOURCE_TEMPLATE,
      contentSectionDefinitions: [section(11, "Main", 1), section(13, "Legacy", 2)],
    };
    const targetTemplate = {
      ...TARGET_TEMPLATE,
      contentSectionDefinitions: [section(111, "Main", 1), section(114, "Other", 2)],
    };
    const { findings } = run({
      sourceTemplate,
      targetTemplate,
      sections: [{ sourcePageItemTemplateID: 11, targetPageItemTemplateID: 111 }],
      sourceZones: { Main: [module("Hero", 1)], Legacy: [module("Text", 2)] },
      // The leftover target zone holds what a positional fallback would have put there.
      targetZones: { Main: [module("Hero", 501)], Other: [module("Text", 502)] },
    });
    expect(categories(findings)).toEqual(["unmappedZone"]);
    expect(findings[0]).toMatchObject({ severity: "failure", path: "Legacy", expected: ["text#502"] });
  });

  it("lists a module whose content is missing from the source pull as a source defect", () => {
    const { findings, tallies } = run({
      sourceContent: [item(1, {})],
      sourceZones: { Main: [module("Hero", 1), module("Text", 2)] },
      targetZones: { Main: [module("Hero", 501)] },
    });
    // The target copies of 2 and 3 are reported by mapping integrity (sourceNotInPull warnings).
    const zoneFindings = findings.filter((f) => f.entity === "zone");
    expect(zoneFindings).toHaveLength(1);
    expect(zoneFindings[0]).toMatchObject({ category: "moduleContentMissingInSource", severity: "sourceDefect" });
    expect(findings.some((f) => f.severity === "failure")).toBe(false);
    expect(tallies.zone.known).toBe(1);
  });
});

describe("checkPages — page fields", () => {
  it("compares the listed fields with normalization", () => {
    const { findings } = run({
      sourceZones: {},
      targetZones: {},
      sourcePage: { redirectUrl: "", seo: { metaDescription: "d\r\nx" } },
      targetPage: { redirectUrl: null, seo: { MetaDescription: "d\nx", metaKeywords: null } },
    });
    expect(findings).toEqual([]);
  });

  it("reports a differing title and template", () => {
    const { findings } = run({
      sourceZones: {},
      targetZones: {},
      targetPage: { title: "Other", templateName: "Different" },
    });
    expect(findings.map((f) => [f.category, f.path])).toEqual([
      ["pageFieldMismatch", "title"],
      ["pageFieldMismatch", "template"],
    ]);
  });

  it("compares template names through the template mapping, case-insensitively", () => {
    const { findings } = run({
      sourceZones: {},
      targetZones: {},
      sourcePage: { templateName: "STANDARD" },
    });
    expect(findings).toEqual([]);
  });

  // PROD-2729: geo and the GEO seo keys are part of a page, so a sync that didn't copy them shows.
  it("compares geo and the GEO seo keys", () => {
    const geo = { schemaType: "AboutPage", structuredData: { "@type": "AboutPage" } };
    const seo = { metaDescription: "d", title: "T", robots: { index: false, follow: true } };
    expect(
      run({ sourceZones: {}, targetZones: {}, sourcePage: { seo, geo }, targetPage: { seo, geo } }).findings
    ).toEqual([]);

    const { findings } = run({
      sourceZones: {},
      targetZones: {},
      sourcePage: { seo, geo },
      targetPage: { seo: { metaDescription: "d" } },
    });
    expect(findings.map((f) => [f.category, f.path])).toEqual([
      ["pageFieldMismatch", "seo"],
      ["pageFieldMismatch", "geo"],
    ]);
  });
});
