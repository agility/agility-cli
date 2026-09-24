import {
  collectDependencyContainers,
  collectSiblingContainers,
  listAvailableContainerNames,
  modelReferenceNameForContainer,
  parseContainerSelectors,
  renderContainerScope,
  selectContainers,
} from "lib/containers/container-scope";
import { ContainerSyncScope } from "types/containerScope";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeContainer(contentViewID: number, referenceName: string, contentDefinitionID = 10, title?: string): any {
  return { contentViewID, referenceName, contentDefinitionID, title: title ?? referenceName };
}

function makeModel(id: number, referenceName: string): any {
  return { id, referenceName };
}

const MODELS = [makeModel(10, "HomeLinks"), makeModel(11, "Game")];
const CONTAINERS = [
  makeContainer(200, "AONHomeLinks", 10, "AON Home Links"),
  makeContainer(201, "MegaMillionsHomeLinks", 10, "Mega Millions Home Links"),
  makeContainer(300, "Games", 11, "Games"),
];

// ─── parseContainerSelectors ─────────────────────────────────────────────────

describe("parseContainerSelectors", () => {
  it("splits on commas and trims", () => {
    expect(parseContainerSelectors(" Posts , Authors ")).toEqual(["Posts", "Authors"]);
  });

  it("returns an empty list for empty, null and undefined input", () => {
    expect(parseContainerSelectors("")).toEqual([]);
    expect(parseContainerSelectors(null)).toEqual([]);
    expect(parseContainerSelectors(undefined)).toEqual([]);
  });

  it("drops empty segments", () => {
    expect(parseContainerSelectors("Posts,,Authors,")).toEqual(["Posts", "Authors"]);
  });

  it("drops duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseContainerSelectors("Posts,posts,POSTS")).toEqual(["Posts"]);
  });
});

// ─── selectContainers ────────────────────────────────────────────────────────

describe("selectContainers", () => {
  it("matches on reference name, case-insensitively", () => {
    const { matches, unmatched } = selectContainers(CONTAINERS, MODELS, ["aonhomelinks"]);
    expect(unmatched).toEqual([]);
    expect(matches.map((m) => m.contentViewID)).toEqual([200]);
  });

  it("matches on the CMS title", () => {
    const { matches } = selectContainers(CONTAINERS, MODELS, ["AON Home Links"]);
    expect(matches.map((m) => m.contentViewID)).toEqual([200]);
  });

  it("matches on the container ID", () => {
    const { matches } = selectContainers(CONTAINERS, MODELS, ["300"]);
    expect(matches.map((m) => m.contentViewID)).toEqual([300]);
  });

  it("does not match a sibling container on the same model", () => {
    const { matches } = selectContainers(CONTAINERS, MODELS, ["AONHomeLinks"]);
    expect(matches.map((m) => m.contentViewID)).not.toContain(201);
  });

  it("reports a selector that matches nothing", () => {
    const { matches, unmatched } = selectContainers(CONTAINERS, MODELS, ["Nope"]);
    expect(matches).toEqual([]);
    expect(unmatched).toEqual(["Nope"]);
  });

  it("resolves the model reference name for a match", () => {
    const { matches } = selectContainers(CONTAINERS, MODELS, ["AONHomeLinks"]);
    expect(matches[0].modelReferenceName).toBe("HomeLinks");
  });

  it("keeps every container a selector matched, rather than silently picking one", () => {
    const duplicates = [makeContainer(1, "RefA", 10, "Shared Title"), makeContainer(2, "RefB", 10, "Shared Title")];
    const { matches } = selectContainers(duplicates, MODELS, ["Shared Title"]);
    expect(matches.map((m) => m.contentViewID)).toEqual([1, 2]);
  });

  it("reports a container matched by two selectors only once", () => {
    const { matches } = selectContainers(CONTAINERS, MODELS, ["AONHomeLinks", "200"]);
    expect(matches.map((m) => m.contentViewID)).toEqual([200]);
  });

  it("handles a missing containers array", () => {
    const { matches, unmatched } = selectContainers(undefined as any, MODELS, ["Posts"]);
    expect(matches).toEqual([]);
    expect(unmatched).toEqual(["Posts"]);
  });
});

// ─── modelReferenceNameForContainer ──────────────────────────────────────────

describe("modelReferenceNameForContainer", () => {
  it("resolves through contentDefinitionID", () => {
    expect(modelReferenceNameForContainer(CONTAINERS[0], MODELS)).toBe("HomeLinks");
  });

  it("falls back to the container's own contentDefinitionName when the model is missing", () => {
    const orphan = { contentViewID: 9, contentDefinitionID: 99, contentDefinitionName: "Ghost" };
    expect(modelReferenceNameForContainer(orphan, MODELS)).toBe("Ghost");
  });

  it("returns an empty string when nothing resolves", () => {
    expect(modelReferenceNameForContainer({ contentViewID: 9, contentDefinitionID: 99 }, MODELS)).toBe("");
  });
});

// ─── collectDependencyContainers ─────────────────────────────────────────────

describe("collectDependencyContainers", () => {
  it("returns in-scope containers the user did not name", () => {
    const dependencies = collectDependencyContainers(CONTAINERS, MODELS, new Set([200, 300]), new Set([200]));
    expect(dependencies.map((d) => d.contentViewID)).toEqual([300]);
  });

  it("returns nothing when every in-scope container was named", () => {
    expect(collectDependencyContainers(CONTAINERS, MODELS, new Set([200]), new Set([200]))).toEqual([]);
  });
});

