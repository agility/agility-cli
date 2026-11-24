import { checkContent } from "../check-content";
import { checkLocaleIntegrity } from "../check-mapping-integrity";
import { FindingCollector } from "../verify-report";
import { context, item, itemMappings, LOCALE, module, page, POST_MODEL_SOURCE, POST_MODEL_TARGET } from "./fixtures";

// PROD-3399: verify leaves Components on no page out of the comparison, like the sync does, and
// lists each once as a source defect instead of an unmapped failure or a count mismatch.

const MAPPINGS = {
  models: [{ sourceID: 10, targetID: 110, sourceReferenceName: "Post", targetReferenceName: "Post" }],
  containers: [
    { sourceContentViewID: 20, targetContentViewID: 120, sourceReferenceName: "banner", targetReferenceName: "banner" },
  ],
};
const SOURCE_CONTAINERS = [
  { contentViewID: 20, referenceName: "banner", contentDefinitionID: 10, contentDefinitionTypeID: 2 },
];
const TARGET_CONTAINERS = [
  { contentViewID: 120, referenceName: "banner", contentDefinitionID: 110, contentDefinitionTypeID: 2 },
];

function run(source: any[], target: any[], pairs: Array<[number, number]>, pages: any[]) {
  const ctx = context({
    source: { models: [POST_MODEL_SOURCE], containers: SOURCE_CONTAINERS, content: source, pages },
    target: { models: [POST_MODEL_TARGET], containers: TARGET_CONTAINERS, content: target },
    mappings: { ...MAPPINGS, locales: { [LOCALE]: { item: itemMappings(pairs) } } },
  });
  const collector = new FindingCollector();
  const { content } = checkLocaleIntegrity(ctx, collector);
  checkContent(ctx, content, collector);
  // The page fixtures have no page mapping; only content findings matter here.
  const contentFindings = collector.findings.filter((f) => f.entity === "content");
  collector.findings.splice(0, collector.findings.length, ...contentFindings);
  return collector;
}

const banner = (id: number, title = "A") => item(id, { title }, { referenceName: "banner", definitionName: "Post" });

describe("verify: unused Components (PROD-3399)", () => {
  it("lists an unmapped Component on no page as a source defect, not a failure", () => {
    const collector = run(
      [banner(1), banner(2)],
      [banner(101)],
      [[1, 101]],
      [page(5, { main: [module("Banner", 1)] })]
    );

    expect(collector.findings.filter((f) => f.severity === "failure")).toEqual([]);
    expect(collector.findings).toContainEqual(
      expect.objectContaining({ category: "unusedComponent", severity: "sourceDefect", sourceID: 2, targetID: null })
    );
    expect(collector.findings.find((f) => f.category === "unmapped")).toBeUndefined();
    expect(collector.findings.find((f) => f.category === "countMismatch")).toBeUndefined();
    expect(collector.tally(LOCALE, "content")).toEqual(expect.objectContaining({ checked: 2, known: 1, missing: 0 }));
  });

  it("names the target copy an earlier sync made, without a sourceNotInPull warning or a field mismatch", () => {
    const collector = run(
      [banner(1), banner(2, "changed in source")],
      [banner(101), banner(102, "old")],
      [
        [1, 101],
        [2, 102],
      ],
      [page(5, { main: [module("Banner", 1)] })]
    );

    expect(collector.findings).toContainEqual(
      expect.objectContaining({ category: "unusedComponent", sourceID: 2, targetID: 102 })
    );
    expect(collector.findings.map((f) => f.category)).toEqual(["unusedComponent"]);
  });

  it("treats nothing as unused when the source has no pages", () => {
    const collector = run([banner(1)], [], [], []);
    expect(collector.findings).toContainEqual(expect.objectContaining({ category: "unmapped", severity: "failure" }));
  });
});
