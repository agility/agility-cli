import { checkInstanceIntegrity } from "../check-mapping-integrity";
import { checkStructure } from "../check-structure";
import { FindingCollector, INSTANCE_LOCALE } from "../verify-report";
import { context, section } from "./fixtures";

function run(source: any, target: any, mappings: any) {
  const ctx = context({ source, target, mappings });
  const collector = new FindingCollector();
  checkStructure(ctx, checkInstanceIntegrity(ctx, collector), collector);
  return collector;
}

const MODEL_MAP = [{ sourceID: 1, targetID: 11, sourceReferenceName: "Post", targetReferenceName: "Post" }];
const fields = (...pairs: Array<[string, string]>) =>
  pairs.map(([name, type]) => ({ name, type, lastModifiedDate: "x" }));

describe("models", () => {
  it("compares reference name and ordered (name, type) fields, ignoring IDs and dates", () => {
    const collector = run(
      {
        models: [
          { id: 1, referenceName: "Post", lastModifiedDate: "a", fields: fields(["Title", "Text"], ["Body", "HTML"]) },
        ],
      },
      {
        models: [
          { id: 11, referenceName: "post", lastModifiedDate: "b", fields: fields(["title", "Text"], ["body", "Html"]) },
        ],
      },
      { models: MODEL_MAP }
    );
    expect(collector.findings).toEqual([]);
    expect(collector.talliesFor(INSTANCE_LOCALE).model).toMatchObject({ checked: 1, matched: 1 });
  });

  it("reports reordered fields", () => {
    const collector = run(
      { models: [{ id: 1, referenceName: "Post", fields: fields(["Title", "Text"], ["Body", "HTML"]) }] },
      { models: [{ id: 11, referenceName: "Post", fields: fields(["Body", "HTML"], ["Title", "Text"]) }] },
      { models: MODEL_MAP }
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({ category: "modelMismatch", path: "fields", expected: ["title:text", "body:html"] }),
    ]);
  });

  it("warns on a target model nothing maps to", () => {
    const collector = run(
      { models: [{ id: 1, referenceName: "Post", fields: [] }] },
      {
        models: [
          { id: 11, referenceName: "Post", fields: [] },
          { id: 12, referenceName: "Extra", fields: [] },
        ],
      },
      { models: MODEL_MAP }
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({ category: "extraInTarget", severity: "warning", targetID: 12 }),
    ]);
  });
});

describe("containers", () => {
  it("compares the held model through the model mapping", () => {
    const mappings = {
      models: MODEL_MAP,
      containers: [
        { sourceContentViewID: 5, targetContentViewID: 55, sourceReferenceName: "posts", targetReferenceName: "posts" },
      ],
    };
    const source = {
      models: [{ id: 1, referenceName: "Post", fields: [] }],
      containers: [{ contentViewID: 5, referenceName: "posts", contentDefinitionID: 1 }],
    };
    const ok = run(
      source,
      {
        models: [{ id: 11, referenceName: "Post", fields: [] }],
        containers: [{ contentViewID: 55, referenceName: "posts", contentDefinitionID: 11 }],
      },
      mappings
    );
    expect(ok.findings).toEqual([]);

    const wrong = run(
      source,
      {
        models: [
          { id: 11, referenceName: "Post", fields: [] },
          { id: 12, referenceName: "Other", fields: [] },
        ],
        containers: [{ contentViewID: 55, referenceName: "posts", contentDefinitionID: 12 }],
      },
      mappings
    );
    expect(wrong.findings.filter((f) => f.category === "containerMismatch")).toEqual([
      expect.objectContaining({ path: "model", actual: "Other (#12)" }),
    ]);
  });

  it("leaves out the fixed Agility system containers on both sides", () => {
    const collector = run(
      { containers: [{ contentViewID: 1, referenceName: "AgilityCSSFiles", contentDefinitionID: 3 }] },
      { containers: [{ contentViewID: 1, referenceName: "AgilityCSSFiles", contentDefinitionID: 3 }] },
      {}
    );
    expect(collector.findings).toEqual([]);
  });

  it("leaves out deleted containers", () => {
    const collector = run({ containers: [{ contentViewID: 9, referenceName: "gone", isDeleted: true }] }, {}, {});
    expect(collector.findings).toEqual([]);
  });
});

describe("templates", () => {
  const mappings = {
    templates: [
      {
        sourcePageTemplateID: 1,
        targetPageTemplateID: 2,
        sourcePageTemplateName: "Std",
        targetPageTemplateName: "Std",
      },
    ],
  };

  it("compares section reference names in itemOrder", () => {
    const collector = run(
      {
        templates: [
          {
            pageTemplateID: 1,
            pageTemplateName: "Std",
            contentSectionDefinitions: [section(1, "Main", 1), section(2, "Side", 2)],
          },
        ],
      },
      {
        templates: [
          {
            pageTemplateID: 2,
            pageTemplateName: "Std",
            contentSectionDefinitions: [section(9, "Side", 2), section(8, "main", 1)],
          },
        ],
      },
      mappings
    );
    expect(collector.findings).toEqual([]);
  });

  it("reports a differing zone list", () => {
    const collector = run(
      {
        templates: [
          {
            pageTemplateID: 1,
            pageTemplateName: "Std",
            contentSectionDefinitions: [section(1, "Main", 1), section(2, "Side", 2)],
          },
        ],
      },
      {
        templates: [{ pageTemplateID: 2, pageTemplateName: "Std", contentSectionDefinitions: [section(8, "Main", 1)] }],
      },
      mappings
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({ category: "templateMismatch", expected: ["main", "side"], actual: ["main"] }),
    ]);
  });
});

describe("mapping integrity", () => {
  it("reports unmapped, dangling and duplicate-target mappings", () => {
    const collector = run(
      {
        models: [
          { id: 1, referenceName: "A", fields: [] },
          { id: 2, referenceName: "B", fields: [] },
          { id: 3, referenceName: "C", fields: [] },
          { id: 4, referenceName: "D", fields: [] },
        ],
      },
      { models: [{ id: 11, referenceName: "A", fields: [] }] },
      {
        models: [
          { sourceID: 1, targetID: 11 },
          { sourceID: 2, targetID: 11 },
          { sourceID: 3, targetID: 13 },
        ],
      }
    );
    const summary = collector.findings.map((f) => [f.category, f.sourceID, f.targetID]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ["danglingMapping", 3, 13],
        ["unmapped", 4, null],
        ["duplicateTarget", "1,2", 11],
      ])
    );
    expect(collector.talliesFor(INSTANCE_LOCALE).model).toMatchObject({ checked: 4, missing: 2 });
  });

  it("does not report a duplicate whose second source no longer exists", () => {
    const collector = run(
      { models: [{ id: 1, referenceName: "A", fields: [] }] },
      { models: [{ id: 11, referenceName: "A", fields: [] }] },
      {
        models: [
          { sourceID: 1, targetID: 11 },
          { sourceID: 2, targetID: 11 },
        ],
      }
    );
    expect(collector.findings).toEqual([]);
  });
});
