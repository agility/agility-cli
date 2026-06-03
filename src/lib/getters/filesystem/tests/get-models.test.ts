import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { fileOperations } from "core/fileOperations";
import { getModelsFromFileSystem } from "../get-models";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-test-get-models-"));
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

function makeFileOps(subDir: string): fileOperations {
  const root = path.join(tmpDir, subDir);
  fs.mkdirSync(root, { recursive: true });
  setState({ rootPath: root });
  return new fileOperations("test-guid", "en-us");
}

describe("getModelsFromFileSystem", () => {
  it("returns an empty array when models folder does not exist", () => {
    const fileOps = makeFileOps("models-missing");
    const result = getModelsFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it("returns an empty array when models folder has no JSON files", () => {
    const fileOps = makeFileOps("models-empty-dir");
    const modelsDir = path.join(fileOps.instancePath, "models");
    fs.mkdirSync(modelsDir, { recursive: true });

    const result = getModelsFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it("returns models from all JSON files without transformation", () => {
    const fileOps = makeFileOps("models-has-data");
    const modelsDir = path.join(fileOps.instancePath, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    const model1 = { id: 1, referenceName: "BlogPost", displayName: "Blog Post" };
    const model2 = { id: 2, referenceName: "Article", displayName: "Article" };
    fs.writeFileSync(path.join(modelsDir, "1.json"), JSON.stringify(model1));
    fs.writeFileSync(path.join(modelsDir, "2.json"), JSON.stringify(model2));

    const result = getModelsFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject(model1);
    expect(result[1]).toMatchObject(model2);
  });

  it("returns the raw model data as-is (no transformation)", () => {
    const fileOps = makeFileOps("models-raw");
    const modelsDir = path.join(fileOps.instancePath, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    const model = {
      id: 99,
      referenceName: "TestModel",
      fields: [{ name: "title", type: "Text" }],
      lastModifiedDate: "2025-01-01",
    };
    fs.writeFileSync(path.join(modelsDir, "99.json"), JSON.stringify(model));

    const result = getModelsFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(model);
  });

  it("returns a single model when exactly one file exists", () => {
    const fileOps = makeFileOps("models-single");
    const modelsDir = path.join(fileOps.instancePath, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    const model = { id: 5, referenceName: "SingleModel" };
    fs.writeFileSync(path.join(modelsDir, "5.json"), JSON.stringify(model));

    const result = getModelsFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).referenceName).toBe("SingleModel");
  });
});
