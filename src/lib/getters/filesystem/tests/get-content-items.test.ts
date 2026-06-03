import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { fileOperations } from "core/fileOperations";
import { getContentItemsFromFileSystem } from "../get-content-items";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-test-get-content-items-"));
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

describe("getContentItemsFromFileSystem", () => {
  it("returns an empty array when item folder does not exist", () => {
    const fileOps = makeFileOps("content-missing");
    const result = getContentItemsFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it("returns an empty array when item folder has no JSON files", () => {
    const fileOps = makeFileOps("content-empty-dir");
    const itemDir = path.join(fileOps.instancePath, "item");
    fs.mkdirSync(itemDir, { recursive: true });

    const result = getContentItemsFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it("returns content items from all JSON files in item folder", () => {
    const fileOps = makeFileOps("content-has-data");
    const itemDir = path.join(fileOps.instancePath, "item");
    fs.mkdirSync(itemDir, { recursive: true });
    const item1 = { contentID: 1, fields: { title: "First Post" } };
    const item2 = { contentID: 2, fields: { title: "Second Post" } };
    fs.writeFileSync(path.join(itemDir, "1.json"), JSON.stringify(item1));
    fs.writeFileSync(path.join(itemDir, "2.json"), JSON.stringify(item2));

    const result = getContentItemsFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const ids = result.map((c: any) => c.contentID);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("returns a single content item when exactly one file exists", () => {
    const fileOps = makeFileOps("content-single");
    const itemDir = path.join(fileOps.instancePath, "item");
    fs.mkdirSync(itemDir, { recursive: true });
    const item = { contentID: 42, fields: { title: "Only Item" } };
    fs.writeFileSync(path.join(itemDir, "42.json"), JSON.stringify(item));

    const result = getContentItemsFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).contentID).toBe(42);
  });

  it("includes all content from item folder without deduplication", () => {
    const fileOps = makeFileOps("content-no-dedup");
    const itemDir = path.join(fileOps.instancePath, "item");
    fs.mkdirSync(itemDir, { recursive: true });
    const item1 = { contentID: 10 };
    const item2 = { contentID: 20 };
    const item3 = { contentID: 30 };
    fs.writeFileSync(path.join(itemDir, "10.json"), JSON.stringify(item1));
    fs.writeFileSync(path.join(itemDir, "20.json"), JSON.stringify(item2));
    fs.writeFileSync(path.join(itemDir, "30.json"), JSON.stringify(item3));

    const result = getContentItemsFromFileSystem(fileOps);

    expect(result).toHaveLength(3);
  });

  it("does not load content from list folder", () => {
    const fileOps = makeFileOps("content-no-list");
    const itemDir = path.join(fileOps.instancePath, "item");
    const listDir = path.join(fileOps.instancePath, "list");
    fs.mkdirSync(itemDir, { recursive: true });
    fs.mkdirSync(listDir, { recursive: true });
    const item = { contentID: 5 };
    const listItems = [{ contentID: 100 }, { contentID: 101 }];
    fs.writeFileSync(path.join(itemDir, "5.json"), JSON.stringify(item));
    fs.writeFileSync(path.join(listDir, "someList.json"), JSON.stringify(listItems));

    const result = getContentItemsFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).contentID).toBe(5);
  });
});
