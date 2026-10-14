import { checkContent } from "../check-content";
import { checkLocaleIntegrity } from "../check-mapping-integrity";
import { FindingCollector } from "../verify-report";
import { context, item, itemMappings, LOCALE, POST_MODEL_SOURCE, POST_MODEL_TARGET } from "./fixtures";

const MAPPINGS = {
  models: [{ sourceID: 10, targetID: 110, sourceReferenceName: "Post", targetReferenceName: "Post" }],
  containers: [
    { sourceContentViewID: 20, targetContentViewID: 120, sourceReferenceName: "posts", targetReferenceName: "posts" },
  ],
};
const SOURCE_CONTAINERS = [{ contentViewID: 20, referenceName: "posts", contentDefinitionID: 10 }];
const TARGET_CONTAINERS = [
  { contentViewID: 120, referenceName: "posts", contentDefinitionID: 110 },
  { contentViewID: 121, referenceName: "other", contentDefinitionID: 110 },
];

function run(source: any[], target: any[], pairs: Array<[number, number]>, opts: { scoped?: boolean } = {}) {
  const ctx = context({
    source: { models: [POST_MODEL_SOURCE], containers: SOURCE_CONTAINERS, content: source },
    target: { models: [POST_MODEL_TARGET], containers: TARGET_CONTAINERS, content: target },
    mappings: { ...MAPPINGS, locales: { [LOCALE]: { item: itemMappings(pairs) } } },
    scoped: opts.scoped,
  });
  const collector = new FindingCollector();
  const { content } = checkLocaleIntegrity(ctx, collector);
  checkContent(ctx, content, collector);
  return collector;
}

const byCategory = (collector: FindingCollector, category: string) =>
  collector.findings.filter((f) => f.category === category);

