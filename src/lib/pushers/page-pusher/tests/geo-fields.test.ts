import { getGeoValidationError, withoutGeoFields, geoNotCopiedMessage } from "../geo-fields";

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
