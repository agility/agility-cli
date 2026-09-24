import { resolveContainerSyncScope } from "lib/containers/resolve-container-sync-scope";
import { ContainerScopeTree } from "types/containerScope";

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeContainer(contentViewID: number, referenceName: string, contentDefinitionID = 10, title?: string): any {
  return { contentViewID, referenceName, contentDefinitionID, title: title ?? referenceName };
}

const MODELS = [
  { id: 10, referenceName: "HomeLinks" },
  { id: 11, referenceName: "Game" },
];

const CONTAINERS = [
  makeContainer(200, "AONHomeLinks", 10, "AON Home Links"),
  makeContainer(201, "MegaMillionsHomeLinks", 10, "Mega Millions Home Links"),
  makeContainer(300, "Games", 11, "Games"),
];

function emptyTree(overrides: Partial<ContainerScopeTree> = {}): ContainerScopeTree {
  return {
    containers: new Set<number>(),
    models: new Set<string>(),
    content: new Set<number>(),
    assets: new Set<string>(),
    galleries: new Set<number>(),
    ...overrides,
  };
}

interface HarnessOptions {
  locales?: string[];
  containers?: any[];
  models?: any[];
  contentByLocale?: { [locale: string]: any[] };
  buildTree?: (entities: any, containerIDs: number[]) => ContainerScopeTree;
}

function resolve(selectors: string[], options: HarnessOptions = {}) {
  const locales = options.locales ?? ["en-us"];
  const containers = options.containers ?? CONTAINERS;
  const models = options.models ?? MODELS;

  return resolveContainerSyncScope({
    sourceGuid: "src",
    targetGuid: "tgt",
    locales,
    selectors,
    loadEntities: async (_guid: string, locale: string) => ({
      containers,
      models,
      content: options.contentByLocale?.[locale] ?? [],
    }),
    buildTree:
      options.buildTree ??
      ((_entities: any, containerIDs: number[]) =>
        emptyTree({ containers: new Set(containerIDs), models: new Set(["HomeLinks"]) })),
  });
}

// ─── validation ───────────────────────────────────────────────────────────────

describe("resolveContainerSyncScope — validation", () => {
  it("halts when a selector matches no container", async () => {
    await expect(resolve(["NoSuchContainer"])).rejects.toThrow(/Container validation failed/);
  });

  it("names the unmatched selector in the error", async () => {
    await expect(resolve(["NoSuchContainer"])).rejects.toThrow(/NoSuchContainer/);
  });

  it("lists the available containers on the console before halting", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await expect(resolve(["NoSuchContainer"])).rejects.toThrow();
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("AONHomeLinks");
  });

  it("halts on an empty selector list", async () => {
    await expect(resolve([])).rejects.toThrow(/contained no container selectors/);
  });

  it("halts when there are no locales to resolve against", async () => {
    await expect(resolve(["AONHomeLinks"], { locales: [] })).rejects.toThrow(/at least one locale/);
  });

  it("halts when one of several selectors is bad, even if the others matched", async () => {
    await expect(resolve(["AONHomeLinks", "Typo"])).rejects.toThrow(/Typo/);
  });

  // The orchestrator only re-throws errors whose message carries "validation failed"; anything
  // else is swallowed as a warning and the sync carries on with an unfiltered scope.
  it("uses the halt wording the push loop re-throws on", async () => {
    await expect(resolve(["Typo"])).rejects.toThrow(/validation failed/);
  });
});

// ─── resolution ───────────────────────────────────────────────────────────────

describe("resolveContainerSyncScope — resolution", () => {
  it("resolves a selector to the container it names", async () => {
    const scope = await resolve(["AONHomeLinks"]);
    expect(scope.matches.map((m) => m.contentViewID)).toEqual([200]);
  });

  it("does not sweep in a sibling container on the same model", async () => {
    const scope = await resolve(["AONHomeLinks"]);
    expect(scope.allContainerIDs.has(201)).toBe(false);
  });

  it("reports the sibling container it left alone", async () => {
    const scope = await resolve(["AONHomeLinks"]);
    expect(scope.siblings.map((s) => s.contentViewID)).toEqual([201]);
  });

  it("reports a container the tree pulled in as a dependency", async () => {
    const scope = await resolve(["AONHomeLinks"], {
      buildTree: () => emptyTree({ containers: new Set([200, 300]), models: new Set(["HomeLinks", "Game"]) }),
    });
    expect(scope.dependencies.map((d) => d.contentViewID)).toEqual([300]);
    expect(scope.matches.map((m) => m.contentViewID)).toEqual([200]);
  });

  it("carries the per-locale tree and its content count", async () => {
    const scope = await resolve(["AONHomeLinks"], {
      buildTree: () => emptyTree({ containers: new Set([200]), content: new Set([1, 2, 3]) }),
    });
    expect(scope.byLocale.get("en-us")?.contentCount).toBe(3);
    expect(scope.byLocale.get("en-us")?.tree.content.has(2)).toBe(true);
  });

  it("builds one tree per locale", async () => {
    const buildTree = jest.fn(() => emptyTree({ containers: new Set([200]) }));
    const scope = await resolve(["AONHomeLinks"], { locales: ["en-us", "fr-ca"], buildTree });
    expect(buildTree).toHaveBeenCalledTimes(2);
    expect(Array.from(scope.byLocale.keys())).toEqual(["en-us", "fr-ca"]);
  });

  it("unions the instance-wide sets across locales, so a guid-level phase sees them all", async () => {
    const trees: { [locale: string]: ContainerScopeTree } = {
      "en-us": emptyTree({ containers: new Set([200]), models: new Set(["HomeLinks"]) }),
      "fr-ca": emptyTree({ containers: new Set([200, 300]), models: new Set(["HomeLinks", "Game"]) }),
    };
    let call = 0;
    const scope = await resolve(["AONHomeLinks"], {
      locales: ["en-us", "fr-ca"],
      buildTree: () => trees[call++ === 0 ? "en-us" : "fr-ca"],
    });
    expect(Array.from(scope.allContainerIDs).sort((a, b) => a - b)).toEqual([200, 300]);
    expect(Array.from(scope.allModelReferenceNames).sort()).toEqual(["Game", "HomeLinks"]);
  });

  it("resolves the container selection once, against the first locale", async () => {
    const loadEntities = jest.fn(async () => ({ containers: CONTAINERS, models: MODELS, content: [] }));
    const scope = await resolveContainerSyncScope({
      sourceGuid: "src",
      targetGuid: "tgt",
      locales: ["en-us", "fr-ca"],
      selectors: ["AONHomeLinks"],
      loadEntities,
      buildTree: () => emptyTree({ containers: new Set([200]) }),
    });
    expect(loadEntities).toHaveBeenCalledTimes(2);
    expect(scope.matches).toHaveLength(1);
  });

  it("passes the selected container IDs to the tree builder", async () => {
    // Typed parameters so `mock.calls[0][1]` type-checks under `npm run type-check:tests`
    // (a zero-arg jest.fn types its recorded calls as `[]`).
    const buildTree = jest.fn((_entities: any, _containerIDs: number[]) => emptyTree());
    await resolve(["AONHomeLinks", "Games"], { buildTree });
    expect(buildTree.mock.calls[0][1]).toEqual([200, 300]);
  });

  it("keeps the selectors the user typed", async () => {
    const scope = await resolve(["aon home links"]);
    expect(scope.selectors).toEqual(["aon home links"]);
  });
});
