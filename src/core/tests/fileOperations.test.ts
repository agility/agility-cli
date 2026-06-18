import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileOperations } from "../fileOperations";
import { resetState, setState } from "../state";
import { preflightReport } from "../../lib/preflight/preflight-report";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-cli-tests-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  preflightReport.reset();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Constructor / getters ────────────────────────────────────────────────────

describe("constructor and path getters", () => {
  it("instancePath includes guid and locale in normal mode", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.instancePath).toBe(path.join(tmpDir, "my-guid", "en-us"));
  });

  it("instancePath is guid-level when no locale is provided", () => {
    const ops = new fileOperations("my-guid");
    expect(ops.instancePath).toBe(path.join(tmpDir, "my-guid"));
  });

  it("mappingsPath is under root/guid/mappings", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.mappingsPath).toBe(path.join(tmpDir, "my-guid", "mappings"));
  });

  it("exposes guid and locale getters", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.guid).toBe("my-guid");
    expect(ops.locale).toBe("en-us");
  });
});

// ─── Path utility methods ─────────────────────────────────────────────────────

describe("getFilePath / getDataFilePath", () => {
  it("returns basePath when both args are omitted", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.getFilePath()).toBe(ops.instancePath);
  });

  it("appends folderName when only folder is given", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.getFilePath("models")).toBe(path.join(ops.instancePath, "models"));
  });

  it("appends both folder and file", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.getFilePath("models", "123.json")).toBe(path.join(ops.instancePath, "models", "123.json"));
  });

  it("appends only file when folder is omitted", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.getFilePath(undefined, "myfile.json")).toBe(path.join(ops.instancePath, "myfile.json"));
  });
});

describe("getMappingFilePath", () => {
  it("builds the central mapping path", () => {
    const ops = new fileOperations("src-guid", "en-us");
    const result = ops.getMappingFilePath("src-guid", "tgt-guid", "en-us");
    expect(result).toBe(path.join(tmpDir, "mappings", "src-guid-tgt-guid", "en-us"));
  });

  it("uses empty locale segment when locale is null", () => {
    const ops = new fileOperations("src-guid");
    const result = ops.getMappingFilePath("src-guid", "tgt-guid", null);
    expect(result).toBe(path.join(tmpDir, "mappings", "src-guid-tgt-guid", ""));
  });
});

describe("getNestedSitemapPath", () => {
  it("returns correct path", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.getNestedSitemapPath()).toBe(path.join(ops.instancePath, "nestedsitemap", "website.json"));
  });
});

// ─── checkFileExists / checkBaseFolderExists ──────────────────────────────────

describe("checkFileExists", () => {
  it("returns true for an existing file", () => {
    const filePath = path.join(tmpDir, "existing.txt");
    fs.writeFileSync(filePath, "hello");
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.checkFileExists(filePath)).toBe(true);
  });

  it("returns false for a non-existent file", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.checkFileExists(path.join(tmpDir, "no-such-file.txt"))).toBe(false);
  });
});

describe("checkBaseFolderExists", () => {
  it("returns true for a folder that exists", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.checkBaseFolderExists(tmpDir)).toBe(true);
  });

  it("returns false for a folder that does not exist", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.checkBaseFolderExists(path.join(tmpDir, "nope"))).toBe(false);
  });
});

// ─── exportFiles ──────────────────────────────────────────────────────────────

