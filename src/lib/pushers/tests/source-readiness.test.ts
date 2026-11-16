import { checkSourceReadiness, readinessError, readinessWarnings, LocaleCounts } from "../source-readiness";

const counts = (locale: string, content: [number, number], pages: [number, number]): LocaleCounts => ({
  locale,
  pulled: { content: content[0], pages: pages[0] },
  mapped: { content: content[1], pages: pages[1] },
});

describe("checkSourceReadiness (PROD-3212)", () => {
  it("fails a locale whose pull is empty when the mappings say the source had content and pages", () => {
    const issues = checkSourceReadiness([counts("en-us", [0, 1265], [0, 62])], ["content", "pages"]);

    expect(issues.map((i) => [i.kind, i.severity])).toEqual([
      ["content", "error"],
      ["pages", "error"],
    ]);
    expect(issues[0].message).toBe("the source returned no content items for en-us, but the mappings have 1265");
  });

  it("is quiet for a normal pull", () => {
    expect(checkSourceReadiness([counts("en-us", [1265, 1260], [62, 62])], ["content", "pages"])).toEqual([]);
  });

  it("only warns about an empty locale with nothing mapped (a first sync of an empty locale)", () => {
    const issues = checkSourceReadiness([counts("fr-ca", [0, 0], [0, 0])], ["content", "pages"]);

    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues).toHaveLength(2);
  });

  it("warns when the pull has under half of what is mapped", () => {
    const issues = checkSourceReadiness([counts("en-us", [400, 1265], [62, 62])], ["content", "pages"]);

    expect(issues).toEqual([
      expect.objectContaining({ kind: "content", severity: "warning", message: expect.stringContaining("under half of the 1265 mapped") }),
    ]);
  });

  it("doesn't call a drop on a small mapping", () => {
    expect(checkSourceReadiness([counts("en-us", [2, 10], [1, 5])], ["content", "pages"])).toEqual([]);
  });

  it("checks only the kinds the run syncs", () => {
    const issues = checkSourceReadiness([counts("en-us", [0, 1265], [62, 62])], ["pages"]);

    expect(issues).toEqual([]);
  });

  it("checks each locale on its own", () => {
    const issues = checkSourceReadiness(
      [counts("en-us", [1265, 1265], [62, 62]), counts("pt-br", [0, 650], [64, 64])],
      ["content", "pages"]
    );

    expect(issues).toEqual([expect.objectContaining({ locale: "pt-br", kind: "content", severity: "error" })]);
  });
});

describe("readinessError", () => {
  it("is null when there are only warnings", () => {
    const issues = checkSourceReadiness([counts("fr-ca", [0, 0], [0, 0])], ["content"]);

    expect(readinessError("src-u", issues)).toBeNull();
  });

  it("stops the run with a validation error that names every empty locale and what to do", () => {
    const issues = checkSourceReadiness(
      [counts("en-us", [0, 1265], [0, 62]), counts("pt-br", [0, 650], [64, 64])],
      ["content", "pages"]
    );
    const error = readinessError("src-u", issues)!;

    // "validation failed" is what makes the orchestrator rethrow instead of logging and continuing.
    expect(error.message).toContain("Source validation failed");
    expect(error.message).toContain("no content items for en-us");
    expect(error.message).toContain("no pages for en-us");
    expect(error.message).toContain("no content items for pt-br");
    expect(error.message).toContain("Nothing was written to the target");
    expect(error.message).toContain("src-u");
  });
});

describe("readinessWarnings", () => {
  it("turns warnings, not errors, into warning details for --jsonSummary", () => {
    const issues = checkSourceReadiness(
      [counts("en-us", [0, 5], [0, 0])],
      ["content", "pages"]
    );

    expect(readinessWarnings("src-u", issues)).toEqual([
      { name: "Source pages [en-us]", error: expect.stringContaining("no pages for en-us"), type: "page", locale: "en-us", guid: "src-u" },
    ]);
  });
});
