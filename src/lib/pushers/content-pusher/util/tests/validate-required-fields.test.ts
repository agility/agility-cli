import {
  validateContentItemAgainstModel,
  parseDropdownChoices,
  formatMissingRequiredFields,
} from "../validate-required-fields";

// Field definitions shaped like real pulled models (settings values are strings).
function field(name: string, type: string, settings: Record<string, any> = {}): any {
  return { name, type, label: name, settings };
}

// PromoBanner (model 362), trimmed: the item that tripped "Column 'promoTitle' does not allow nulls."
const promoBanner = {
  referenceName: "PromoBanner",
  fields: [
    field("tab_General", "Tab"),
    field("enabled", "Boolean"),
    field("promoTitle", "Text", { Required: "True", Length: "" }),
    field("promoDescription", "HTML", { Required: "False" }),
    field("promoVisibility", "DropdownList", {
      Required: "True",
      Choices: "Static|static\nDynamic|dynamic\nNone|none",
    }),
    field("promoSubtitle", "Text", { Required: "True", Length: "" }),
    field("promoActionButton", "Link", { Required: "True" }),
    field("balanceThreshold", "Decimal", { Required: "True" }),
  ],
};

describe("validateContentItemAgainstModel — no model", () => {
  it("returns no issues when the model is null/undefined", () => {
    expect(validateContentItemAgainstModel({}, null)).toEqual({ missing: [], warnings: [] });
    expect(validateContentItemAgainstModel({}, undefined)).toEqual({ missing: [], warnings: [] });
  });

  it("returns no issues when the model has no fields", () => {
    expect(validateContentItemAgainstModel({}, { referenceName: "X" })).toEqual({ missing: [], warnings: [] });
    expect(validateContentItemAgainstModel({}, { referenceName: "X", fields: [] })).toEqual({
      missing: [],
      warnings: [],
    });
  });

  it("tolerates null/undefined fields", () => {
    const model = { fields: [field("title", "Text", { Required: "True" })] };
    expect(validateContentItemAgainstModel(null, model).missing).toEqual([{ name: "title", type: "Text" }]);
    expect(validateContentItemAgainstModel(undefined, model).missing).toEqual([{ name: "title", type: "Text" }]);
  });
});

describe("validateContentItemAgainstModel — required scalar fields", () => {
  it("fails the real item 12942 shape (only {enabled}) on every required scalar", () => {
    const result = validateContentItemAgainstModel({ enabled: "true" }, promoBanner);
    expect(result.missing).toEqual([
      { name: "promoTitle", type: "Text" },
      { name: "promoVisibility", type: "DropdownList" },
      { name: "promoSubtitle", type: "Text" },
      { name: "balanceThreshold", type: "Decimal" },
    ]);
    // Link is not confirmed to be rejected server-side — a warning, not a failure.
    expect(result.warnings).toEqual([expect.stringContaining("promoActionButton (Link)")]);
  });

  it("fails when the value is explicitly null", () => {
    const model = { fields: [field("title", "Text", { Required: "True" })] };
    expect(validateContentItemAgainstModel({ title: null }, model).missing).toHaveLength(1);
  });

  it.each(["Text", "LongText", "HTML", "Html", "Integer", "Decimal", "Date", "DropdownList", "Boolean"])(
    "treats %s as a scalar (missing → failure)",
    (type) => {
      const model = { fields: [field("f", type, { Required: "True" })] };
      const result = validateContentItemAgainstModel({}, model);
      expect(result.missing).toEqual([{ name: "f", type }]);
      expect(result.warnings).toHaveLength(0);
    }
  );

  it.each(["ImageAttachment", "FileAttachment", "PhotoGallery", "CustomField", "Content", "Link"])(
    "only warns for a missing required %s",
    (type) => {
      const model = { fields: [field("f", type, { Required: "True" })] };
      const result = validateContentItemAgainstModel({}, model);
      expect(result.missing).toHaveLength(0);
      expect(result.warnings).toEqual([`Required field f (${type}) has no value`]);
    }
  );

  it.each(["True", "true", "TRUE", " true "])("reads Required %p as required", (required) => {
    const model = { fields: [field("title", "Text", { Required: required })] };
    expect(validateContentItemAgainstModel({}, model).missing).toHaveLength(1);
  });

  it.each(["False", "false", "", undefined])("reads Required %p as not required", (required) => {
    const settings = required === undefined ? {} : { Required: required };
    const model = { fields: [field("title", "Text", settings)] };
    expect(validateContentItemAgainstModel({}, model)).toEqual({ missing: [], warnings: [] });
  });

  it("handles a field with no settings object", () => {
    const model = { fields: [{ name: "title", type: "Text" }] };
    expect(validateContentItemAgainstModel({}, model)).toEqual({ missing: [], warnings: [] });
  });

  it("matches item keys to model field names case-insensitively", () => {
    const model = {
      fields: [field("Title", "Text", { Required: "True" }), field("promoTitle", "Text", { Required: "True" })],
    };
    expect(validateContentItemAgainstModel({ title: "x", PROMOTITLE: "y" }, model).missing).toHaveLength(0);
  });

  it("accepts falsy-but-present scalar values (0, false)", () => {
    const model = {
      fields: [field("count", "Integer", { Required: "True" }), field("flag", "Boolean", { Required: "True" })],
    };
    expect(validateContentItemAgainstModel({ count: 0, flag: false }, model)).toEqual({ missing: [], warnings: [] });
  });

  it("skips Tab fields even if marked required", () => {
    const model = { fields: [field("tab_Main", "Tab", { Required: "True" })] };
    expect(validateContentItemAgainstModel({}, model)).toEqual({ missing: [], warnings: [] });
  });

  it("ignores malformed field definitions", () => {
    const model = { fields: [null, {}, { type: "Text" }, field("", "Text", { Required: "True" })] };
    expect(validateContentItemAgainstModel({}, model)).toEqual({ missing: [], warnings: [] });
  });
});

