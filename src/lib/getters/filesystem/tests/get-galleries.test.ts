import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { fileOperations } from "core/fileOperations";
import { getGalleriesFromFileSystem } from "../get-galleries";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-test-get-galleries-"));
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

describe("getGalleriesFromFileSystem", () => {
  it("throws or returns empty when galleries folder does not exist", () => {
    const fileOps = makeFileOps("galleries-missing");
    // getFolderContents (readdirSync) throws when directory does not exist
    expect(() => getGalleriesFromFileSystem(fileOps)).toThrow();
  });

  it("returns an empty array when galleries folder is empty", () => {
    const fileOps = makeFileOps("galleries-empty-dir");
    const galleriesDir = path.join(fileOps.instancePath, "galleries");
    fs.mkdirSync(galleriesDir, { recursive: true });

    const result = getGalleriesFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it("returns galleries from all JSON files in the folder", () => {
    const fileOps = makeFileOps("galleries-has-data");
    const galleriesDir = path.join(fileOps.instancePath, "galleries");
    fs.mkdirSync(galleriesDir, { recursive: true });
    const g1 = { mediaGroupingID: 1, name: "Gallery One" };
    const g2 = { mediaGroupingID: 2, name: "Gallery Two" };
    fs.writeFileSync(path.join(galleriesDir, "1.json"), JSON.stringify(g1));
    fs.writeFileSync(path.join(galleriesDir, "2.json"), JSON.stringify(g2));

    const result = getGalleriesFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const ids = result.map((g: any) => g.mediaGroupingID);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("deduplicates galleries with the same mediaGroupingID", () => {
    const fileOps = makeFileOps("galleries-deduplicate");
    const galleriesDir = path.join(fileOps.instancePath, "galleries");
    fs.mkdirSync(galleriesDir, { recursive: true });
    const gallery = { mediaGroupingID: 5, name: "Shared Gallery" };
    // Write the same gallery data under two file names
    fs.writeFileSync(path.join(galleriesDir, "5a.json"), JSON.stringify(gallery));
    fs.writeFileSync(path.join(galleriesDir, "5b.json"), JSON.stringify(gallery));

    const result = getGalleriesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).mediaGroupingID).toBe(5);
  });

  it("keeps all galleries when mediaGroupingIDs are unique", () => {
    const fileOps = makeFileOps("galleries-no-dedup-needed");
    const galleriesDir = path.join(fileOps.instancePath, "galleries");
    fs.mkdirSync(galleriesDir, { recursive: true });
    [10, 11, 12].forEach((id) => {
      fs.writeFileSync(
        path.join(galleriesDir, `${id}.json`),
        JSON.stringify({ mediaGroupingID: id, name: `Gallery ${id}` })
      );
    });

    const result = getGalleriesFromFileSystem(fileOps);

    expect(result).toHaveLength(3);
  });

  it("skips malformed JSON files without throwing", () => {
    const fileOps = makeFileOps("galleries-bad-json");
    const galleriesDir = path.join(fileOps.instancePath, "galleries");
    fs.mkdirSync(galleriesDir, { recursive: true });
    fs.writeFileSync(path.join(galleriesDir, "invalid.json"), "NOT JSON AT ALL {{{");
    fs.writeFileSync(path.join(galleriesDir, "1.json"), JSON.stringify({ mediaGroupingID: 1, name: "Good" }));

    const result = getGalleriesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).mediaGroupingID).toBe(1);
  });
});
