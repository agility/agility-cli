import { CliError, EXIT_CODES, statusOf, worstStatus } from "../outcome";
import { finish, listOf, renderTable, selectFields, Writer } from "../output";
import { resolveGuid, resolveLocale } from "../context";

function capture(isTTY = false) {
  const out = { stdout: "", stderr: "" };
  const w: Writer = { stdout: (t) => (out.stdout += t), stderr: (t) => (out.stderr += t), isTTY };
  return { out, w };
}

describe("statusOf", () => {
  it.each([
    [{ statusCode: 401 }, "auth"],
    [{ statusCode: 403 }, "auth"],
    [{ statusCode: 404 }, "not_found"],
    [{ statusCode: 409 }, "conflict"],
    [{ statusCode: 500 }, "error"],
    [{ response: { status: 404 } }, "not_found"],
    [{ innerError: { response: { status: 409 } } }, "conflict"],
    [new Error("boom"), "error"],
    [new CliError("usage", "bad flag"), "usage"],
  ])("maps %j to %s", (err, status) => {
    expect(statusOf(err)).toBe(status);
  });
});

describe("worstStatus", () => {
  it("prefers error over conflict over ok", () => {
    expect(worstStatus(["ok", "conflict"])).toBe("conflict");
    expect(worstStatus(["ok", "conflict", "error"])).toBe("error");
    expect(worstStatus([])).toBe("ok");
  });
});

describe("exit codes", () => {
  it("matches the documented table", () => {
    expect(EXIT_CODES).toEqual({ ok: 0, error: 1, usage: 2, conflict: 3, auth: 4, not_found: 5, refused: 6 });
  });
});

describe("selectFields", () => {
  it("trims each item of a list, keeping dotted paths", () => {
    const r = [{ id: 1, fields: { title: "a", body: "x" }, extra: true }];
    expect(selectFields(r, ["id", "fields.title"])).toEqual([{ id: 1, fields: { title: "a" } }]);
  });

  it("trims the items of a paged wrapper and keeps its other keys", () => {
    const r = {
      totalCount: 2,
      items: [
        { id: 1, x: 1 },
        { id: 2, x: 2 },
      ],
    };
    expect(selectFields(r, ["id"])).toEqual({ totalCount: 2, items: [{ id: 1 }, { id: 2 }] });
  });

  it("trims a single object", () => {
    expect(selectFields({ id: 1, x: 2 }, ["id"])).toEqual({ id: 1 });
  });
});

describe("listOf", () => {
  it("finds the list of a paged result", () => {
    expect(listOf({ totalCount: 1, assetMedias: [1] })).toEqual({ key: "assetMedias", list: [1] });
    expect(listOf({ totalCount: 1, items: [1] })).toEqual({ key: "items", list: [1] });
    expect(listOf([1, 2])).toEqual({ key: null, list: [1, 2] });
  });

  it("treats an object that merely holds an array as a single result", () => {
    expect(listOf({ userID: 1, websiteAccess: [{ guid: "a" }] })).toBeNull();
    expect(selectFields({ userID: 1, userName: "x", websiteAccess: [] }, ["userID"])).toEqual({ userID: 1 });
  });
});

describe("renderTable", () => {
  it("prints a header and one row per item", () => {
    const text = renderTable([
      { id: 1, name: "One" },
      { id: 22, name: "Two" },
    ]);
    expect(text.split("\n")).toEqual(["id  name", "--  ----", "1   One", "22  Two", ""]);
  });
});

describe("finish", () => {
  const base = { command: "manage x y", warnings: [], startedAt: new Date(), cliVersion: "3.0.0" };

  it("prints only the result on stdout and returns 0", () => {
    const { out, w } = capture();
    const code = finish({ ...base, status: "ok", result: { a: 1 }, errors: [] }, { json: false, output: "json" }, w);
    expect(code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ a: 1 });
    expect(out.stderr).toBe("");
  });

  it("prints errors on stderr and nothing on stdout when there is no result", () => {
    const { out, w } = capture();
    const code = finish(
      { ...base, status: "not_found", result: undefined, errors: [{ status: "not_found", message: "gone" }] },
      { json: false, output: "json" },
      w
    );
    expect(code).toBe(5);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("error: gone\n");
  });

  it("with --json prints one parseable document, even on failure", () => {
    const { out, w } = capture();
    const code = finish(
      {
        ...base,
        status: "conflict",
        result: undefined,
        errors: [{ status: "conflict", message: "exists", httpStatus: 409 }],
      },
      { json: true, output: "json" },
      w
    );
    expect(code).toBe(3);
    const doc = JSON.parse(out.stdout);
    expect(doc).toMatchObject({
      schemaVersion: 1,
      command: "manage x y",
      status: "conflict",
      exitCode: 3,
      result: null,
      errors: [{ status: "conflict", message: "exists", httpStatus: 409 }],
      warnings: [],
    });
    expect(Object.keys(doc.run)).toEqual(["startedAt", "durationMs", "cliVersion"]);
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("resolveGuid", () => {
  it("prefers --guid, then .env, and refuses to guess", () => {
    expect(resolveGuid("abc-u", "env-u")).toBe("abc-u");
    expect(resolveGuid(undefined, "env-u")).toBe("env-u");
    expect(() => resolveGuid(undefined, "")).toThrow(/--guid/);
  });
});

describe("resolveLocale", () => {
  const never = async (): Promise<string[]> => {
    throw new Error("should not fetch");
  };

  it("uses --locale without asking the API", async () => {
    await expect(resolveLocale("fr-ca", [], never)).resolves.toBe("fr-ca");
  });

  it("uses a single locale from .env", async () => {
    await expect(resolveLocale(undefined, ["en-us"], never)).resolves.toBe("en-us");
  });

  it("refuses several .env locales", async () => {
    await expect(resolveLocale(undefined, ["en-us", "fr-ca"], never)).rejects.toMatchObject({ status: "usage" });
  });

  it("uses the instance's only locale", async () => {
    await expect(resolveLocale(undefined, [], async () => ["en-us"])).resolves.toBe("en-us");
  });

  it("refuses to guess between the instance's locales", async () => {
    await expect(resolveLocale(undefined, [], async () => ["en-us", "pt-br"])).rejects.toMatchObject({
      status: "usage",
      message: expect.stringContaining("en-us, pt-br"),
    });
  });
});
