import {
  getGeoValidationError,
  getItemGeoValidationErrors,
  withoutGeoFields,
  geoNotCopiedMessage,
} from "../geo-fields";

// @agility/management-sdk wraps the AxiosError in its own Exception (`innerError`).
function sdkError(status: number, data: any): any {
  return { message: "Unable to create page.", innerError: { response: { status, data } } };
}

describe("getGeoValidationError (PROD-2729)", () => {
  it("reads the Management API's own 400 (exceptionMessage with field paths)", () => {
    const result = getGeoValidationError(
      sdkError(400, {
        statusCode: 400,
        exceptionMessage:
          "geo.schemaType: must be one of WebPage, AboutPage (was 'Article'). geo.structuredData: must be a JSON object or array.",
        additionalParameters: null,
      })
    );
    expect(result).toEqual({
      message: expect.stringContaining("geo.schemaType"),
      strip: ["geo"],
      structuredDataOnly: false,
    });
  });

  it("flags a structuredData-only rejection", () => {
    const result = getGeoValidationError(
      sdkError(400, { exceptionMessage: "geo.structuredData: is not valid JSON (bad token)." })
    );
    expect(result?.structuredDataOnly).toBe(true);
    expect(result?.strip).toEqual(["geo"]);
  });

  it("maps GEO seo keys to their own strip entries, and ignores older seo keys", () => {
    const result = getGeoValidationError(
      sdkError(400, {
        exceptionMessage:
          "seo.title: must be at most 300 characters (was 412). seo.ogImage: must be an absolute http or https URL, or a path starting with '/'. geo.ai.crawl: must be one of inherit, block (was 'x').",
      })
    );
    expect(result?.strip).toEqual(["seo.title", "seo.ogImage", "geo"]);
  });

  it("reads an ASP.NET model-binding 400 (errors keyed by JSON path)", () => {
    const result = getGeoValidationError(
      sdkError(400, {
        title: "One or more validation errors occurred.",
        status: 400,
        errors: { "$.geo.schemaType": ["The JSON value could not be converted to System.String."] },
      })
    );
    expect(result?.strip).toEqual(["geo"]);
  });

  it("also accepts an AxiosError thrown directly", () => {
    const result = getGeoValidationError({
      response: { status: 400, data: "geo.summary: must be at most 2000 characters (was 2400)." },
    });
    expect(result?.strip).toEqual(["geo"]);
  });

  it("returns undefined for a 400 that doesn't name a GEO field", () => {
    expect(
      getGeoValidationError(sdkError(400, { exceptionMessage: "seo.metaDescription: too long." }))
    ).toBeUndefined();
    expect(getGeoValidationError(sdkError(400, { exceptionMessage: "Invalid page name." }))).toBeUndefined();
  });

  it("returns undefined for other statuses and plain errors", () => {
    expect(getGeoValidationError(sdkError(500, { exceptionMessage: "geo.summary: boom" }))).toBeUndefined();
    expect(getGeoValidationError(new Error("geo.summary: network"))).toBeUndefined();
    expect(getGeoValidationError(undefined)).toBeUndefined();
  });
});

describe("withoutGeoFields (PROD-2729)", () => {
  const payload = {
    pageID: 5,
    seo: { metaDescription: "d", title: "t", canonicalUrl: "/c", robots: { index: true, follow: true } },
    geo: { schemaType: "WebPage" },
  };

  it("deletes the named keys instead of nulling them, without mutating the input", () => {
    const result = withoutGeoFields(payload, ["geo", "seo.title"]);
    expect(result).not.toHaveProperty("geo");
    expect(result.seo).toEqual({ metaDescription: "d", canonicalUrl: "/c", robots: { index: true, follow: true } });
    expect(payload.geo).toEqual({ schemaType: "WebPage" });
    expect(payload.seo.title).toBe("t");
  });

  it("copes with a payload that has no seo", () => {
    expect(withoutGeoFields({ pageID: 1 } as any, ["seo.title"])).toEqual({ pageID: 1 });
  });
});

describe("geoNotCopiedMessage (PROD-2729)", () => {
  it("names the reason, what was left out, and the API's message", () => {
    const message = geoNotCopiedMessage({
      message: "geo.structuredData: is not valid JSON.",
      strip: ["geo"],
      structuredDataOnly: true,
    });
    expect(message).toMatch(/^GEO not copied: invalid structured data/);
    expect(message).toContain("geo left out");
    expect(message).toContain("geo.structuredData: is not valid JSON.");
  });
});

describe("getItemGeoValidationErrors (PROD-2729, content items)", () => {
  it("attributes each items[i] path to its item", () => {
    const result = getItemGeoValidationErrors(
      sdkError(400, {
        exceptionMessage:
          "items[0].geo.schemaType: must be one of WebPage, AboutPage (was 'Article'). items[2].geo.structuredData: is not valid JSON. items[2].seo.ogImage: must be an absolute URL.",
      }),
      3
    )!;
    expect(Array.from(result.keys())).toEqual([0, 2]);
    expect(result.get(0)).toEqual({
      message: expect.stringContaining("items[0].geo.schemaType"),
      strip: ["geo"],
      structuredDataOnly: false,
    });
    expect(result.get(2)!.strip).toEqual(["geo", "seo.ogImage"]);
    expect(result.get(2)!.message).not.toContain("items[0]");
    expect(result.get(2)!.structuredDataOnly).toBe(false);
  });

  it("reads ASP.NET model-binding paths ($[i].geo...)", () => {
    const result = getItemGeoValidationErrors(
      sdkError(400, { status: 400, errors: { "$[1].geo.ai.crawl": ["The JSON value could not be converted."] } }),
      2
    )!;
    expect(Array.from(result.keys())).toEqual([1]);
    expect(result.get(1)!.strip).toEqual(["geo"]);
  });

  it("attributes an unprefixed error to the only item of a single-item save", () => {
    const result = getItemGeoValidationErrors(
      sdkError(400, { exceptionMessage: "geo.structuredData: is not valid JSON." }),
      1
    )!;
    expect(result.get(0)).toEqual(expect.objectContaining({ strip: ["geo"], structuredDataOnly: true }));
  });

  it("attributes an unprefixed error to every item of a multi-item save", () => {
    const result = getItemGeoValidationErrors(sdkError(400, { exceptionMessage: "geo.summary: is too long." }), 3)!;
    expect(Array.from(result.keys())).toEqual([0, 1, 2]);
  });

  it("ignores indexes outside the batch, non-GEO 400s and other statuses", () => {
    expect(
      getItemGeoValidationErrors(sdkError(400, { exceptionMessage: "items[0].fields.title: is required." }), 1)
    ).toBeUndefined();
    expect(
      getItemGeoValidationErrors(sdkError(500, { exceptionMessage: "items[0].geo.summary: boom" }), 1)
    ).toBeUndefined();
    const out = getItemGeoValidationErrors(
      sdkError(400, { exceptionMessage: "items[5].geo.summary: is too long." }),
      2
    )!;
    // No index in range, so it falls back to every item (stripping only ever keeps the target's values).
    expect(Array.from(out.keys())).toEqual([0, 1]);
  });
});
