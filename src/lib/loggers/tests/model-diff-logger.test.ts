import { resetState } from "core/state";
import { logModelDifferences, logFieldArrayDifferences } from "lib/loggers/model-diff-logger";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeField(name: string, label: string, type: string, settings: Record<string, string> = {}): any {
  return { name, label, type, settings };
}

// ─── logModelDifferences ──────────────────────────────────────────────────────

describe("logModelDifferences", () => {
  describe("identical objects", () => {
    it("logs the diff header but no property lines when source and target are equal", () => {
      logModelDifferences({ title: "Hello" }, { title: "Hello" }, "BlogPost");
      // Only the header line should have been logged (no diff lines)
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    it("does not throw for empty objects", () => {
      expect(() => logModelDifferences({}, {}, "Empty")).not.toThrow();
    });
  });

  describe("source-only keys", () => {
    it("logs a source-only line for a key present in source but not target", () => {
      logModelDifferences({ extra: "data" }, {}, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const sourceOnlyLine = calls.find((msg: string) => msg.includes("Source only"));
      expect(sourceOnlyLine).toBeDefined();
      expect(sourceOnlyLine).toContain("extra");
    });

    it("logs source-only lines for multiple missing target keys", () => {
      logModelDifferences({ a: 1, b: 2 }, {}, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const sourceOnlyLines = calls.filter((msg: string) => msg.includes("Source only"));
      expect(sourceOnlyLines).toHaveLength(2);
    });
  });

  describe("target-only keys", () => {
    it("logs a target-only line for a key present in target but not source", () => {
      logModelDifferences({}, { obsolete: "value" }, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const targetOnlyLine = calls.find((msg: string) => msg.includes("Target only"));
      expect(targetOnlyLine).toBeDefined();
      expect(targetOnlyLine).toContain("obsolete");
    });
  });

  describe("different scalar values", () => {
    it("logs a different line and both source/target values for changed scalar", () => {
      logModelDifferences({ count: 1 }, { count: 2 }, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const differentLine = calls.find((msg: string) => msg.includes("Different"));
      expect(differentLine).toBeDefined();
      expect(differentLine).toContain("count");
      const sourceLine = calls.find((msg: string) => msg.includes("Source Value") && msg.includes("1"));
      expect(sourceLine).toBeDefined();
      const targetLine = calls.find((msg: string) => msg.includes("Target Value") && msg.includes("2"));
      expect(targetLine).toBeDefined();
    });

    it("includes the model name in the header line", () => {
      logModelDifferences({ x: 1 }, { x: 2 }, "MySpecialModel");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      expect(calls[0]).toContain("MySpecialModel");
    });
  });

  describe("different nested object values", () => {
    it("logs source and target values for differing nested objects", () => {
      const source = { meta: { version: 1 } };
      const target = { meta: { version: 2 } };
      logModelDifferences(source, target, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const sourceLine = calls.find((msg: string) => msg.includes("Source Value"));
      const targetLine = calls.find((msg: string) => msg.includes("Target Value"));
      expect(sourceLine).toBeDefined();
      expect(targetLine).toBeDefined();
    });
  });

  describe("fields key delegates to logFieldArrayDifferences", () => {
    it("does not throw when fields arrays differ", () => {
      const source = { fields: [makeField("Title", "Title", "Text")] };
      const target = { fields: [makeField("Body", "Body", "HTML")] };
      expect(() => logModelDifferences(source, target, "Model")).not.toThrow();
    });

    it("logs source/target field-level differences when fields arrays differ", () => {
      const source = { fields: [makeField("Title", "Title", "Text")] };
      const target = { fields: [makeField("Title", "Heading", "Text")] };
      logModelDifferences(source, target, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      // logFieldArrayDifferences emits a "differs" line for the shared field
      const fieldDiffLine = calls.find((msg: string) => msg.includes("differs") || msg.includes("Label"));
      expect(fieldDiffLine).toBeDefined();
    });

    it("treats fields key as plain objects (not arrays) and logs nested diff", () => {
      // When fields is not an array, the nested-object branch applies
      const source = { fields: { custom: true } };
      const target = { fields: { custom: false } };
      logModelDifferences(source, target, "Model");
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const sourceLine = calls.find((msg: string) => msg.includes("Source Value"));
      expect(sourceLine).toBeDefined();
    });
  });

  describe("mixed keys", () => {
    it("handles a mix of equal, source-only, target-only, and different keys", () => {
      const source = { same: "x", srcOnly: 1, changed: "old" };
      const target = { same: "x", tgtOnly: 2, changed: "new" };
      expect(() => logModelDifferences(source, target, "Mixed")).not.toThrow();
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const sourceOnlyLine = calls.find((msg: string) => msg.includes("Source only"));
      const targetOnlyLine = calls.find((msg: string) => msg.includes("Target only"));
      const differentLine = calls.find((msg: string) => msg.includes("Different"));
      expect(sourceOnlyLine).toBeDefined();
      expect(targetOnlyLine).toBeDefined();
      expect(differentLine).toBeDefined();
    });
  });
});

// ─── logFieldArrayDifferences ─────────────────────────────────────────────────

describe("logFieldArrayDifferences", () => {
  describe("empty arrays", () => {
    it("does not throw and logs nothing extra for two empty arrays", () => {
      logFieldArrayDifferences([], []);
      // console.log is not called (no differences found)
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("source-only fields", () => {
    it("logs a source-only field line for a field not present in target", () => {
      const sourceFields = [makeField("NewField", "New Field", "Text")];
      logFieldArrayDifferences(sourceFields, []);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const line = calls.find((msg: string) => msg.includes("Source Field only"));
      expect(line).toBeDefined();
      expect(line).toContain("NewField");
    });

    it("includes the field type in the source-only log line", () => {
      const sourceFields = [makeField("ImageField", "Image", "Image")];
      logFieldArrayDifferences(sourceFields, []);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const line = calls.find((msg: string) => msg.includes("Source Field only"));
      expect(line).toContain("Image");
    });

    it("logs multiple source-only field lines when several are absent from target", () => {
      const sourceFields = [makeField("Field1", "F1", "Text"), makeField("Field2", "F2", "HTML")];
      logFieldArrayDifferences(sourceFields, []);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const lines = calls.filter((msg: string) => msg.includes("Source Field only"));
      expect(lines).toHaveLength(2);
    });
  });

  describe("target-only fields", () => {
    it("logs a target-only field line for a field not present in source", () => {
      const targetFields = [makeField("OldField", "Old Field", "Text")];
      logFieldArrayDifferences([], targetFields);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const line = calls.find((msg: string) => msg.includes("Target Field only"));
      expect(line).toBeDefined();
      expect(line).toContain("OldField");
    });

    it("includes the field type in the target-only log line", () => {
      const targetFields = [makeField("VideoField", "Video", "CustomField")];
      logFieldArrayDifferences([], targetFields);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const line = calls.find((msg: string) => msg.includes("Target Field only"));
      expect(line).toContain("CustomField");
    });
  });

  describe("shared fields with no differences", () => {
    it("does not log a diff line when shared fields are identical", () => {
      const field = makeField("Title", "Title", "Text", { Required: "true" });
      logFieldArrayDifferences([field], [field]);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const diffLine = calls.find((msg: string) => msg.includes("differs"));
      expect(diffLine).toBeUndefined();
    });
  });

  describe("shared fields with label differences", () => {
    it("logs a field-differs line when labels differ", () => {
      const src = makeField("Title", "Title", "Text");
      const tgt = makeField("Title", "Heading", "Text");
      logFieldArrayDifferences([src], [tgt]);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const diffHeader = calls.find((msg: string) => msg.includes("differs"));
      expect(diffHeader).toBeDefined();
      const labelLine = calls.find((msg: string) => msg.includes("Label"));
      expect(labelLine).toBeDefined();
      expect(labelLine).toContain("Title");
      expect(labelLine).toContain("Heading");
    });
  });

  describe("shared fields with type differences", () => {
    it("logs a type diff line when field types differ", () => {
      const src = makeField("Body", "Body", "Text");
      const tgt = makeField("Body", "Body", "HTML");
      logFieldArrayDifferences([src], [tgt]);
      // The type info is emitted on a plain (un-coloured) message line
      const allArgs = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      // The header line contains "differs" and the detail line contains both type values
      const diffHeader = allArgs.find((msg: string) => msg.includes("differs"));
      expect(diffHeader).toBeDefined();
      const typeLine = allArgs.find(
        (msg: string) => msg.includes("Type") && msg.includes("Text") && msg.includes("HTML")
      );
      expect(typeLine).toBeDefined();
    });
  });

  describe("shared fields with settings differences", () => {
    it("logs a settings diff line when field settings differ", () => {
      const src = makeField("Ref", "Ref", "Content", { ContentDefinition: "Blog" });
      const tgt = makeField("Ref", "Ref", "Content", { ContentDefinition: "News" });
      logFieldArrayDifferences([src], [tgt]);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const settingsLine = calls.find((msg: string) => msg.includes("Settings"));
      expect(settingsLine).toBeDefined();
      expect(settingsLine).toContain("Blog");
      expect(settingsLine).toContain("News");
    });

    it("does not log a settings diff line when settings are deeply equal", () => {
      const settings = { Required: "true", MaxLength: "255" };
      const src = makeField("Title", "Title", "Text", settings);
      const tgt = makeField("Title", "Title", "Text", { ...settings });
      logFieldArrayDifferences([src], [tgt]);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const settingsLine = calls.find((msg: string) => msg.includes("Settings"));
      expect(settingsLine).toBeUndefined();
    });
  });

  describe("shared fields with multiple differences", () => {
    it("logs all differing properties for a single shared field", () => {
      const src = makeField("Item", "Item Label", "Text", { Required: "true" });
      const tgt = makeField("Item", "Item Heading", "HTML", { Required: "false" });
      logFieldArrayDifferences([src], [tgt]);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const labelLine = calls.find((msg: string) => msg.includes("Label"));
      const typeLine = calls.find((msg: string) => msg.includes("Type"));
      const settingsLine = calls.find((msg: string) => msg.includes("Settings"));
      expect(labelLine).toBeDefined();
      expect(typeLine).toBeDefined();
      expect(settingsLine).toBeDefined();
    });
  });

  describe("mixed field arrays", () => {
    it("handles source-only, target-only, matching, and differing fields together", () => {
      const srcFields = [
        makeField("Title", "Title", "Text"),
        makeField("NewSrc", "New", "Text"),
        makeField("Shared", "Same", "Text"),
      ];
      const tgtFields = [
        makeField("Title", "Title Changed", "Text"),
        makeField("OldTgt", "Old", "HTML"),
        makeField("Shared", "Same", "Text"),
      ];
      expect(() => logFieldArrayDifferences(srcFields, tgtFields)).not.toThrow();
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      expect(calls.find((msg: string) => msg.includes("Source Field only") && msg.includes("NewSrc"))).toBeDefined();
      expect(calls.find((msg: string) => msg.includes("Target Field only") && msg.includes("OldTgt"))).toBeDefined();
      expect(calls.find((msg: string) => msg.includes("differs") && msg.includes("Title"))).toBeDefined();
    });

    it("does not emit a diff line for a field present in both with identical properties", () => {
      const field = makeField("Stable", "Stable", "Text");
      const srcFields = [field, makeField("Changed", "Old", "Text")];
      const tgtFields = [field, makeField("Changed", "New", "Text")];
      logFieldArrayDifferences(srcFields, tgtFields);
      const calls = (console.log as jest.Mock).mock.calls.map((c) => c[0]);
      const stableDiffLine = calls.find((msg: string) => msg.includes("differs") && msg.includes("Stable"));
      expect(stableDiffLine).toBeUndefined();
    });
  });

  describe("table-driven: source/target combinations", () => {
    it.each([
      ["only source fields", [makeField("A", "A", "Text")], [], "Source Field only"],
      ["only target fields", [], [makeField("B", "B", "Text")], "Target Field only"],
    ])("%s produces the expected log message", (_label, src, tgt, expected) => {
      logFieldArrayDifferences(src, tgt);
      const calls = (console.log as jest.Mock).mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some((msg) => msg.includes(expected))).toBe(true);
    });
  });
});
