import { resetState } from "core/state";
import {
  extractModelModifiedDate,
  extractContainerModifiedDate,
  extractContentItemModifiedDate,
  extractAssetModifiedDate,
  extractPageModifiedDate,
  extractGalleryModifiedDate,
  extractTemplateModifiedDate,
  getDateExtractorForEntityType,
  INCREMENTAL_SUPPORTED_TYPES,
  FULL_REFRESH_REQUIRED_TYPES,
} from "../date-extractors";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// extractModelModifiedDate
// ---------------------------------------------------------------------------
describe("extractModelModifiedDate", () => {
  it("returns ISO 8601 string for a valid lastModifiedDate", () => {
    const result = extractModelModifiedDate({ lastModifiedDate: "2025-06-24T15:23:26.07" });
    expect(result).not.toBeNull();
    expect(() => new Date(result!)).not.toThrow();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  it("returns null when lastModifiedDate is absent", () => {
    expect(extractModelModifiedDate({})).toBeNull();
    expect(extractModelModifiedDate(null)).toBeNull();
    expect(extractModelModifiedDate(undefined)).toBeNull();
  });

  it("returns null when lastModifiedDate is not a string", () => {
    expect(extractModelModifiedDate({ lastModifiedDate: 12345 })).toBeNull();
    expect(extractModelModifiedDate({ lastModifiedDate: null })).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    const result = extractModelModifiedDate({ lastModifiedDate: "not-a-date" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractContainerModifiedDate
// ---------------------------------------------------------------------------
describe("extractContainerModifiedDate", () => {
  it('parses the human-readable "MM/dd/yyyy hh:mma" format', () => {
    const result = extractContainerModifiedDate({ lastModifiedDate: "03/05/2025 08:11AM" });
    expect(result).not.toBeNull();
    const parsed = new Date(result!);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getFullYear()).toBe(2025);
  });

  it("parses a PM time correctly", () => {
    const result = extractContainerModifiedDate({ lastModifiedDate: "08/25/2025 02:01PM" });
    expect(result).not.toBeNull();
    const parsed = new Date(result!);
    expect(parsed.getFullYear()).toBe(2025);
  });

  it("returns null when lastModifiedDate is absent", () => {
    expect(extractContainerModifiedDate({})).toBeNull();
    expect(extractContainerModifiedDate(null)).toBeNull();
  });

  it("returns null when lastModifiedDate is not a string", () => {
    expect(extractContainerModifiedDate({ lastModifiedDate: 42 })).toBeNull();
  });

  it("returns null (and warns) for an unparseable date string", () => {
    const result = extractContainerModifiedDate({ lastModifiedDate: "garbage-date" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractContentItemModifiedDate
// ---------------------------------------------------------------------------
describe("extractContentItemModifiedDate", () => {
  it("returns ISO 8601 string for a valid properties.modified", () => {
    const item = { properties: { modified: "2025-06-20T06:45:38.203" } };
    const result = extractContentItemModifiedDate(item);
    expect(result).not.toBeNull();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  it("returns null when properties is absent", () => {
    expect(extractContentItemModifiedDate({})).toBeNull();
    expect(extractContentItemModifiedDate(null)).toBeNull();
  });

  it("returns null when properties.modified is absent", () => {
    expect(extractContentItemModifiedDate({ properties: {} })).toBeNull();
  });

  it("returns null when properties.modified is not a string", () => {
    expect(extractContentItemModifiedDate({ properties: { modified: 99 } })).toBeNull();
  });

  it("returns null for an unparseable date string in properties.modified", () => {
    const result = extractContentItemModifiedDate({ properties: { modified: "bad-date" } });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractAssetModifiedDate
// ---------------------------------------------------------------------------
describe("extractAssetModifiedDate", () => {
  it("returns ISO 8601 string for a valid dateModified", () => {
    const result = extractAssetModifiedDate({ dateModified: "2025-03-06T03:38:21.25" });
    expect(result).not.toBeNull();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  it("returns null when dateModified is absent", () => {
    expect(extractAssetModifiedDate({})).toBeNull();
    expect(extractAssetModifiedDate(null)).toBeNull();
  });

  it("returns null when dateModified is not a string", () => {
    expect(extractAssetModifiedDate({ dateModified: true })).toBeNull();
  });

  it("returns null for an unparseable date string", () => {
    expect(extractAssetModifiedDate({ dateModified: "not-a-date" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractPageModifiedDate
// ---------------------------------------------------------------------------
describe("extractPageModifiedDate", () => {
  it("returns ISO 8601 string for a valid properties.modified", () => {
    const page = { properties: { modified: "2025-06-19T09:09:45.413" } };
    const result = extractPageModifiedDate(page);
    expect(result).not.toBeNull();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  it("returns null when properties is absent", () => {
    expect(extractPageModifiedDate({})).toBeNull();
    expect(extractPageModifiedDate(null)).toBeNull();
  });

  it("returns null when properties.modified is absent", () => {
    expect(extractPageModifiedDate({ properties: {} })).toBeNull();
  });

  it("returns null when properties.modified is not a string", () => {
    expect(extractPageModifiedDate({ properties: { modified: [] } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractGalleryModifiedDate
// ---------------------------------------------------------------------------
describe("extractGalleryModifiedDate", () => {
  it("returns ISO 8601 string for a valid modifiedOn", () => {
    const result = extractGalleryModifiedDate({ modifiedOn: "2025-04-28T08:54:50.773" });
    expect(result).not.toBeNull();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  it("returns null when modifiedOn is absent", () => {
    expect(extractGalleryModifiedDate({})).toBeNull();
    expect(extractGalleryModifiedDate(null)).toBeNull();
  });

  it("returns null when modifiedOn is not a string", () => {
    expect(extractGalleryModifiedDate({ modifiedOn: 0 })).toBeNull();
  });

  it("returns null for an unparseable date string", () => {
    expect(extractGalleryModifiedDate({ modifiedOn: "bad" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTemplateModifiedDate
// ---------------------------------------------------------------------------
describe("extractTemplateModifiedDate", () => {
  it("always returns null regardless of input", () => {
    expect(extractTemplateModifiedDate({})).toBeNull();
    expect(extractTemplateModifiedDate({ lastModifiedDate: "2025-01-01T00:00:00Z" })).toBeNull();
    expect(extractTemplateModifiedDate(null)).toBeNull();
    expect(extractTemplateModifiedDate(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDateExtractorForEntityType
// ---------------------------------------------------------------------------
describe("getDateExtractorForEntityType", () => {
  it.each([
    ["models", extractModelModifiedDate],
    ["containers", extractContainerModifiedDate],
    ["content", extractContentItemModifiedDate],
    ["items", extractContentItemModifiedDate],
    ["assets", extractAssetModifiedDate],
    ["pages", extractPageModifiedDate],
    ["galleries", extractGalleryModifiedDate],
    ["templates", extractTemplateModifiedDate],
  ])('returns the correct extractor for "%s"', (entityType, expectedFn) => {
    expect(getDateExtractorForEntityType(entityType)).toBe(expectedFn);
  });

  it("is case-insensitive", () => {
    expect(getDateExtractorForEntityType("MODELS")).toBe(extractModelModifiedDate);
    expect(getDateExtractorForEntityType("Pages")).toBe(extractPageModifiedDate);
  });

  it("returns null for an unknown entity type", () => {
    expect(getDateExtractorForEntityType("unknown-type")).toBeNull();
  });

  it("warns when entity type is unknown", () => {
    getDateExtractorForEntityType("mystery");
    expect(console.warn).toHaveBeenCalled();
  });

  it('returned extractor for "models" actually works on a model entity', () => {
    const extractor = getDateExtractorForEntityType("models")!;
    const result = extractor({ lastModifiedDate: "2025-01-15T10:00:00Z" });
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("INCREMENTAL_SUPPORTED_TYPES", () => {
  it("contains the six entity types that support incremental pull", () => {
    expect(INCREMENTAL_SUPPORTED_TYPES).toEqual(
      expect.arrayContaining(["models", "containers", "content", "assets", "pages", "galleries"])
    );
    expect(INCREMENTAL_SUPPORTED_TYPES).not.toContain("templates");
  });
});

describe("FULL_REFRESH_REQUIRED_TYPES", () => {
  it('contains "templates"', () => {
    expect(FULL_REFRESH_REQUIRED_TYPES).toContain("templates");
  });

  it("does not overlap with INCREMENTAL_SUPPORTED_TYPES", () => {
    const overlap = FULL_REFRESH_REQUIRED_TYPES.filter((t) => INCREMENTAL_SUPPORTED_TYPES.includes(t));
    expect(overlap).toHaveLength(0);
  });
});
