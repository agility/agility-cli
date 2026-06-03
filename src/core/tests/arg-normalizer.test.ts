import { normalizeProcessArgs, normalizeArgv } from "../arg-normalizer";

beforeEach(() => {
  // Reset process.argv to a clean baseline before each test
  process.argv = ["node", "script.js"];
});

describe("normalizeProcessArgs", () => {
  it("returns false when no normalization needed", () => {
    process.argv = ["node", "script.js", "--sourceGuid", "abc123"];
    expect(normalizeProcessArgs()).toBe(false);
  });

  it("replaces em dash with double hyphen", () => {
    process.argv = ["node", "script.js", "—models-with-deps"];
    expect(normalizeProcessArgs()).toBe(true);
    expect(process.argv[2]).toBe("--models-with-deps");
  });

  it("replaces en dash with double hyphen", () => {
    process.argv = ["node", "script.js", "–sourceGuid"];
    expect(normalizeProcessArgs()).toBe(true);
    expect(process.argv[2]).toBe("--sourceGuid");
  });

  it("replaces left/right double curly quotes with straight quotes", () => {
    process.argv = ["node", "script.js", "“hello”"];
    expect(normalizeProcessArgs()).toBe(true);
    expect(process.argv[2]).toBe('"hello"');
  });

  it("replaces left/right single curly quotes with straight quotes", () => {
    process.argv = ["node", "script.js", "‘hello’"];
    expect(normalizeProcessArgs()).toBe(true);
    expect(process.argv[2]).toBe("'hello'");
  });

  it("does not touch argv[0] or argv[1] (node and script path)", () => {
    const nodeExe = "node";
    const scriptPath = "/usr/bin/script.js";
    process.argv = [nodeExe, scriptPath, "—flag"];
    normalizeProcessArgs();
    expect(process.argv[0]).toBe(nodeExe);
    expect(process.argv[1]).toBe(scriptPath);
  });

  it("normalizes multiple args in one pass", () => {
    process.argv = ["node", "script.js", "—sourceGuid", "“my-guid”"];
    expect(normalizeProcessArgs()).toBe(true);
    expect(process.argv[2]).toBe("--sourceGuid");
    expect(process.argv[3]).toBe('"my-guid"');
  });

  it("returns false when argv has only node and script (no user args)", () => {
    process.argv = ["node", "script.js"];
    expect(normalizeProcessArgs()).toBe(false);
  });
});

describe("normalizeArgv", () => {
  describe("null / undefined / primitives", () => {
    it("returns null unchanged", () => expect(normalizeArgv(null)).toBeNull());
    it("returns undefined unchanged", () => expect(normalizeArgv(undefined)).toBeUndefined());
    it("returns numbers unchanged", () => expect(normalizeArgv(42)).toBe(42));
    it("returns booleans unchanged", () => expect(normalizeArgv(true)).toBe(true));
  });

  describe("string normalization", () => {
    it("replaces em dash in string values", () => {
      expect(normalizeArgv("—flag")).toBe("--flag");
    });

    it("replaces en dash in string values", () => {
      expect(normalizeArgv("–flag")).toBe("--flag");
    });

    it("replaces curly double quotes", () => {
      expect(normalizeArgv("“hello”")).toBe("hello");
    });

    it("replaces curly single quotes", () => {
      expect(normalizeArgv("‘hello’")).toBe("hello");
    });

    it("strips leading/trailing straight quotes", () => {
      expect(normalizeArgv('"guid-value"')).toBe("guid-value");
      expect(normalizeArgv("'guid-value'")).toBe("guid-value");
    });

    it("leaves clean strings unchanged", () => {
      expect(normalizeArgv("abc-123")).toBe("abc-123");
    });

    it("leaves empty string unchanged", () => {
      expect(normalizeArgv("")).toBe("");
    });
  });

  describe("array handling", () => {
    it("normalizes each element in an array", () => {
      const input = ["—flag", "clean", "“quoted”"];
      expect(normalizeArgv(input)).toEqual(["--flag", "clean", "quoted"]);
    });

    it("leaves non-string array elements unchanged", () => {
      expect(normalizeArgv([1, true, null])).toEqual([1, true, null]);
    });

    it("returns empty array unchanged", () => {
      expect(normalizeArgv([])).toEqual([]);
    });
  });

  describe("object handling", () => {
    it("normalizes string values in a plain object", () => {
      const input = { sourceGuid: "“my-guid”", locale: "en-us" };
      expect(normalizeArgv(input)).toEqual({ sourceGuid: "my-guid", locale: "en-us" });
    });

    it("preserves _ and $0 keys unchanged", () => {
      const input = { _: [], $0: "agility", sourceGuid: "“my-guid”" };
      const result = normalizeArgv(input);
      expect(result._).toEqual([]);
      expect(result.$0).toBe("agility");
      expect(result.sourceGuid).toBe("my-guid");
    });

    it("normalizes nested string values recursively", () => {
      const input = { nested: { value: "—flag" } };
      expect(normalizeArgv(input)).toEqual({ nested: { value: "--flag" } });
    });

    it("normalizes string arrays within objects", () => {
      const input = { models: ["“model1”", "model2"] };
      expect(normalizeArgv(input)).toEqual({ models: ["model1", "model2"] });
    });

    it("leaves numeric and boolean object values unchanged", () => {
      const input = { count: 5, active: false };
      expect(normalizeArgv(input)).toEqual({ count: 5, active: false });
    });
  });
});
