import { keptTargetChanges, KEPT_TARGET_CHANGE_MESSAGE } from "../kept-target-changes";

beforeEach(() => {
  keptTargetChanges.reset();
});

describe("keptTargetChanges.record", () => {
  it("starts empty and reports no entries", () => {
    expect(keptTargetChanges.hasEntries()).toBe(false);
    expect(keptTargetChanges.getEntries()).toEqual([]);
    expect(keptTargetChanges.renderSummaryLines()).toEqual([]);
  });

  it("ignores a repeat of the same entity (same type, locale and source ID)", () => {
    keptTargetChanges.record({ type: "content", name: "a", locale: "en-us", sourceID: 1, targetID: 10 });
    keptTargetChanges.record({ type: "content", name: "a", locale: "en-us", sourceID: 1, targetID: 10 });

    expect(keptTargetChanges.getEntries()).toHaveLength(1);
  });

  it("dedupes by name when there is no source ID", () => {
    keptTargetChanges.record({ type: "model", name: "Article" });
    keptTargetChanges.record({ type: "model", name: "Article" });

    expect(keptTargetChanges.getEntries()).toHaveLength(1);
  });

  it.each([
    ["locale", { type: "content" as const, name: "a", locale: "fr", sourceID: 1 }],
    ["type", { type: "page" as const, name: "a", locale: "en-us", sourceID: 1 }],
    ["source ID", { type: "content" as const, name: "a", locale: "en-us", sourceID: 2 }],
  ])("keeps entities that differ by %s", (_label, other) => {
    keptTargetChanges.record({ type: "content", name: "a", locale: "en-us", sourceID: 1 });
    keptTargetChanges.record(other);

    expect(keptTargetChanges.getEntries()).toHaveLength(2);
  });

  it("reset clears recorded entries", () => {
    keptTargetChanges.record({ type: "asset", name: "x.png", sourceID: 1 });
    keptTargetChanges.reset();

    expect(keptTargetChanges.hasEntries()).toBe(false);
  });

  it("getEntries returns a copy", () => {
    keptTargetChanges.record({ type: "asset", name: "x.png", sourceID: 1 });
    keptTargetChanges.getEntries().pop();

    expect(keptTargetChanges.getEntries()).toHaveLength(1);
  });
});

describe("keptTargetChanges.headline", () => {
  it("counts by type with plurals", () => {
    keptTargetChanges.record({ type: "content", name: "a", sourceID: 1 });
    keptTargetChanges.record({ type: "content", name: "b", sourceID: 2 });
    keptTargetChanges.record({ type: "page", name: "p", sourceID: 3 });

    expect(keptTargetChanges.headline()).toBe("Target changes kept: 2 content items, 1 page");
  });

  it.each([
    ["content", "1 content item"],
    ["asset", "1 asset"],
    ["gallery", "1 gallery"],
    ["container", "1 container"],
    ["model", "1 model"],
    ["page", "1 page"],
  ] as const)("uses the singular label for one %s", (type, label) => {
    keptTargetChanges.record({ type, name: "n", sourceID: 1 });

    expect(keptTargetChanges.headline()).toBe(`Target changes kept: ${label}`);
  });

  it("pluralises the label for several of one type", () => {
    keptTargetChanges.record({ type: "asset", name: "a", sourceID: 1 });
    keptTargetChanges.record({ type: "asset", name: "b", sourceID: 2 });

    expect(keptTargetChanges.headline()).toBe("Target changes kept: 2 assets");
  });

  it("spells galleries", () => {
    keptTargetChanges.record({ type: "gallery", name: "a", sourceID: 1 });
    keptTargetChanges.record({ type: "gallery", name: "b", sourceID: 2 });

    expect(keptTargetChanges.headline()).toBe("Target changes kept: 2 galleries");
  });
});

describe("keptTargetChanges.formatLine", () => {
  it("includes type, name, locale, target ID and the --overwrite hint", () => {
    const line = keptTargetChanges.formatLine({ type: "page", name: "About", locale: "en-us", targetID: 9 });

    expect(line).toContain("page About [en-us] (target ID 9)");
    expect(line).toContain(KEPT_TARGET_CHANGE_MESSAGE);
  });

  it("omits locale and target ID when absent", () => {
    const line = keptTargetChanges.formatLine({ type: "model", name: "Article" });

    expect(line).toContain("model Article changed on the target");
  });
});

describe("keptTargetChanges.renderSummaryLines", () => {
  it("renders the headline, one line per entity, then the explanation", () => {
    keptTargetChanges.record({
      type: "content",
      name: "item-a",
      locale: "en-us",
      sourceID: 1,
      targetID: 10,
      targetUrl: "https://example.test/10",
    });
    keptTargetChanges.record({ type: "model", name: "Article", sourceID: 2 });

    const lines = keptTargetChanges.renderSummaryLines();

    expect(lines[0]).toBe("Target changes kept: 1 content item, 1 model (non-blocking):");
    expect(lines[1]).toBe("  • [en-us] content item item-a https://example.test/10");
    expect(lines[2]).toBe("  • model Article");
    expect(lines[3]).toMatch(/Use --overwrite to replace them with the source/);
    expect(lines).toHaveLength(4);
  });
});

describe("keptTargetChanges.toWarningDetails", () => {
  it("sets code, guid, type, IDs and a message that mentions --overwrite", () => {
    keptTargetChanges.record({
      type: "gallery",
      name: "Hero",
      sourceID: 1,
      targetID: 2,
    });

    expect(keptTargetChanges.toWarningDetails("tgt-guid")).toEqual([
      expect.objectContaining({
        name: "Hero",
        type: "gallery",
        guid: "tgt-guid",
        code: "targetChangeKept",
        sourceID: 1,
        targetID: 2,
        error: expect.stringContaining("--overwrite"),
      }),
    ]);
  });

  it("adds contentID for a content item and pageID for a page, using the target ID", () => {
    keptTargetChanges.record({ type: "content", name: "c", locale: "en-us", sourceID: 1, targetID: 11 });
    keptTargetChanges.record({ type: "page", name: "p", locale: "en-us", sourceID: 2, targetID: 22 });

    const [content, page] = keptTargetChanges.toWarningDetails("g");

    expect(content).toMatchObject({ contentID: 11, locale: "en-us" });
    expect(content).not.toHaveProperty("pageID");
    expect(page).toMatchObject({ pageID: 22, locale: "en-us" });
    expect(page).not.toHaveProperty("contentID");
  });

  it("omits contentID and pageID for other types", () => {
    keptTargetChanges.record({ type: "container", name: "c", sourceID: 1, targetID: 2 });

    const [detail] = keptTargetChanges.toWarningDetails("g");

    expect(detail).not.toHaveProperty("contentID");
    expect(detail).not.toHaveProperty("pageID");
  });

  it("returns an empty list when nothing was kept", () => {
    expect(keptTargetChanges.toWarningDetails("g")).toEqual([]);
  });
});
