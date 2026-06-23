import { content } from "../content";

// content constructor requires mgmtApi.Options and a MultiBar, neither of which we want
// to actually instantiate here. We create a minimal stub to reach camelize().
function makeContent() {
  return new content(
    {} as any, // options stub
    {} as any, // multibar stub
    "test-guid",
    "en-us"
  );
}

// ─── camelize ─────────────────────────────────────────────────────────────────

describe("content.camelize", () => {
  it("lowercases the first character of a PascalCase string", () => {
    expect(makeContent().camelize("BlogPost")).toBe("blogPost");
  });

  it("lowercases first character and preserves remaining PascalCase", () => {
    expect(makeContent().camelize("PostList")).toBe("postList");
  });

  it("handles a single word with all lowercase", () => {
    expect(makeContent().camelize("blog")).toBe("blog");
  });

  it("handles a single word starting with uppercase", () => {
    expect(makeContent().camelize("Blog")).toBe("blog");
  });

  it("removes underscores between words", () => {
    expect(makeContent().camelize("hello_world")).toBe("helloworld");
  });

  it("removes spaces between words", () => {
    expect(makeContent().camelize("hello world")).toBe("helloworld");
  });

  it("handles empty string", () => {
    expect(makeContent().camelize("")).toBe("");
  });

  it("handles already-camelCase input", () => {
    expect(makeContent().camelize("myModel")).toBe("myModel");
  });

  it("handles a multi-word PascalCase string", () => {
    expect(makeContent().camelize("HeroBanner")).toBe("heroBanner");
  });
});
