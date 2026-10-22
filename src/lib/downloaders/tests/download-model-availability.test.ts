import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import * as stateModule from "core/state";
import { fileOperations } from "core/fileOperations";
import { downloadModelAvailability, isAvailabilityUnsupported } from "../download-model-availability";
import { getModelAvailabilityFromFileSystem } from "../../getters/filesystem/get-model-availability";

const GUID = "avail-pull-u";

let tmpDir: string;
let folder: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-availability-pull-"));
  folder = path.join(tmpDir, GUID, "model-availability");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  fs.rmSync(path.join(tmpDir, GUID), { recursive: true, force: true });
  jest.spyOn(stateModule, "getLoggerForGuid").mockReturnValue({ info: jest.fn(), error: jest.fn() } as any);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockApi(getAll: jest.Mock | undefined) {
  jest
    .spyOn(stateModule, "getApiClient")
    .mockReturnValue({ modelMethods: getAll ? { getAllModelAvailability: getAll } : {} } as any);
}

function httpError(statusCode: number) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

function seedStaleFile(modelID: number) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${modelID}.json`), JSON.stringify({ modelID }));
}

const rule = (modelID: number) => ({
  modelID,
  addableBy: null,
  allowedIn: { sitemaps: [], pageModels: [], zones: [] },
});

describe("downloadModelAvailability", () => {
  it("writes one file per model with rules", async () => {
    mockApi(jest.fn().mockResolvedValue([rule(12), rule(13)]));

    await downloadModelAvailability(GUID);

    expect(fs.readdirSync(folder).sort()).toEqual(["12.json", "13.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "12.json"), "utf8"))).toEqual(rule(12));
  });

  it("creates the folder even when the instance has no rules, so the push knows there are none", async () => {
    mockApi(jest.fn().mockResolvedValue([]));

    await downloadModelAvailability(GUID);

    expect(fs.existsSync(folder)).toBe(true);
    expect(getModelAvailabilityFromFileSystem(new fileOperations(GUID))).toEqual([]);
  });

  it("removes the file of a model that no longer has rules", async () => {
    seedStaleFile(99);
    mockApi(jest.fn().mockResolvedValue([rule(12)]));

    await downloadModelAvailability(GUID);

    expect(fs.readdirSync(folder)).toEqual(["12.json"]);
  });

  it.each([404, 405, 409])("treats HTTP %i as an instance without the feature: no folder, no error", async (status) => {
    seedStaleFile(12);
    mockApi(jest.fn().mockRejectedValue(httpError(status)));

    await expect(downloadModelAvailability(GUID)).resolves.toBeUndefined();

    expect(fs.existsSync(folder)).toBe(false);
    expect(getModelAvailabilityFromFileSystem(new fileOperations(GUID))).toBeNull();
  });

  it("treats an SDK without the availability methods the same way", async () => {
    seedStaleFile(12);
    mockApi(undefined);

    await expect(downloadModelAvailability(GUID)).resolves.toBeUndefined();

    expect(fs.existsSync(folder)).toBe(false);
  });

  it("treats a single model instead of a list (an older API's model/{referenceName} route) as no feature", async () => {
    seedStaleFile(12);
    mockApi(jest.fn().mockResolvedValue({ id: 5, referenceName: "availability", fields: [] }));

    await expect(downloadModelAvailability(GUID)).resolves.toBeUndefined();

    expect(fs.existsSync(folder)).toBe(false);
    expect(getModelAvailabilityFromFileSystem(new fileOperations(GUID))).toBeNull();
  });

  it("removes a half-written folder and rethrows when writing the rules fails", async () => {
    seedStaleFile(99);
    mockApi(jest.fn().mockResolvedValue([rule(12)]));
    jest.spyOn(fileOperations.prototype, "exportFiles").mockImplementation(() => {
      throw new Error("disk full");
    });

    await expect(downloadModelAvailability(GUID)).rejects.toThrow("disk full");

    expect(fs.existsSync(folder)).toBe(false);
  });

  it("removes stale rules and rethrows any other error", async () => {
    seedStaleFile(12);
    mockApi(jest.fn().mockRejectedValue(httpError(500)));

    await expect(downloadModelAvailability(GUID)).rejects.toThrow("HTTP 500");

    expect(fs.existsSync(folder)).toBe(false);
  });
});

describe("isAvailabilityUnsupported", () => {
  it("reads the SDK Exception's statusCode and a raw axios error's response status", () => {
    expect(isAvailabilityUnsupported({ statusCode: 409 })).toBe(true);
    expect(isAvailabilityUnsupported({ response: { status: 404 } })).toBe(true);
    expect(isAvailabilityUnsupported({ statusCode: 400 })).toBe(false);
    expect(isAvailabilityUnsupported(new Error("network"))).toBe(false);
  });
});
