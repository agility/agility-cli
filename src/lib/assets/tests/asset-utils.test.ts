import { resetState } from "core/state";
import { getAssetFilePath, extractFocalPointFromHeaders } from "lib/assets/asset-utils";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── getAssetFilePath ─────────────────────────────────────────────────────────

describe("getAssetFilePath", () => {
  describe("full URLs with /assets/ segment", () => {
    it("extracts the path after /assets/ from a cdn.agilitycms.com URL", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/folder/file.jpg");
      expect(result).toBe("folder/file.jpg");
    });

    it("extracts the path after /assets/ from an aglty.io URL", () => {
      const result = getAssetFilePath("https://cdn-usa2.aglty.io/guid/assets/images/hero.png");
      expect(result).toBe("images/hero.png");
    });

    it("extracts a deeply nested path after /assets/", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/2024/01/docs/report.pdf");
      expect(result).toBe("2024/01/docs/report.pdf");
    });

    it("strips query parameters from URLs with /assets/", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/image.jpg?w=800&h=600");
      expect(result).toBe("image.jpg");
    });

    it("handles a filename directly under /assets/ (no subdirectory)", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/logo.svg");
      expect(result).toBe("logo.svg");
    });
  });

  describe("path-style URLs (no scheme)", () => {
    it("removes the first segment (instance name) and returns the rest", () => {
      const result = getAssetFilePath("/instance-name/folder/file.jpg");
      expect(result).toBe("folder/file.jpg");
    });

    it("returns the filename when there is only one segment after the instance name", () => {
      const result = getAssetFilePath("/instance-name/file.jpg");
      expect(result).toBe("file.jpg");
    });

    it("strips query parameters from path-style URLs", () => {
      const result = getAssetFilePath("/instance-name/image.png?foo=bar");
      expect(result).toBe("image.png");
    });

    it("handles deeply nested path-style URLs", () => {
      const result = getAssetFilePath("/my-instance/a/b/c/file.txt");
      expect(result).toBe("a/b/c/file.txt");
    });
  });

  describe("URLs with spaces / encoded characters", () => {
    it("decodes percent-encoded characters in full URLs", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/my%20file.jpg");
      expect(result).toBe("my file.jpg");
    });

    it("handles spaces in full URL by encoding them before parsing", () => {
      const result = getAssetFilePath("https://cdn.agilitycms.com/guid/assets/my file.jpg");
      expect(result).toBe("my file.jpg");
    });
  });

  describe("edge / error cases", () => {
    it('returns "unknown-asset" for an empty string and logs a warning', () => {
      const warnSpy = jest.spyOn(console, "warn");
      const result = getAssetFilePath("");
      expect(result).toBe("unknown-asset");
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns "error-parsing-asset-path" for a non-URL, non-path string and logs an error', () => {
      const errorSpy = jest.spyOn(console, "error");
      const result = getAssetFilePath("not-a-url-or-path");
      expect(result).toBe("error-parsing-asset-path");
      expect(errorSpy).toHaveBeenCalled();
    });

    it("handles a path that is just a single slash (empty segments)", () => {
      const warnSpy = jest.spyOn(console, "warn");
      const result = getAssetFilePath("/");
      // path.split('/').filter(x => x !== '') yields [] — falls into warn + 'unknown-asset'
      expect(result).toBe("unknown-asset");
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("table-driven: known URL patterns", () => {
    it.each([
      ["https://cdn-eu.aglty.io/abc123/assets/photos/cat.jpg", "photos/cat.jpg"],
      ["https://origin.aglty.io/abc123/assets/videos/intro.mp4", "videos/intro.mp4"],
      ["/my-guid/subfolder/document.pdf", "subfolder/document.pdf"],
    ])("getAssetFilePath(%s) === %s", (input, expected) => {
      expect(getAssetFilePath(input)).toBe(expected);
    });
  });
});

// ─── extractFocalPointFromHeaders ─────────────────────────────────────────────

describe("extractFocalPointFromHeaders", () => {
  it("reads the CDN focal point headers (agility-focal-x/-y)", () => {
    const result = extractFocalPointFromHeaders({
      "agility-focal-x": "0.25",
      "agility-focal-y": "0.75",
    });
    expect(result).toEqual({ focalX: "0.25", focalY: "0.75" });
  });

  it("ignores blob/S3 object-metadata headers (only trusts the CDN headers)", () => {
    const result = extractFocalPointFromHeaders({
      "x-ms-meta-focalx": "10",
      "x-ms-meta-focaly": "20",
      "x-amz-meta-focalx": "5",
      "x-amz-meta-focaly": "6",
    });
    expect(result).toEqual({});
  });

  it("returns only the axis that is present", () => {
    const result = extractFocalPointFromHeaders({ "agility-focal-x": "0.4" });
    expect(result).toEqual({ focalX: "0.4" });
  });

  it("ignores blank / whitespace-only header values", () => {
    const result = extractFocalPointFromHeaders({ "agility-focal-x": "  ", "agility-focal-y": "" });
    expect(result).toEqual({});
  });

  it("trims surrounding whitespace from values", () => {
    const result = extractFocalPointFromHeaders({ "agility-focal-x": " 0.3 " });
    expect(result).toEqual({ focalX: "0.3" });
  });

  it("takes the first entry when a header arrives as an array", () => {
    const result = extractFocalPointFromHeaders({ "agility-focal-x": ["0.1", "0.9"] as any });
    expect(result).toEqual({ focalX: "0.1" });
  });

  it("returns an empty object when there are no focal headers", () => {
    expect(extractFocalPointFromHeaders({ "content-type": "image/png" })).toEqual({});
  });

  it("returns an empty object for undefined/null headers", () => {
    expect(extractFocalPointFromHeaders(undefined)).toEqual({});
    expect(extractFocalPointFromHeaders(null)).toEqual({});
  });
});