describe("exportFiles", () => {
  it("creates directory and writes a JSON file", () => {
    const ops = new fileOperations("my-guid", "en-us");
    const folder = "models";
    const payload = { id: 1, name: "TestModel" };

    ops.exportFiles(folder, 42, payload);

    const expectedPath = path.join(ops.instancePath, folder, "42.json");
    expect(fs.existsSync(expectedPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    expect(content).toEqual(payload);
  });

  it("uses baseFolder override when provided", () => {
    const ops = new fileOperations("my-guid", "en-us");
    const baseFolder = path.join(tmpDir, "custom-base");
    const payload = { hello: "world" };

    ops.exportFiles("subfolder", "testfile", payload, baseFolder);

    const expectedPath = path.join(baseFolder, "subfolder", "testfile.json");
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("strips non-serializable HTTPS agent properties", () => {
    const ops = new fileOperations("my-guid", "en-us");
    const payload = {
      name: "safe",
      agent: { _events: {}, sockets: {} },
    };

    ops.exportFiles("safe-test", "item", payload);

    const written = JSON.parse(fs.readFileSync(path.join(ops.instancePath, "safe-test", "item.json"), "utf8"));
    expect(written.name).toBe("safe");
    expect(written.agent).toBeUndefined();
  });
});

// ─── readJsonFileAbsolute ──────────────────────────────────────────────────────

describe("readJsonFileAbsolute", () => {
  it("reads and parses a valid JSON file", () => {
    const filePath = path.join(tmpDir, "test-data.json");
    fs.writeFileSync(filePath, JSON.stringify({ key: "value" }));
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.readJsonFileAbsolute(filePath)).toEqual({ key: "value" });
  });

  it("returns null for a missing file", () => {
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.readJsonFileAbsolute(path.join(tmpDir, "missing.json"))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not json");
    const ops = new fileOperations("my-guid", "en-us");
    expect(ops.readJsonFileAbsolute(filePath)).toBeNull();
  });
});

// ─── readJsonFilesFromFolder ───────────────────────────────────────────────────

describe("readJsonFilesFromFolder", () => {
  it("reads all JSON files from a folder", () => {
    const folder = path.join(tmpDir, "json-folder");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "1.json"), JSON.stringify({ id: 1 }));
    fs.writeFileSync(path.join(folder, "2.json"), JSON.stringify({ id: 2 }));
    fs.writeFileSync(path.join(folder, "other.txt"), "ignore me");

    // We need basePath to match folder, so use a guid-level fileOperations
    // and pass the full absolute folder to getDataFolderPath via relative sub-path
    // Easiest: instantiate with guid=folder parent, locale='', then call the method
    // with a sub-path. Instead, let's just write to the instancePath.
    const guidDir = path.join(tmpDir, "rf-guid", "en-us");
    fs.mkdirSync(path.join(guidDir, "items"), { recursive: true });
    fs.writeFileSync(path.join(guidDir, "items", "a.json"), JSON.stringify({ id: "a" }));
    fs.writeFileSync(path.join(guidDir, "items", "b.json"), JSON.stringify({ id: "b" }));

    const ops = new fileOperations("rf-guid", "en-us");
    const results = ops.readJsonFilesFromFolder("items");
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty array when folder does not exist", () => {
    const ops = new fileOperations("no-guid", "en-us");
    expect(ops.readJsonFilesFromFolder("nonexistent")).toEqual([]);
  });
});

// ─── listFilesInFolder ────────────────────────────────────────────────────────

describe("listFilesInFolder", () => {
  it("lists all files in a folder", () => {
    const guidDir = path.join(tmpDir, "list-guid", "en-us", "list-test");
    fs.mkdirSync(guidDir, { recursive: true });
    fs.writeFileSync(path.join(guidDir, "a.json"), "{}");
    fs.writeFileSync(path.join(guidDir, "b.json"), "{}");

    const ops = new fileOperations("list-guid", "en-us");
    const files = ops.listFilesInFolder("list-test");
    expect(files.sort()).toEqual(["a.json", "b.json"]);
  });

  it("filters by extension when provided", () => {
    const guidDir = path.join(tmpDir, "ext-guid", "en-us", "ext-test");
    fs.mkdirSync(guidDir, { recursive: true });
    fs.writeFileSync(path.join(guidDir, "a.json"), "{}");
    fs.writeFileSync(path.join(guidDir, "b.txt"), "text");

    const ops = new fileOperations("ext-guid", "en-us");
    const files = ops.listFilesInFolder("ext-test", ".json");
    expect(files).toEqual(["a.json"]);
  });

  it("returns empty array for missing folder", () => {
    const ops = new fileOperations("no-guid", "en-us");
    expect(ops.listFilesInFolder("nope")).toEqual([]);
  });
});

// ─── saveMappingFile / getMappingFile ─────────────────────────────────────────

describe("saveMappingFile / getMappingFile", () => {
  it("saves and reads back mapping data", () => {
    const ops = new fileOperations("s-guid", "en-us");
    const mappingData = [{ sourceID: 1, targetID: 100 }];

    ops.saveMappingFile(mappingData, "content", "s-guid", "t-guid", "en-us");

    const result = ops.getMappingFile("content", "s-guid", "t-guid", "en-us");
    expect(result).toEqual(mappingData);
  });

  it("returns empty array when mapping folder does not exist", () => {
    const ops = new fileOperations("s-guid", "en-us");
    const result = ops.getMappingFile("content", "nope1", "nope2", "en-us");
    expect(result).toEqual([]);
  });
});

// ─── fileExists / cliFolderExists ─────────────────────────────────────────────

describe("fileExists", () => {
  it("returns true for an existing file", () => {
    const filePath = path.join(tmpDir, "fe-test.txt");
    fs.writeFileSync(filePath, "hi");
    const ops = new fileOperations("g", "en-us");
    expect(ops.fileExists(filePath)).toBe(true);
  });

  it("returns false for a missing file", () => {
    const ops = new fileOperations("g", "en-us");
    expect(ops.fileExists(path.join(tmpDir, "nope.txt"))).toBe(false);
  });
});

describe("cliFolderExists", () => {
  it("returns true when instancePath exists", () => {
    const guidDir = path.join(tmpDir, "cf-guid", "en-us");
    fs.mkdirSync(guidDir, { recursive: true });
    const ops = new fileOperations("cf-guid", "en-us");
    expect(ops.cliFolderExists()).toBe(true);
  });

  it("returns false when instancePath does not exist", () => {
    const ops = new fileOperations("no-cf-guid", "en-us");
    expect(ops.cliFolderExists()).toBe(false);
  });
});

// ─── saveMappingFile — preflight guard (PROD-2203) ────────────────────────────

describe("saveMappingFile — preflight guard", () => {
  it("writes the mapping file to disk when preflight is disabled", () => {
    const ops = new fileOperations("pf-s-guid", "en-us");
    const mappingData = [{ sourceID: 10, targetID: 200 }];

    ops.saveMappingFile(mappingData, "content", "pf-s-guid", "pf-t-guid", "en-us");

    const expectedDir = path.join(tmpDir, "mappings", "pf-s-guid-pf-t-guid", "en-us", "content");
    const expectedFile = path.join(expectedDir, "mappings.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
    expect(written).toEqual(mappingData);
  });

  it("does NOT write any file to disk when preflight is enabled", () => {
    setState({ preflight: true });
    const ops = new fileOperations("pf2-s-guid", "en-us");
    const mappingData = [{ sourceID: 11, targetID: 201 }];

    ops.saveMappingFile(mappingData, "content", "pf2-s-guid", "pf2-t-guid", "en-us");

    const expectedDir = path.join(tmpDir, "mappings", "pf2-s-guid-pf2-t-guid", "en-us", "content");
    const expectedFile = path.join(expectedDir, "mappings.json");
    expect(fs.existsSync(expectedFile)).toBe(false);
  });

  it("does NOT create the mapping directory when preflight is enabled", () => {
    setState({ preflight: true });
    const ops = new fileOperations("pf3-s-guid", "en-us");

    ops.saveMappingFile([{ sourceID: 1, targetID: 2 }], "models", "pf3-s-guid", "pf3-t-guid", "en-us");

    const expectedDir = path.join(tmpDir, "mappings", "pf3-s-guid-pf3-t-guid", "en-us", "models");
    expect(fs.existsSync(expectedDir)).toBe(false);
  });

  it("does not overwrite an existing mapping file when preflight is enabled", () => {
    // First write normally to establish an existing file
    const ops = new fileOperations("pf4-s-guid", "en-us");
    const originalData = [{ sourceID: 50, targetID: 500 }];
    ops.saveMappingFile(originalData, "content", "pf4-s-guid", "pf4-t-guid", "en-us");

    const expectedFile = path.join(
      tmpDir,
      "mappings",
      "pf4-s-guid-pf4-t-guid",
      "en-us",
      "content",
      "mappings.json"
    );
    expect(fs.existsSync(expectedFile)).toBe(true);

    // Now enable preflight and attempt to overwrite with different data
    setState({ preflight: true });
    const newOps = new fileOperations("pf4-s-guid", "en-us");
    const newData = [{ sourceID: 99, targetID: 999 }];
    newOps.saveMappingFile(newData, "content", "pf4-s-guid", "pf4-t-guid", "en-us");

    // File should still contain the original data
    const written = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
    expect(written).toEqual(originalData);
  });
});
