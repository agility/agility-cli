import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, registerEffectiveTargetModel } from "core/state";
import { createEffectiveTargetModelResolver } from "../resolve-effective-target-model";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-etm-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
});

function writeJson(rel: string, data: any): void {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function seed(sourceGuid: string, targetGuid: string, opts: { targetFile: boolean }): void {
  writeJson(`${sourceGuid}/models/10.json`, { id: 10, referenceName: "Post", fields: [{ name: "source" }] });
  if (opts.targetFile) {
    writeJson(`${targetGuid}/models/50.json`, { id: 50, referenceName: "Post", fields: [{ name: "target" }] });
  }
  writeJson(`mappings/${sourceGuid}-${targetGuid}/models/mappings.json`, [
    {
      sourceGuid,
      targetGuid,
      sourceID: 10,
      targetID: 50,
      sourceReferenceName: "Post",
      targetReferenceName: "Post",
      sourceLastModifiedDate: "2025-01-01T00:00:00.000",
      targetLastModifiedDate: "2025-01-01T00:00:00.000",
    },
  ]);
}

describe("createEffectiveTargetModelResolver (PROD-2542)", () => {
  it("prefers the run-scoped registry over the (stale) target cache", () => {
    seed("etm-src-1", "etm-tgt-1", { targetFile: true });
    const saved = { referenceName: "Post", fields: [{ name: "saved" }] };
    registerEffectiveTargetModel("Post", saved);
    const resolve = createEffectiveTargetModelResolver("etm-src-1", "etm-tgt-1");
    expect(resolve("post")).toBe(saved);
  });

  it("falls back to the target model cache via the model mapping", () => {
    seed("etm-src-2", "etm-tgt-2", { targetFile: true });
    const resolve = createEffectiveTargetModelResolver("etm-src-2", "etm-tgt-2");
    expect(resolve("Post").fields).toEqual([{ name: "target" }]);
  });

  it("falls back to the source model when the target cache file is missing", () => {
    seed("etm-src-3", "etm-tgt-3", { targetFile: false });
    const resolve = createEffectiveTargetModelResolver("etm-src-3", "etm-tgt-3");
    expect(resolve("Post").fields).toEqual([{ name: "source" }]);
  });

  it("returns null when nothing is known about the model", () => {
    const resolve = createEffectiveTargetModelResolver("etm-src-4", "etm-tgt-4");
    expect(resolve("Unknown")).toBeNull();
    expect(resolve("")).toBeNull();
  });

  it("returns null without guids instead of throwing", () => {
    const resolve = createEffectiveTargetModelResolver("", "");
    expect(resolve("Post")).toBeNull();
  });
});