describe("checkContent", () => {
  it("ignores contentID, versionID and modified", () => {
    const collector = run(
      [item(1, { title: "A" }, { versionID: 5, modified: "2020-01-01" })],
      [item(101, { title: "A" }, { versionID: 999, modified: "2026-09-09" })],
      [[1, 101]]
    );
    expect(collector.findings).toEqual([]);
    expect(collector.talliesFor(LOCALE).content).toMatchObject({ checked: 1, matched: 1 });
  });

  it("reports each differing field", () => {
    const collector = run(
      [item(1, { title: "A", body: "<p>x</p>" })],
      [item(101, { title: "B", body: "<p>x</p>" })],
      [[1, 101]]
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({
        category: "fieldMismatch",
        path: "title",
        expected: "A",
        actual: "B",
        sourceID: 1,
        targetID: 101,
      }),
    ]);
    expect(collector.talliesFor(LOCALE).content.mismatched).toBe(1);
  });

  it("translates linked content IDs before comparing", () => {
    const collector = run(
      [item(1, { title: "A" }), item(2, { title: "B", related: { contentid: 1, fulllist: false } })],
      [item(101, { title: "A" }), item(102, { title: "B", related: "101" })],
      [
        [1, 101],
        [2, 102],
      ]
    );
    expect(collector.findings).toEqual([]);
  });

  it("warns, without failing, on a publish-state difference", () => {
    const collector = run(
      [item(1, { title: "A" }, { state: 2 })],
      [item(101, { title: "A" }, { state: 1 })],
      [[1, 101]]
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({ category: "publishStateDifference", severity: "warning", expected: 2, actual: 1 }),
    ]);
  });

  it("reports an item in the wrong container", () => {
    const collector = run(
      [item(1, { title: "A" })],
      [item(101, { title: "A" }, { referenceName: "other" })],
      [[1, 101]]
    );
    expect(byCategory(collector, "contentContainerMismatch")).toHaveLength(1);
  });

  describe("counts", () => {
    it("fails when the target container has fewer items", () => {
      const collector = run(
        [item(1, { title: "A" }), item(2, { title: "B" })],
        [item(101, { title: "A" })],
        [[1, 101]]
      );
      const counts = byCategory(collector, "countMismatch");
      expect(counts.map((f) => [f.entity, f.severity, f.expected, f.actual])).toEqual([
        ["container", "failure", 2, 1],
        ["model", "failure", 2, 1],
      ]);
      expect(byCategory(collector, "unmapped")).toHaveLength(1);
    });

    it("only warns when the target has more", () => {
      const collector = run(
        [item(1, { title: "A" })],
        [item(101, { title: "A" }), item(102, { title: "X" })],
        [[1, 101]]
      );
      expect(byCategory(collector, "countMismatch").every((f) => f.severity === "warning")).toBe(true);
      expect(byCategory(collector, "extraInTarget")).toHaveLength(1);
    });

    it("is skipped on a scoped run", () => {
      const collector = run(
        [item(1, { title: "A" }), item(2, { title: "B" })],
        [item(101, { title: "A" })],
        [[1, 101]],
        {
          scoped: true,
        }
      );
      expect(byCategory(collector, "countMismatch")).toEqual([]);
    });
  });

  describe("list order", () => {
    const source = [
      item(1, { title: "A" }, { itemOrder: 0 }),
      item(2, { title: "B" }, { itemOrder: 1 }),
      item(3, { title: "C" }, { itemOrder: 2 }),
    ];
    const pairs: Array<[number, number]> = [
      [1, 101],
      [2, 102],
      [3, 103],
    ];

    it("passes when the target keeps the order", () => {
      const target = [
        item(101, { title: "A" }, { itemOrder: 5 }),
        item(102, { title: "B" }, { itemOrder: 6 }),
        item(103, { title: "C" }, { itemOrder: 7 }),
      ];
      expect(run(source, target, pairs).findings).toEqual([]);
    });

    it("reports a reordered list with both sequences", () => {
      const target = [
        item(101, { title: "A" }, { itemOrder: 2 }),
        item(102, { title: "B" }, { itemOrder: 1 }),
        item(103, { title: "C" }, { itemOrder: 3 }),
      ];
      expect(byCategory(run(source, target, pairs), "listOrderMismatch")).toEqual([
        expect.objectContaining({
          entity: "container",
          name: "posts",
          expected: [101, 102, 103],
          actual: [102, 101, 103],
        }),
      ]);
    });

    it("lets items that tie in the source come in either order", () => {
      const tied = source.map((i) => ({ ...i, properties: { ...i.properties, itemOrder: 0 } }));
      const target = [
        item(101, { title: "A" }, { itemOrder: 3 }),
        item(102, { title: "B" }, { itemOrder: 2 }),
        item(103, { title: "C" }, { itemOrder: 1 }),
      ];
      expect(byCategory(run(tied, target, pairs), "listOrderMismatch")).toEqual([]);
    });
  });

  describe("unpublished (state 7) items", () => {
    it("drops a state-7 item on either side, as a full pull would", () => {
      const collector = run(
        [item(1, { title: "A" }), item(2, { title: "Gone" }, { state: 7 })],
        [item(101, { title: "A" }), item(102, { title: "Gone" }, { state: 7 })],
        [
          [1, 101],
          [2, 102],
        ]
      );
      expect(collector.findings).toEqual([]);
      expect(collector.talliesFor(LOCALE).content.checked).toBe(1);
    });

    it("unpublished in the source only: the target copy is a warning, not a failure", () => {
      const collector = run(
        [item(1, { title: "A" })],
        [item(101, { title: "A" }), item(102, { title: "Gone" })],
        [
          [1, 101],
          [2, 102],
        ]
      );
      expect(collector.findings).toEqual([
        expect.objectContaining({ category: "sourceNotInPull", severity: "warning", targetID: 102 }),
      ]);
    });

    it("unpublished in the target only: the source item is reported missing", () => {
      const collector = run(
        [item(1, { title: "A" }), item(2, { title: "B" })],
        [item(101, { title: "A" }), item(102, { title: "B" }, { state: 7 })],
        [
          [1, 101],
          [2, 102],
        ]
      );
      expect(byCategory(collector, "danglingMapping")).toEqual([
        expect.objectContaining({ severity: "failure", sourceID: 2, targetID: 102 }),
      ]);
    });
  });

  it("treats a link to an empty list as no link", () => {
    const collector = run(
      [item(1, { title: "A" })],
      [item(101, { title: "A", related: { referencename: "posts_related_auto", fulllist: true } })],
      [[1, 101]]
    );
    expect(collector.findings).toEqual([]);
  });

  it("leaves out items whose container is deleted in the source, listing them once per container", () => {
    const collector = run(
      [
        item(1, { title: "A" }),
        item(2, { title: "x" }, { referenceName: "old_deleted" }),
        item(3, {}, { referenceName: "old_deleted" }),
      ],
      [item(101, { title: "A" })],
      [[1, 101]]
    );
    expect(collector.findings).toEqual([
      expect.objectContaining({
        category: "contentNotInLiveContainer",
        severity: "sourceDefect",
        name: "old_deleted",
        actual: 2,
      }),
    ]);
    expect(collector.talliesFor(LOCALE).content).toMatchObject({ checked: 3, matched: 1, known: 2, missing: 0 });
  });

  it("flags a source asset URL left in target content", () => {
    const sourceAsset = { mediaID: 1, containerEdgeUrl: "https://cdn/src-c", edgeUrl: "https://cdn/src-c/a.png" };
    const targetAsset = { mediaID: 2, containerEdgeUrl: "https://cdn/tgt-c", edgeUrl: "https://cdn/tgt-c/a.png" };
    const ctx = context({
      source: {
        models: [POST_MODEL_SOURCE],
        containers: SOURCE_CONTAINERS,
        assets: [sourceAsset],
        content: [item(1, { body: '<img src="https://cdn/src-c/a.png">' })],
      },
      target: {
        models: [POST_MODEL_TARGET],
        containers: TARGET_CONTAINERS,
        assets: [targetAsset],
        content: [item(101, { body: '<img src="https://cdn/src-c/a.png">' })],
      },
      mappings: {
        ...MAPPINGS,
        assets: [{ sourceMediaID: 1, targetMediaID: 2 }],
        locales: { [LOCALE]: { item: itemMappings([[1, 101]]) } },
      },
    });
    const collector = new FindingCollector();
    checkContent(ctx, checkLocaleIntegrity(ctx, collector).content, collector);
    expect(collector.findings.map((f) => f.category).sort()).toEqual(["fieldMismatch", "sourceAssetUrlInTarget"]);
  });
});

