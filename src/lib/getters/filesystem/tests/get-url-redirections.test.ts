import { resetState } from "core/state";
import { getUrlRedirectionsFromFileSystem } from "../get-url-redirections";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeFileOps(readJsonFileImpl: (filePath: string) => any): any {
  return { readJsonFile: jest.fn().mockImplementation(readJsonFileImpl) };
}

// ─── getUrlRedirectionsFromFileSystem ─────────────────────────────────────────

describe("getUrlRedirectionsFromFileSystem", () => {
  it("returns the items array when data is well-formed", () => {
    const items = [
      { id: 1, originUrl: "/old", destinationUrl: "/new", statusCode: 301 },
      { id: 2, originUrl: "/gone", destinationUrl: "/here", statusCode: 302 },
    ];
    const fileOps = makeFileOps(() => ({ items, isUpToDate: true, lastAccessDate: "" }));

    const result = getUrlRedirectionsFromFileSystem(fileOps);

    expect(result).toEqual(items);
    expect(fileOps.readJsonFile).toHaveBeenCalledWith("urlredirections/urlredirections.json");
  });

  it("returns an empty array when readJsonFile returns null", () => {
    const fileOps = makeFileOps(() => null);
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when the data object has no items property", () => {
    const fileOps = makeFileOps(() => ({ isUpToDate: true }));
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when items is not an array (string)", () => {
    const fileOps = makeFileOps(() => ({ items: "not-an-array" }));
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when items is not an array (object)", () => {
    const fileOps = makeFileOps(() => ({ items: { 0: { id: 1 } } }));
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when items is null", () => {
    const fileOps = makeFileOps(() => ({ items: null }));
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when readJsonFile returns undefined", () => {
    const fileOps = makeFileOps(() => undefined);
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("returns an empty array when the items array is empty", () => {
    const fileOps = makeFileOps(() => ({ items: [] }));
    expect(getUrlRedirectionsFromFileSystem(fileOps)).toEqual([]);
  });

  it("always reads the fixed path regardless of arguments", () => {
    const fileOps = makeFileOps(() => null);
    getUrlRedirectionsFromFileSystem(fileOps);
    expect(fileOps.readJsonFile).toHaveBeenCalledTimes(1);
    expect(fileOps.readJsonFile).toHaveBeenCalledWith("urlredirections/urlredirections.json");
  });
});
