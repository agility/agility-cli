/**
 * PROD-2552: `agility verify` — the run around the checks: status guard, pull, exit codes, and
 * how the command primes state. The checks themselves are covered in src/lib/verify/tests.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { changedSnapshots, runVerifyCommand, STATUS_TIMEOUT_MS, Verify, VerifyDeps, VerifyOptions } from "../verify";
import { resetState, setState, state } from "../state";
import { EXIT_CANNOT_VERIFY, EXIT_DIFFERENCES, EXIT_PASS, VerifyReport } from "../../lib/verify/verify-report";
import { emptySide } from "../../lib/verify/tests/fixtures";
import { SideEntities } from "../../lib/verify/verify-context";

const SRC = "src-1";
const TGT = "tgt-1";
const LOCALE = "en-us";

let root: string;

function writeJson(file: string, data: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/** A cache + mapping tree on disk, so the "can we verify at all" preconditions pass. */
function seedRoot(): void {
  writeJson(path.join(root, SRC, "models", "1.json"), { id: 1, referenceName: "Post", fields: [] });
  writeJson(path.join(root, TGT, "models", "11.json"), { id: 11, referenceName: "Post", fields: [] });
  writeJson(path.join(root, "mappings", `${SRC}-${TGT}`, "models", "mappings.json"), [
    { sourceID: 1, targetID: 11, sourceReferenceName: "Post", targetReferenceName: "Post" },
  ]);
  writeJson(path.join(root, "mappings", `${SRC}-${TGT}`, LOCALE, "item", "mappings.json"), [
    { sourceContentID: 5, targetContentID: 55 },
  ]);
}

const POST = { id: 1, referenceName: "Post", fields: [{ name: "Title", type: "Text" }] };
const POST_T = { ...POST, id: 11 };
const item = (contentID: number, title: string) => ({
  contentID,
  properties: { state: 2, referenceName: "posts", definitionName: "Post", itemOrder: 0, versionID: 1 },
  fields: { title },
});

function sides(targetTitle: string): Record<string, SideEntities> {
  return {
    [SRC]: emptySide({ models: [POST], content: [item(5, "Hello")] }),
    [TGT]: emptySide({ models: [POST_T], content: [item(55, targetTitle)] }),
  };
}

function options(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    sourceGuid: SRC,
    targetGuid: TGT,
    locales: [LOCALE],
    models: "",
    pages: "",
    containers: "",
    jsonSummary: path.join(root, "report.json"),
    rootPath: root,
    ...overrides,
  };
}

const idle = { inProgress: false, lastContentVersionID: 10, maxChangeDate: "2026-10-01T00:00:00Z" } as any;
const busy = { ...idle, inProgress: true };
const okPull = async () => ({
  success: true,
  results: [
    { guidProcessed: SRC, failed: [] },
    { guidProcessed: TGT, failed: [] },
  ],
});

/** Deps with a fake clock that sleep() advances, a no-op pull, and in-memory sides. */
function deps(overrides: Partial<VerifyDeps> = {}, targetTitle = "Hello"): VerifyDeps & { clock: { t: number } } {
  const clock = { t: Date.parse("2026-10-07T00:00:00Z") };
  const data = sides(targetTitle);
  return {
    clock,
    getStatus: async () => idle,
    pull: okPull,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
    now: () => clock.t,
    log: () => {},
    loadSide: async (guid: string) => data[guid],
    statusTimeoutMs: STATUS_TIMEOUT_MS,
    statusPollMs: 5000,
    print: false,
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-"));
  resetState();
  setState({ rootPath: root, sourceGuid: SRC, targetGuid: TGT });
  seedRoot();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe("exit codes", () => {
  it("0 when the target matches", async () => {
    const report = await new Verify(options(), deps()).run();
    expect(report.exitCode).toBe(EXIT_PASS);
    expect(report.verdict).toBe("pass");
  });

  it("1 when the target differs", async () => {
    const report = await new Verify(options(), deps({}, "Changed")).run();
    expect(report.exitCode).toBe(EXIT_DIFFERENCES);
    expect(report.findings).toEqual([expect.objectContaining({ category: "fieldMismatch", path: "title" })]);
  });

  it("writes the JSON report to --jsonSummary", async () => {
    await new Verify(options(), deps()).run();
    const written = JSON.parse(fs.readFileSync(path.join(root, "report.json"), "utf8"));
    expect(written).toMatchObject({ command: "verify", exitCode: 0, source: SRC, target: TGT });
    expect(written.run.status.before).toHaveLength(4);
  });

  it("writes to agility-files/logs/verify-*.json without --jsonSummary", async () => {
    await new Verify(options({ jsonSummary: "" }), deps()).run();
    const logs = fs.readdirSync(path.join(root, "logs"));
    expect(logs).toEqual([expect.stringMatching(new RegExp(`^verify-${SRC}-${TGT}-.*\\.json$`))]);
  });

  it("2 when the pair has no mapping files", async () => {
    fs.rmSync(path.join(root, "mappings"), { recursive: true });
    const report = await new Verify(options(), deps()).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/No mapping files/);
  });

  it("2 when a requested locale has no mappings", async () => {
    const report = await new Verify(options({ locales: [LOCALE, "fr-ca"] }), deps()).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/fr-ca/);
  });

  it("2 when the pulled cache is unreadable", async () => {
    fs.writeFileSync(path.join(root, TGT, "models", "12.json"), "{ truncated");
    const report = await new Verify(options(), deps()).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/unreadable/);
  });

  it("2 when scope flags are combined", async () => {
    const report = await new Verify(options({ models: "Post", pages: "/home" }), deps()).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
  });

  it("never writes to the mapping files", async () => {
    const dir = path.join(root, "mappings");
    const snapshot = () => JSON.stringify(fs.readdirSync(dir, { recursive: true } as any).sort());
    const before = snapshot();
    // A type folder without its mappings.json — fileOperations.getMappingFile would seed one.
    fs.mkdirSync(path.join(dir, `${SRC}-${TGT}`, "containers"));
    await new Verify(options(), deps()).run();
    expect(snapshot()).toBe(JSON.stringify([...JSON.parse(before), `${SRC}-${TGT}/containers`].sort()));
  });
});

