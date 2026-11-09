import { CliError } from "../../api-runtime/outcome";
import { Writer } from "../../api-runtime/output";
import { callAll, parseJsonArg, runEndpoint, RunDeps } from "../runner";
import { Endpoint, flag, pos, takeSkip } from "../types";

function setup(overrides: Partial<RunDeps> = {}, locale = "en-us") {
  const out = { stdout: "", stderr: "" };
  const writer: Writer = { stdout: (t) => (out.stdout += t), stderr: (t) => (out.stderr += t), isTTY: false };
  const deps: RunDeps = {
    createContext: async (args) => ({
      guid: args.guid || "env-guid-u",
      baseUrl: "https://example.test",
      client: {} as any,
      locale: async () => args.locale || locale,
    }),
    writer,
    readStdin: () => '{"from":"stdin"}',
    readFile: (p) => (p === "body.json" ? '{"from":"file"}' : "{bad"),
    cliVersion: () => "3.0.0-test",
    ...overrides,
  };
  return { out, deps };
}

const getItem = (impl: (a: any) => Promise<unknown>): Endpoint => ({
  resource: "content",
  action: "get",
  describe: "",
  effect: "read",
  sdk: [],
  args: [pos("id", "number", "")],
  needsLocale: true,
  call: (_c, a) => impl(a),
});

describe("runEndpoint", () => {
  it("resolves guid and locale, calls the SDK and prints the result", async () => {
    const seen: any[] = [];
    const { out, deps } = setup();
    const code = await runEndpoint(
      getItem(async (a) => {
        seen.push(a);
        return { contentID: a.id };
      }),
      { id: 7, guid: "abc-u" },
      deps
    );
    expect(code).toBe(0);
    expect(seen[0]).toMatchObject({ id: 7, guid: "abc-u", locale: "en-us" });
    expect(JSON.parse(out.stdout)).toEqual({ contentID: 7 });
  });

  it.each([
    [{ statusCode: 404, message: "missing" }, 5, "not_found"],
    [{ statusCode: 409, message: "exists" }, 3, "conflict"],
    [{ statusCode: 401, message: "expired" }, 4, "auth"],
    [{ statusCode: 500, message: "boom" }, 1, "error"],
  ])("maps a thrown %j to exit %i", async (err, exit, status) => {
    const { out, deps } = setup();
    const code = await runEndpoint(
      getItem(async () => {
        throw err;
      }),
      { id: 1, json: true },
      deps
    );
    expect(code).toBe(exit);
    expect(JSON.parse(out.stdout)).toMatchObject({ status, exitCode: exit, result: null });
  });

  it("exits 4 when there is no login", async () => {
    const { deps } = setup({
      createContext: async () => {
        throw new CliError("auth", "Run `agility login`");
      },
    });
    expect(
      await runEndpoint(
        getItem(async () => ({})),
        { id: 1 },
        deps
      )
    ).toBe(4);
  });

  it("exits 2 on a bad argument before resolving anything", async () => {
    let contextCalled = false;
    const { out, deps } = setup({
      createContext: async () => {
        contextCalled = true;
        throw new Error("unreachable");
      },
    });
    const code = await runEndpoint(
      getItem(async () => ({})),
      { id: "abc", json: true },
      deps
    );
    expect(code).toBe(2);
    expect(contextCalled).toBe(false);
    expect(JSON.parse(out.stdout).errors[0].message).toMatch(/id must be a number/);
  });

  it("refuses --all on an action that doesn't page", async () => {
    const { deps } = setup();
    expect(
      await runEndpoint(
        getItem(async () => ({})),
        { id: 1, all: true },
        deps
      )
    ).toBe(2);
  });

  it("applies --fields", async () => {
    const { out, deps } = setup();
    await runEndpoint(
      getItem(async () => ({ contentID: 1, big: "x" })),
      { id: 1, fields: "contentID" },
      deps
    );
    expect(JSON.parse(out.stdout)).toEqual({ contentID: 1 });
  });
});

describe("parseJsonArg", () => {
  const { deps } = setup();
  it("reads inline JSON, @file and stdin", () => {
    expect(parseJsonArg("data", '{"a":1}', deps)).toEqual({ a: 1 });
    expect(parseJsonArg("data", "@body.json", deps)).toEqual({ from: "file" });
    expect(parseJsonArg("data", "-", deps)).toEqual({ from: "stdin" });
  });

  it("reports invalid JSON as a usage error", () => {
    expect(() => parseJsonArg("data", "@bad.json", deps)).toThrow(CliError);
  });
});

describe("callAll", () => {
  const listing = (total: number): Endpoint => ({
    resource: "asset",
    action: "list",
    describe: "",
    effect: "read",
    sdk: [],
    args: [...takeSkip(10), flag("search", "string", "")],
    paged: { take: "take", skip: "skip" },
    call: async (_c, a) => {
      const items = [];
      for (let i = a.skip; i < Math.min(a.skip + a.take, total); i++) items.push({ id: i });
      return { totalCount: total, assetMedias: items };
    },
  });

  it("merges every page into one result", async () => {
    const r: any = await callAll(listing(25), {} as any, { guid: "g", take: 10, skip: 0 });
    expect(r.assetMedias.map((x: any) => x.id)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(r.totalCount).toBe(25);
  });

  it("stops on an exact multiple of the page size using totalCount", async () => {
    const calls: number[] = [];
    const e = listing(20);
    const wrapped: Endpoint = {
      ...e,
      call: (c, a) => {
        calls.push(a.skip);
        return e.call(c, a);
      },
    };
    await callAll(wrapped, {} as any, { guid: "g", take: 10, skip: 0 });
    expect(calls).toEqual([0, 10]);
  });
});