describe("source defects", () => {
  it("classifies a missing target copy of an item lacking a required field as a source defect", () => {
    const collector = run(
      [item(1, { title: "A" }), item(2, { body: "no title" })],
      [item(101, { title: "A" })],
      [[1, 101]]
    );
    const unmapped = byCategory(collector, "unmapped");
    expect(unmapped).toEqual([expect.objectContaining({ severity: "sourceDefect", sourceID: 2 })]);
    expect(unmapped[0].message).toContain("Title (Text)");
    expect(collector.talliesFor(LOCALE).content).toMatchObject({ known: 1, missing: 0 });
  });

  it("classifies a field difference on such an item as a source defect", () => {
    const collector = run([item(1, { body: "x" })], [item(101, { body: "y" })], [[1, 101]]);
    expect(collector.findings).toEqual([
      expect.objectContaining({ category: "fieldMismatch", severity: "sourceDefect" }),
    ]);
    expect(collector.talliesFor(LOCALE).content.known).toBe(1);
  });

  it("keeps an ordinary difference a failure", () => {
    const collector = run([item(1, { title: "A", body: "x" })], [item(101, { title: "A", body: "y" })], [[1, 101]]);
    expect(collector.findings).toEqual([expect.objectContaining({ category: "fieldMismatch", severity: "failure" })]);
  });
});