describe("status guard", () => {
  it("checks both instances in preview and fetch mode before and after the pull", async () => {
    const calls: string[] = [];
    await new Verify(
      options(),
      deps({
        getStatus: async (guid, mode) => {
          calls.push(`${guid}:${mode}`);
          return idle;
        },
      })
    ).run();
    const once = [`${SRC}:preview`, `${SRC}:fetch`, `${TGT}:preview`, `${TGT}:fetch`];
    expect(calls).toEqual([...once, ...once]);
  });

  it("waits for an in-progress update to finish", async () => {
    let checks = 0;
    const d = deps({
      getStatus: async (guid, mode) => (guid === TGT && mode === "fetch" && ++checks <= 3 ? busy : idle),
    });
    const sleep = jest.spyOn(d, "sleep");
    const report = await new Verify(options(), d).run();
    expect(report.exitCode).toBe(EXIT_PASS);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("gives up after the timeout with exit 2", async () => {
    const pull = jest.fn(okPull);
    const report = await new Verify(options(), deps({ getStatus: async () => busy, pull })).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/Timed out after 10 minute/);
    expect(pull).not.toHaveBeenCalled();
  });

  it("treats a status error as exit 2 (it is not swallowed)", async () => {
    const report = await new Verify(
      options(),
      deps({
        getStatus: async () => {
          throw new Error("503 Service Unavailable");
        },
      })
    ).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/503/);
  });

  it("re-pulls once when an update lands during the pull", async () => {
    let version = 10;
    const pull = jest.fn(async () => {
      if (pull.mock.calls.length === 1) version = 11; // an update lands during the first pull only
      return okPull();
    });
    const report = await new Verify(
      options(),
      deps({ getStatus: async () => ({ ...idle, lastContentVersionID: version }), pull })
    ).run();
    expect(pull).toHaveBeenCalledTimes(2);
    expect(report.exitCode).toBe(EXIT_PASS);
    expect(report.run.pull.attempts).toBe(2);
  });

  it("exits 2 when an update lands during the re-pull too", async () => {
    let version = 10;
    const pull = jest.fn(async () => {
      version++;
      return okPull();
    });
    const report = await new Verify(
      options(),
      deps({ getStatus: async () => ({ ...idle, lastContentVersionID: version }), pull })
    ).run();
    expect(pull).toHaveBeenCalledTimes(2);
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/update ran during the pull/);
  });

  it("detects a change by maxChangeDate or a new in-progress update", () => {
    const base = {
      guid: "g",
      mode: "fetch",
      checkedAt: "",
      inProgress: false,
      lastContentVersionID: 1,
      maxChangeDate: "a",
    };
    expect(changedSnapshots([base], [{ ...base }])).toEqual([]);
    expect(changedSnapshots([base], [{ ...base, maxChangeDate: "b" }])).toHaveLength(1);
    expect(changedSnapshots([base], [{ ...base, inProgress: true }])).toHaveLength(1);
  });
});

