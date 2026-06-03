import { resetState } from "core/state";
import { collectListReferenceNames } from "../collect-list-reference-names";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("collectListReferenceNames", () => {
  describe("null / empty inputs", () => {
    it("returns empty array for null", () => {
      expect(collectListReferenceNames(null)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(collectListReferenceNames(undefined)).toEqual([]);
    });

    it("returns empty array for empty object", () => {
      expect(collectListReferenceNames({})).toEqual([]);
    });

    it("returns empty array for empty array", () => {
      expect(collectListReferenceNames([])).toEqual([]);
    });
  });

  describe("camelCase property names (referenceName / fullList)", () => {
    it("returns referenceName when referenceName + fullList=true", () => {
      const fields = { referenceName: "my-list", fullList: true };
      expect(collectListReferenceNames(fields)).toEqual(["my-list"]);
    });

    it("ignores node when fullList=false", () => {
      const fields = { referenceName: "my-list", fullList: false };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });

    it("ignores node when fullList is absent", () => {
      const fields = { referenceName: "my-list" };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });
  });

  describe("lowercase property names (referencename / fulllist)", () => {
    it("returns referencename when referencename + fulllist=true", () => {
      const fields = { referencename: "lower-list", fulllist: true };
      expect(collectListReferenceNames(fields)).toEqual(["lower-list"]);
    });

    it("ignores node when fulllist=false", () => {
      const fields = { referencename: "lower-list", fulllist: false };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });
  });

  describe("nested objects", () => {
    it("finds reference names in nested objects", () => {
      const fields = {
        outer: {
          inner: { referenceName: "nested-ref", fullList: true },
        },
      };
      expect(collectListReferenceNames(fields)).toEqual(["nested-ref"]);
    });

    it("finds multiple reference names at different depths", () => {
      const fields = {
        a: { referenceName: "ref-a", fullList: true },
        b: {
          c: { referenceName: "ref-c", fullList: true },
        },
      };
      const result = collectListReferenceNames(fields);
      expect(result).toHaveLength(2);
      expect(result).toContain("ref-a");
      expect(result).toContain("ref-c");
    });
  });

  describe("arrays", () => {
    it("walks array elements to find reference names", () => {
      const fields = [
        { referenceName: "ref-1", fullList: true },
        { referenceName: "ref-2", fullList: false },
        { referenceName: "ref-3", fullList: true },
      ];
      const result = collectListReferenceNames(fields);
      expect(result).toEqual(["ref-1", "ref-3"]);
    });

    it("handles nested arrays", () => {
      const fields = {
        items: [[{ referenceName: "deep-ref", fullList: true }]],
      };
      expect(collectListReferenceNames(fields)).toEqual(["deep-ref"]);
    });
  });

  describe("non-string referenceName", () => {
    it("ignores nodes where referenceName is a number", () => {
      const fields = { referenceName: 123 as any, fullList: true };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });

    it("ignores nodes where referenceName is null", () => {
      const fields = { referenceName: null, fullList: true };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });
  });

  describe("scalar values inside objects", () => {
    it("does not throw on primitive field values", () => {
      const fields = { title: "hello", count: 42, flag: true };
      expect(() => collectListReferenceNames(fields)).not.toThrow();
    });

    it("returns empty array when no fullList flags are set", () => {
      const fields = { title: "hello", count: 42 };
      expect(collectListReferenceNames(fields)).toEqual([]);
    });
  });

  describe("duplicate reference names", () => {
    it("includes duplicate entries when the same reference name appears twice", () => {
      const fields = {
        a: { referenceName: "dup", fullList: true },
        b: { referenceName: "dup", fullList: true },
      };
      const result = collectListReferenceNames(fields);
      expect(result).toHaveLength(2);
      expect(result.every((r) => r === "dup")).toBe(true);
    });
  });
});