// ─── collectSiblingContainers ────────────────────────────────────────────────

describe("collectSiblingContainers", () => {
  it("lists out-of-scope containers built on an in-scope model", () => {
    const siblings = collectSiblingContainers(CONTAINERS, MODELS, new Set([200]), new Set(["HomeLinks"]));
    expect(siblings.map((s) => s.contentViewID)).toEqual([201]);
  });

  it("does not list containers on a model that is not in scope", () => {
    const siblings = collectSiblingContainers(CONTAINERS, MODELS, new Set([200]), new Set(["HomeLinks"]));
    expect(siblings.map((s) => s.contentViewID)).not.toContain(300);
  });

  it("does not list a container that is itself in scope", () => {
    const siblings = collectSiblingContainers(CONTAINERS, MODELS, new Set([200, 201]), new Set(["HomeLinks"]));
    expect(siblings).toEqual([]);
  });

  it("compares model names case-insensitively", () => {
    const siblings = collectSiblingContainers(CONTAINERS, MODELS, new Set([200]), new Set(["homelinks"]));
    expect(siblings.map((s) => s.contentViewID)).toEqual([201]);
  });
});

// ─── listAvailableContainerNames ─────────────────────────────────────────────

describe("listAvailableContainerNames", () => {
  it("returns sorted reference names", () => {
    expect(listAvailableContainerNames(CONTAINERS)).toEqual(["AONHomeLinks", "Games", "MegaMillionsHomeLinks"]);
  });

  it("falls back to the title when a container has no reference name", () => {
    expect(listAvailableContainerNames([{ contentViewID: 1, title: "Only A Title" }])).toEqual(["Only A Title"]);
  });

  it("handles a missing containers array", () => {
    expect(listAvailableContainerNames(undefined as any)).toEqual([]);
  });
});

// ─── renderContainerScope ────────────────────────────────────────────────────

function makeScope(overrides: Partial<ContainerSyncScope> = {}): ContainerSyncScope {
  return {
    selectors: ["AONHomeLinks"],
    matches: [
      {
        selector: "AONHomeLinks",
        contentViewID: 200,
        referenceName: "AONHomeLinks",
        title: "AON Home Links",
        modelReferenceName: "HomeLinks",
      },
    ],
    dependencies: [],
    siblings: [],
    byLocale: new Map([
      [
        "en-us",
        {
          locale: "en-us",
          tree: {
            containers: new Set([200]),
            models: new Set(["HomeLinks"]),
            content: new Set([1, 2]),
            assets: new Set<string>(),
            galleries: new Set<number>(),
          },
          contentCount: 2,
        },
      ],
    ]),
    allContainerIDs: new Set([200]),
    allModelReferenceNames: new Set(["HomeLinks"]),
    ...overrides,
  };
}

describe("renderContainerScope", () => {
  it("names the selected container with its title and reference name", () => {
    expect(renderContainerScope(makeScope())).toContain("AON Home Links (AONHomeLinks)");
  });

  it("collapses the label when title and reference name agree", () => {
    const scope = makeScope({
      matches: [
        {
          selector: "Games",
          contentViewID: 300,
          referenceName: "Games",
          title: "Games",
          modelReferenceName: "Game",
        },
      ],
    });
    expect(renderContainerScope(scope)).toContain("Games");
    expect(renderContainerScope(scope)).not.toContain("Games (Games)");
  });

  it("reports the content count for each locale", () => {
    expect(renderContainerScope(makeScope())).toContain("en-us: 2");
  });

  it("separates containers that came along as dependencies", () => {
    const scope = makeScope({
      dependencies: [{ contentViewID: 300, referenceName: "Games", title: "Games", modelReferenceName: "Game" }],
    });
    const out = renderContainerScope(scope);
    expect(out).toContain("Also synced, because in-scope content links to items in them");
    expect(out).toContain("Games");
  });

  it("lists the sibling containers being left alone — the reason the flag exists", () => {
    const scope = makeScope({
      siblings: [
        {
          contentViewID: 201,
          referenceName: "MegaMillionsHomeLinks",
          title: "Mega Millions Home Links",
          modelReferenceName: "HomeLinks",
        },
      ],
    });
    const out = renderContainerScope(scope);
    expect(out).toContain("left unchanged on the target");
    expect(out).toContain("Mega Millions Home Links (MegaMillionsHomeLinks)");
  });

  it("summarises the tail when a model has more siblings than it lists", () => {
    const siblings = Array.from({ length: 18 }, (_, index) => ({
      contentViewID: 400 + index,
      referenceName: `Sibling${index}`,
      title: `Sibling ${index}`,
      modelReferenceName: "HomeLinks",
    }));
    const out = renderContainerScope(makeScope({ siblings }));
    expect(out).toContain("and 3 more");
  });

  it("says outright that pages, templates and redirections are untouched", () => {
    expect(renderContainerScope(makeScope())).toContain(
      "No pages, templates or URL redirections are touched by a container sync."
    );
  });

  it("omits the dependency and sibling sections when there are none", () => {
    const out = renderContainerScope(makeScope());
    expect(out).not.toContain("Also synced, because");
    expect(out).not.toContain("left unchanged on the target");
  });
});
