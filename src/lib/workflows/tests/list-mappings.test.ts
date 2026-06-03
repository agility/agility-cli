import { resetState } from "core/state";
import { listMappings } from "../list-mappings";
import * as mappingReader from "../../mappers/mapping-reader";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── listMappings ─────────────────────────────────────────────────────────────

describe("listMappings", () => {
  it('logs a "No mappings found" message when no pairs are returned', () => {
    jest.spyOn(mappingReader, "listAvailableMappingPairs").mockReturnValue([]);
    const logSpy = jest.spyOn(console, "log");

    listMappings();

    const calls = logSpy.mock.calls.map((args) => args[0]);
    const hasNoMappings = calls.some((c) => typeof c === "string" && c.includes("No mappings found"));
    expect(hasNoMappings).toBe(true);
  });

  it("does not crash and logs pair info when mappings are available", () => {
    jest
      .spyOn(mappingReader, "listAvailableMappingPairs")
      .mockReturnValue([{ sourceGuid: "src-a", targetGuid: "tgt-b", locales: ["en-us"] }]);
    jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue({
      totalContent: 5,
      totalPages: 2,
      localesFound: ["en-us"],
    } as any);
    const logSpy = jest.spyOn(console, "log");

    expect(() => listMappings()).not.toThrow();

    const calls = logSpy.mock.calls.map((args) => args[0]);
    const mentionsSource = calls.some((c) => typeof c === "string" && c.includes("src-a"));
    expect(mentionsSource).toBe(true);
  });

  it("calls getMappingSummary with correct guid pair and locales for each found pair", () => {
    const pairs = [
      { sourceGuid: "src-1", targetGuid: "tgt-1", locales: ["en-us", "fr-fr"] },
      { sourceGuid: "src-2", targetGuid: "tgt-2", locales: ["de-de"] },
    ];
    jest.spyOn(mappingReader, "listAvailableMappingPairs").mockReturnValue(pairs);
    const summarySpy = jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue({
      totalContent: 0,
      totalPages: 0,
      localesFound: [],
    } as any);

    listMappings();

    expect(summarySpy).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledWith("src-1", "tgt-1", ["en-us", "fr-fr"]);
    expect(summarySpy).toHaveBeenCalledWith("src-2", "tgt-2", ["de-de"]);
  });

  it("logs content and page counts from the summary", () => {
    jest
      .spyOn(mappingReader, "listAvailableMappingPairs")
      .mockReturnValue([{ sourceGuid: "src-x", targetGuid: "tgt-y", locales: ["en-us"] }]);
    jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue({
      totalContent: 42,
      totalPages: 7,
      localesFound: ["en-us"],
    } as any);
    const logSpy = jest.spyOn(console, "log");

    listMappings();

    const calls = logSpy.mock.calls.map((args) => args[0]);
    const hasContent = calls.some((c) => typeof c === "string" && c.includes("42"));
    const hasPages = calls.some((c) => typeof c === "string" && c.includes("7"));
    expect(hasContent).toBe(true);
    expect(hasPages).toBe(true);
  });
});