describe("validateContentItemAgainstModel — warnings (never failures)", () => {
  it("warns on an empty or whitespace-only required value", () => {
    const model = {
      fields: [field("title", "Text", { Required: "True" }), field("body", "LongText", { Required: "true" })],
    };
    const result = validateContentItemAgainstModel({ title: "", body: "   " }, model);
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toEqual([
      "Required field title (Text) is empty",
      "Required field body (LongText) is empty",
    ]);
  });

  it("warns when Text exceeds its Length", () => {
    const model = { fields: [field("title", "Text", { Length: "5" })] };
    const result = validateContentItemAgainstModel({ title: "toolong" }, model);
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toEqual(["Field title (Text) is 7 characters, over its Length of 5"]);
  });

  it.each(["", "0", undefined])("treats Length %p as unlimited", (length) => {
    const model = { fields: [field("title", "Text", { Length: length })] };
    expect(validateContentItemAgainstModel({ title: "x".repeat(5000) }, model).warnings).toHaveLength(0);
  });

  it("does not warn at exactly the Length", () => {
    const model = { fields: [field("title", "Text", { Length: "5" })] };
    expect(validateContentItemAgainstModel({ title: "12345" }, model).warnings).toHaveLength(0);
  });

  it("warns when a DropdownList value is not among its Choices", () => {
    const result = validateContentItemAgainstModel(
      {
        promoVisibility: "sometimes",
        promoTitle: "a",
        promoSubtitle: "b",
        balanceThreshold: 1,
        promoActionButton: "x",
      },
      promoBanner
    );
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toEqual([
      'Field promoVisibility (DropdownList) value "sometimes" is not one of its Choices',
    ]);
  });

  it("accepts a DropdownList value matching a choice value, case-insensitively", () => {
    const model = { fields: [field("vis", "DropdownList", { Choices: "Static|static\r\nDynamic|dynamic" })] };
    expect(validateContentItemAgainstModel({ vis: "Dynamic" }, model).warnings).toHaveLength(0);
  });

  it("does not check a DropdownList without Choices, or an empty optional value", () => {
    const model = {
      fields: [field("a", "DropdownList", { Choices: "" }), field("b", "DropdownList", { Choices: "x|x" })],
    };
    expect(validateContentItemAgainstModel({ a: "anything", b: "" }, model).warnings).toHaveLength(0);
  });

  it("leaves optional missing fields alone", () => {
    const model = { fields: [field("title", "Text", { Required: "False", Length: "3" })] };
    expect(validateContentItemAgainstModel({}, model)).toEqual({ missing: [], warnings: [] });
  });
});

describe("parseDropdownChoices", () => {
  it("parses the Label|value-per-line format from real models", () => {
    expect(parseDropdownChoices("Standard|standard\nExplicit|explicit\nImage Only|image_only")).toEqual([
      "standard",
      "explicit",
      "image_only",
    ]);
  });

  it("uses the whole line when there is no pipe, and drops blank lines", () => {
    expect(parseDropdownChoices("one\r\n\ntwo|2\n")).toEqual(["one", "2"]);
  });

  it("returns [] for non-strings and empty strings", () => {
    expect(parseDropdownChoices(undefined)).toEqual([]);
    expect(parseDropdownChoices("")).toEqual([]);
    expect(parseDropdownChoices(42)).toEqual([]);
  });
});

describe("formatMissingRequiredFields", () => {
  it("lists each field with its type", () => {
    expect(
      formatMissingRequiredFields("PromoBanner", [
        { name: "promoTitle", type: "Text" },
        { name: "promoSubtitle", type: "Text" },
      ])
    ).toBe("Missing required field(s) on model PromoBanner: promoTitle (Text), promoSubtitle (Text)");
  });
});
