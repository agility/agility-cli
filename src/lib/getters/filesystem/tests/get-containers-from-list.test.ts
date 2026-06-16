import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState } from "core/state";
import { getContainersFromFileSystem } from "../get-containers-from-list";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-test-get-containers-from-list-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper: build the expected list directory path for non-legacy mode
function listPath(root: string, guid: string, locale: string, isPreview: boolean): string {
  return path.join(root, guid, locale, isPreview ? "preview" : "live", "list");
}

function modelsPath(root: string, guid: string, locale: string, isPreview: boolean): string {
  return path.join(root, guid, locale, isPreview ? "preview" : "live", "models");
}

describe("getContainersFromFileSystem (from-list)", () => {
  describe("when list directory does not exist", () => {
    it("returns an empty array and warns", () => {
      const root = path.join(tmpDir, "no-list-dir");
      fs.mkdirSync(root, { recursive: true });

      const result = getContainersFromFileSystem("g-001", "en-us", false, root);

      expect(result).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("List directory not found"));
    });
  });

  describe("when list directory exists but is empty", () => {
    it("returns an empty array", () => {
      const root = path.join(tmpDir, "empty-list");
      const lp = listPath(root, "g-002", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      const result = getContainersFromFileSystem("g-002", "en-us", false, root);

      expect(result).toEqual([]);
    });
  });

  describe("with valid list files", () => {
    it("builds a container from a list file with items that have properties", () => {
      const root = path.join(tmpDir, "valid-list");
      const lp = listPath(root, "g-003", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      const contentList = [
        {
          contentID: 1,
          properties: {
            referenceName: "blogposts",
            definitionName: "BlogPost",
            state: 1,
          },
        },
        {
          contentID: 2,
          properties: {
            referenceName: "blogposts",
            definitionName: "BlogPost",
            state: 1,
          },
        },
      ];
      fs.writeFileSync(path.join(lp, "blogposts.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-003", "en-us", false, root);

      expect(result).toHaveLength(1);
      const container = result[0] as any;
      expect(container.referenceName).toBe("blogposts");
      expect(container.contentCount).toBe(2);
    });

    it("assigns a unique contentViewID for each container", () => {
      const root = path.join(tmpDir, "unique-ids");
      const lp = listPath(root, "g-004", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      const makeList = (refName: string) => [
        { contentID: 1, properties: { referenceName: refName, definitionName: refName, state: 1 } },
      ];
      fs.writeFileSync(path.join(lp, "a.json"), JSON.stringify(makeList("aList")));
      fs.writeFileSync(path.join(lp, "b.json"), JSON.stringify(makeList("bList")));

      const result = getContainersFromFileSystem("g-004", "en-us", false, root);

      expect(result).toHaveLength(2);
      const ids = result.map((c: any) => c.contentViewID);
      expect(new Set(ids).size).toBe(2);
    });

    it("resolves contentDefinitionID from matching model referenceName", () => {
      const root = path.join(tmpDir, "with-models");
      const lp = listPath(root, "g-005", "en-us", false);
      const mp = modelsPath(root, "g-005", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });
      fs.mkdirSync(mp, { recursive: true });

      const model = { id: 42, referenceName: "NewsPost" };
      fs.writeFileSync(path.join(mp, "42.json"), JSON.stringify(model));

      const contentList = [
        { contentID: 1, properties: { referenceName: "news", definitionName: "NewsPost", state: 1 } },
      ];
      fs.writeFileSync(path.join(lp, "news.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-005", "en-us", false, root);

      expect(result).toHaveLength(1);
      expect((result[0] as any).contentDefinitionID).toBe(42);
    });

    it("sets contentDefinitionID to null when no matching model is found", () => {
      const root = path.join(tmpDir, "no-matching-model");
      const lp = listPath(root, "g-006", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      const contentList = [
        { contentID: 1, properties: { referenceName: "events", definitionName: "Event", state: 1 } },
      ];
      fs.writeFileSync(path.join(lp, "events.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-006", "en-us", false, root);

      expect(result).toHaveLength(1);
      expect((result[0] as any).contentDefinitionID).toBeNull();
    });

    it("skips list files that contain non-array or empty data", () => {
      const root = path.join(tmpDir, "skip-bad-files");
      const lp = listPath(root, "g-007", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      // Empty array - should be skipped
      fs.writeFileSync(path.join(lp, "empty.json"), JSON.stringify([]));
      // Valid content
      const contentList = [{ contentID: 1, properties: { referenceName: "valid", definitionName: "Valid", state: 1 } }];
      fs.writeFileSync(path.join(lp, "valid.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-007", "en-us", false, root);

      expect(result).toHaveLength(1);
      expect((result[0] as any).referenceName).toBe("valid");
    });

    it("skips list items that lack a properties object", () => {
      const root = path.join(tmpDir, "skip-no-properties");
      const lp = listPath(root, "g-008", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      // First item has no properties → firstItem.properties is falsy → skip
      const contentList = [{ contentID: 1, title: "no props here" }];
      fs.writeFileSync(path.join(lp, "noprops.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-008", "en-us", false, root);

      expect(result).toHaveLength(0);
    });

    it("warns and skips malformed JSON files", () => {
      const root = path.join(tmpDir, "malformed-json");
      const lp = listPath(root, "g-009", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      fs.writeFileSync(path.join(lp, "bad.json"), "NOT VALID JSON {{{}");
      // Also add a valid file
      const contentList = [{ contentID: 1, properties: { referenceName: "good", definitionName: "Good", state: 1 } }];
      fs.writeFileSync(path.join(lp, "good.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-009", "en-us", false, root);

      // The bad file is skipped with a warning; the good file is processed
      expect(result).toHaveLength(1);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Error processing list file bad.json"));
    });
  });

  describe("preview vs live mode", () => {
    it("reads from preview sub-directory when isPreview is true", () => {
      const root = path.join(tmpDir, "preview-mode");
      const lp = listPath(root, "g-012", "en-us", true);
      fs.mkdirSync(lp, { recursive: true });

      const contentList = [
        { contentID: 1, properties: { referenceName: "previewItem", definitionName: "Model", state: 1 } },
      ];
      fs.writeFileSync(path.join(lp, "previewItem.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-012", "en-us", true, root);

      expect(result).toHaveLength(1);
    });

    it("reads from live sub-directory when isPreview is false", () => {
      const root = path.join(tmpDir, "live-mode");
      const lp = listPath(root, "g-013", "en-us", false);
      fs.mkdirSync(lp, { recursive: true });

      const contentList = [
        { contentID: 1, properties: { referenceName: "liveItem", definitionName: "Model", state: 1 } },
      ];
      fs.writeFileSync(path.join(lp, "liveItem.json"), JSON.stringify(contentList));

      const result = getContainersFromFileSystem("g-013", "en-us", false, root);

      expect(result).toHaveLength(1);
    });
  });

  describe("default rootPath", () => {
    it("uses agility-files as default when rootPath is not provided", () => {
      // The function will warn that the list path doesn't exist,
      // which is correct because agility-files won't exist in the test environment.
      const result = getContainersFromFileSystem("g-014", "en-us", false);
      expect(result).toEqual([]);
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
