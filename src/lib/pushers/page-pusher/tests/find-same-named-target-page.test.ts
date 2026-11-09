import { findSameNamedTargetPage, pageTypesDiffer } from "../find-same-named-target-page";

const pages = [
  { pageID: 5, parentPageID: -1, pageName: "home", pageType: "Template", childPages: [] },
  {
    pageID: 70,
    parentPageID: -1,
    pageName: "events",
    pageType: "Container",
    childPages: [
      { pageID: 71, parentPageID: 70, pageName: "signup", pageType: "Custom", childPages: [] },
      {
        pageID: 75,
        parentPageID: 70,
        pageName: "deep",
        pageType: "Container",
        childPages: [{ pageID: 76, parentPageID: 75, pageName: "leaf", pageType: "Template", childPages: [] }],
      },
    ],
  },
];

describe("findSameNamedTargetPage", () => {
  it("finds a root page, case-insensitively", () => {
    expect(findSameNamedTargetPage(pages, -1, "Events")).toEqual({
      path: "/events",
      pageID: 70,
      pageName: "events",
      pageType: "Container",
    });
    expect(findSameNamedTargetPage(pages, 0, "home")?.pageID).toBe(5);
  });

  it("finds a page under the given parent, at any depth", () => {
    expect(findSameNamedTargetPage(pages, 70, "signup")?.pageID).toBe(71);
    expect(findSameNamedTargetPage(pages, 75, "leaf")?.pageID).toBe(76);
  });

  it("ignores a same-named page at another level", () => {
    expect(findSameNamedTargetPage(pages, -1, "signup")).toBeNull();
    expect(findSameNamedTargetPage(pages, 70, "home")).toBeNull();
    expect(findSameNamedTargetPage(pages, 999, "leaf")).toBeNull();
  });

  it("uses the tree position when a node has no parentPageID", () => {
    const bare = [{ pageID: 1, pageName: "a", childPages: [{ pageID: 2, pageName: "b", childPages: [] }] }];
    expect(findSameNamedTargetPage(bare, -1, "a")?.pageID).toBe(1);
    expect(findSameNamedTargetPage(bare, 1, "b")?.pageID).toBe(2);
    expect(findSameNamedTargetPage(bare, -1, "b")).toBeNull();
  });

  it("returns null with no sitemap or no name", () => {
    expect(findSameNamedTargetPage(undefined, -1, "home")).toBeNull();
    expect(findSameNamedTargetPage(pages, -1, "")).toBeNull();
  });
});

describe("pageTypesDiffer", () => {
  it("compares page-file types with management sitemap types", () => {
    expect(pageTypesDiffer("folder", "Container")).toBe(false);
    expect(pageTypesDiffer("static", "Template")).toBe(false);
    expect(pageTypesDiffer("link", "Custom")).toBe(false);
    expect(pageTypesDiffer("static", "Container")).toBe(true);
    expect(pageTypesDiffer("folder", "Custom")).toBe(true);
  });

  it("never reports a difference it can't be sure of", () => {
    expect(pageTypesDiffer("dynamic", "Template")).toBe(false);
    expect(pageTypesDiffer("static", null)).toBe(false);
    expect(pageTypesDiffer("static", "Something")).toBe(false);
  });
});

describe("findSameNamedTargetPage — path", () => {
  it("gives the full target path", () => {
    expect(findSameNamedTargetPage(pages, 70, "signup")?.path).toBe("/events/signup");
    expect(findSameNamedTargetPage(pages, 75, "leaf")?.path).toBe("/events/deep/leaf");
  });
});