describe("pull", () => {
  it("does a full pull with every element and no scope, then restores state", async () => {
    setState({ models: "Post", fullPull: false });
    let during: any;
    await new Verify(
      options({ models: "Post" }),
      deps({
        pull: async () => {
          during = { fullPull: state.fullPull, models: state.models, elements: state.elements };
          return okPull();
        },
      })
    ).run();
    expect(during.fullPull).toBe(true);
    expect(during.models).toBe("");
    expect(during.elements).toContain("Content");
    expect(state.fullPull).toBe(false);
    expect(state.models).toBe("Post");
  });

  it.each([
    ["throws", async () => Promise.reject(new Error("network down"))],
    ["reports failure", async () => ({ success: false, results: [] })],
    [
      "has a failed operation",
      async () => ({
        success: true,
        results: [
          { guidProcessed: SRC, failed: [{ operation: "downloadAllModels", error: "boom" }] },
          { guidProcessed: TGT, failed: [] },
        ],
      }),
    ],
    ["misses an instance", async () => ({ success: true, results: [{ guidProcessed: SRC, failed: [] }] })],
  ])("exits 2 when the pull %s", async (_label, pull) => {
    const report = await new Verify(options(), deps({ pull: pull as any })).run();
    expect(report.exitCode).toBe(EXIT_CANNOT_VERIFY);
    expect(report.error).toMatch(/Pull failed/);
  });
});

describe("runVerifyCommand", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => process.chdir(cwd));

  const passingReport = { exitCode: 0 } as VerifyReport;
  const okAuth = () => ({ init: async () => true, validateCommand: async () => true });

  it("primes state from argv and hands the verify options over", async () => {
    let received: VerifyOptions | undefined;
    const code = await runVerifyCommand(
      {
        sourceGuid: SRC,
        targetGuid: TGT,
        locales: "en-us,fr-ca",
        models: "Post",
        jsonSummary: "out.json",
        channel: "Mobile",
      },
      {
        createAuth: okAuth,
        createVerify: (opts) => {
          received = opts;
          return { run: async () => passingReport };
        },
        log: () => {},
      }
    );
    expect(code).toBe(0);
    expect(received).toEqual({
      sourceGuid: SRC,
      targetGuid: TGT,
      locales: ["en-us", "fr-ca"],
      channel: "Mobile",
      models: "Post",
      pages: "",
      containers: "",
      jsonSummary: "out.json",
      rootPath: "agility-files",
    });
  });

  it("leaves the channel unset when --channel is not passed (every channel is verified)", async () => {
    let received: VerifyOptions | undefined;
    await runVerifyCommand(
      { sourceGuid: SRC, targetGuid: TGT, locales: "en-us" },
      {
        createAuth: okAuth,
        createVerify: (opts) => {
          received = opts;
          return { run: async () => passingReport };
        },
        log: () => {},
      }
    );
    expect(received?.channel).toBeUndefined();
  });

  it("falls back to AGILITY_GUID / AGILITY_TARGET_GUID from .env", async () => {
    fs.writeFileSync(path.join(root, ".env"), `AGILITY_GUID=${SRC}\nAGILITY_TARGET_GUID=${TGT}\n`);
    let received: VerifyOptions | undefined;
    await runVerifyCommand(
      { locales: "en-us" },
      {
        createAuth: okAuth,
        createVerify: (opts) => {
          received = opts;
          return { run: async () => passingReport };
        },
        log: () => {},
      }
    );
    expect(received).toMatchObject({ sourceGuid: SRC, targetGuid: TGT });
  });

  it("returns the report's exit code", async () => {
    const code = await runVerifyCommand(
      { sourceGuid: SRC, targetGuid: TGT, locales: "en-us" },
      {
        createAuth: okAuth,
        createVerify: () => ({ run: async () => ({ exitCode: 1 }) as VerifyReport }),
        log: () => {},
      }
    );
    expect(code).toBe(1);
  });

  it.each([
    [
      "an authentication error",
      { sourceGuid: SRC, targetGuid: TGT },
      () => ({
        init: async () => {
          throw new Error("ECONNRESET");
        },
        validateCommand: async () => true,
      }),
    ],
    ["missing guids", {}, okAuth],
    ["identical guids", { sourceGuid: SRC, targetGuid: SRC }, okAuth],
    [
      "failed authentication",
      { sourceGuid: SRC, targetGuid: TGT },
      () => ({ init: async () => false, validateCommand: async () => true }),
    ],
    [
      "failed validation",
      { sourceGuid: SRC, targetGuid: TGT },
      () => ({ init: async () => true, validateCommand: async () => false }),
    ],
  ])("exits 2 with a report on %s", async (_label, argv: any, createAuth: any) => {
    const createVerify = jest.fn();
    const code = await runVerifyCommand(
      { ...argv, jsonSummary: "abort.json" },
      { createAuth, createVerify, log: () => {} }
    );
    expect(code).toBe(EXIT_CANNOT_VERIFY);
    expect(createVerify).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(root, "abort.json"), "utf8"))).toMatchObject({
      verdict: "error",
      exitCode: 2,
    });
  });
});
