import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as mgmtApi from "@agility/management-sdk";
import { CliError, messageOf } from "../../api-runtime/outcome";
import { Writer } from "../../api-runtime/output";
import { batchIDsOf, itemError, waitForBatches } from "../batch-wait";
import { appendAudit, auditLogPath, AuditEntry, confirmQuestion, planOf } from "../guards";
import { requestEndpoint, requestPath } from "../request";
import { folderMediaID, versionWarnings } from "../registry/writes";
import { runEndpoint, RunDeps } from "../runner";
import { Endpoint, flag, pos, q } from "../types";

const processed = (batchID: number, items: Partial<mgmtApi.BatchItem>[], extra: Partial<mgmtApi.Batch> = {}) =>
  ({
    batchID,
    batchState: mgmtApi.BatchState.Processed,
    errorData: "",
    items: items.map((i) => ({ itemTypeName: "Content", languageCode: "en-us", errorMessage: null, ...i })),
    ...extra,
  }) as any;

/** A client whose getBatch answers from a queue of batches per ID. */
function batchClient(batches: Record<number, any[]>) {
  const calls: number[] = [];
  const client: any = {
    batchMethods: {
      getBatch: async (id: number) => {
        calls.push(id);
        const queue = batches[id];
        return queue.length > 1 ? queue.shift() : queue[0];
      },
    },
  };
  return { client, calls };
}

function setup(client: any, overrides: Partial<RunDeps> = {}) {
  const out = { stdout: "", stderr: "" };
  const audit: AuditEntry[] = [];
  const asked: string[] = [];
  const writer: Writer = { stdout: (t) => (out.stdout += t), stderr: (t) => (out.stderr += t), isTTY: false };
  const deps: RunDeps = {
    createContext: async (args) => ({
      guid: args.guid || "env-guid-u",
      baseUrl: "https://example.test",
      client,
      locale: async () => args.locale || "en-us",
    }),
    writer,
    readStdin: () => "",
    readFile: () => "",
    cliVersion: () => "3.0.0-test",
    interactive: () => false,
    confirm: async (question) => {
      asked.push(question);
      return true;
    },
    audit: (entry) => {
      audit.push(entry);
      return null;
    },
    wait: { intervalMs: 0, sleep: async () => undefined },
    ...overrides,
  };
  return { out, deps, audit, asked };
}

function publishEndpoint(calls: unknown[] = [], batchID = 77): Endpoint {
  return {
    resource: "content",
    action: "publish",
    describe: "",
    effect: "write",
    sdk: ["contentMethods.publishContent"],
    args: [pos("id", "number", ""), flag("comments", "string", "")],
    needsLocale: true,
    batched: true,
    call: async (_c, a) => {
      calls.push(a);
      return [batchID];
    },
  };
}

describe("write guards", () => {
  it("refuses with exit 6 when nobody can confirm and --yes is missing, and sends nothing", async () => {
    const calls: unknown[] = [];
    const { out, deps, audit } = setup(batchClient({}).client);
    const code = await runEndpoint(publishEndpoint(calls), { id: 5, json: true }, deps);
    expect(code).toBe(6);
    expect(calls).toHaveLength(0);
    expect(audit).toHaveLength(0);
    const doc = JSON.parse(out.stdout);
    expect(doc).toMatchObject({ status: "refused", exitCode: 6 });
    expect(doc.errors[0].message).toMatch(/--yes/);
  });

  it("asks on a terminal and sends nothing when the answer is no", async () => {
    const calls: unknown[] = [];
    const { deps, audit } = setup(batchClient({}).client, { interactive: () => true, confirm: async () => false });
    expect(await runEndpoint(publishEndpoint(calls), { id: 5 }, deps)).toBe(6);
    expect(calls).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("asks on a terminal, naming the instance and locale, and runs on yes", async () => {
    const calls: unknown[] = [];
    const { client } = batchClient({ 77: [processed(77, [{ itemID: 5 }])] });
    const { deps, asked } = setup(client, { interactive: () => true });
    expect(await runEndpoint(publishEndpoint(calls), { id: 5, guid: "abc-u" }, deps)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(asked[0]).toMatch(/manage content publish id=5 will change data on abc-u \(en-us\)/);
  });

  it("--dry-run shows the plan, sends nothing and writes no audit entry", async () => {
    const calls: unknown[] = [];
    const { out, deps, audit } = setup(batchClient({}).client);
    const code = await runEndpoint(publishEndpoint(calls), { id: 5, dryRun: true }, deps);
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(audit).toHaveLength(0);
    expect(JSON.parse(out.stdout)).toEqual({
      dryRun: true,
      plan: {
        command: "manage content publish",
        effect: "write",
        guid: "env-guid-u",
        locale: "en-us",
        sdk: ["contentMethods.publishContent"],
        args: { id: 5 },
      },
    });
  });

  it("still runs the pre-write checks on --dry-run and reports their warnings", async () => {
    const e: Endpoint = { ...publishEndpoint(), checks: async () => ["item 5 changed"] };
    const { out, deps } = setup(batchClient({}).client);
    await runEndpoint(e, { id: 5, dryRun: true, json: true }, deps);
    expect(JSON.parse(out.stdout).warnings).toEqual(["item 5 changed"]);
  });

  it("turns a failing check into a warning, not a failure", async () => {
    const { client } = batchClient({ 77: [processed(77, [{ itemID: 5 }])] });
    const e: Endpoint = {
      ...publishEndpoint(),
      checks: async () => {
        throw new Error("read failed");
      },
    };
    const { out, deps } = setup(client);
    expect(await runEndpoint(e, { id: 5, yes: true, json: true }, deps)).toBe(0);
    expect(JSON.parse(out.stdout).warnings[0]).toMatch(/Couldn't run the pre-write checks: read failed/);
  });
});

describe("batched writes", () => {
  it("waits for the batch and reports the saved item IDs", async () => {
    const { client, calls } = batchClient({
      77: [{ batchID: 77, batchState: mgmtApi.BatchState.InProcess, items: [] }, processed(77, [{ itemID: 501 }])],
    });
    const { out, deps, audit } = setup(client);
    const code = await runEndpoint(publishEndpoint(), { id: 5, yes: true, json: true }, deps);
    expect(code).toBe(0);
    expect(calls).toEqual([77, 77]);
    const doc = JSON.parse(out.stdout);
    expect(doc.result).toEqual({ batchIDs: [77], itemIDs: [501] });
    expect(doc.items).toEqual([{ batchID: 77, itemID: 501, itemType: "Content", locale: "en-us", status: "ok" }]);
    expect(audit).toEqual([
      expect.objectContaining({
        command: "manage content publish",
        guid: "env-guid-u",
        locale: "en-us",
        args: { id: 5 },
        status: "ok",
        exitCode: 0,
        batchIDs: [77],
        itemIDs: [501],
      }),
    ]);
  });

  it("exits 1 and names each failed item when the batch processed with errors", async () => {
    const { client } = batchClient({
      77: [processed(77, [{ itemID: 501 }, { itemID: 502, errorMessage: "Field title is required" }])],
    });
    const { out, deps, audit } = setup(client);
    const code = await runEndpoint(publishEndpoint(), { id: 5, yes: true, json: true }, deps);
    expect(code).toBe(1);
    const doc = JSON.parse(out.stdout);
    expect(doc.status).toBe("error");
    expect(doc.result.itemIDs).toEqual([501]);
    expect(doc.items[1]).toMatchObject({ itemID: 502, status: "error", message: "Field title is required" });
    expect(doc.errors).toEqual([
      expect.objectContaining({
        status: "error",
        batchID: 77,
        itemID: 502,
        message: expect.stringContaining("Field title is required"),
      }),
    ]);
    expect(audit[0]).toMatchObject({ status: "error", exitCode: 1 });
  });

  it("--no-wait returns the batch IDs without polling", async () => {
    const { client, calls } = batchClient({});
    const { out, deps } = setup(client);
    expect(await runEndpoint(publishEndpoint(), { id: 5, yes: true, wait: false }, deps)).toBe(0);
    expect(calls).toEqual([]);
    expect(JSON.parse(out.stdout)).toEqual({ batchIDs: [77], waited: false });
  });

  it("gives up after the timeout, exits 1 and says how to check the batch later", async () => {
    const { client } = batchClient({ 77: [{ batchID: 77, batchState: mgmtApi.BatchState.Pending, items: [] }] });
    let t = 0;
    const { out, deps } = setup(client, {
      wait: { intervalMs: 1000, sleep: async () => undefined, now: () => (t += 1000) },
    });
    const code = await runEndpoint(publishEndpoint(), { id: 5, yes: true, json: true, timeout: 3 }, deps);
    expect(code).toBe(1);
    expect(JSON.parse(out.stdout).errors[0].message).toMatch(/still processing after 3s.*manage batch get 77/);
  });

  it("records a write the API rejected", async () => {
    const e: Endpoint = {
      ...publishEndpoint(),
      call: async () => {
        throw { statusCode: 404, message: "Unable to publish" };
      },
    };
    const { deps, audit } = setup(batchClient({}).client);
    expect(await runEndpoint(e, { id: 5, yes: true }, deps)).toBe(5);
    expect(audit[0]).toMatchObject({ status: "not_found", exitCode: 5, error: "Unable to publish" });
  });

  it("puts an audit failure in the warnings and still succeeds", async () => {
    const { client } = batchClient({ 77: [processed(77, [{ itemID: 5 }])] });
    const { out, deps } = setup(client, { audit: () => "Couldn't write the audit log" });
    expect(await runEndpoint(publishEndpoint(), { id: 5, yes: true, json: true }, deps)).toBe(0);
    expect(JSON.parse(out.stdout).warnings).toEqual(["Couldn't write the audit log"]);
  });
});

describe("waitForBatches", () => {
  it("reports a batch that failed without naming an item", async () => {
    const { client } = batchClient({
      9: [processed(9, [], { errorData: "Batch processor crashed" })],
    });
    const r = await waitForBatches(client, "g", [9], { intervalMs: 0, sleep: async () => undefined });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ batchID: 9, message: expect.stringContaining("Batch processor crashed") });
  });

  it("stops on a deleted batch", async () => {
    const { client } = batchClient({ 9: [{ batchID: 9, batchState: mgmtApi.BatchState.Deleted, items: [] }] });
    await expect(waitForBatches(client, "g", [9], { intervalMs: 0, sleep: async () => undefined })).rejects.toThrow(
      /deleted/
    );
  });
});

describe("folderMediaID", () => {
  function client(media: any) {
    const getAssetByUrl = jest.fn(async () => media);
    const c: any = {
      assetMethods: {
        getDefaultContainer: jest.fn(async () => ({ originUrl: "https://origin.example/inst/" })),
        getAssetByUrl,
      },
    };
    return { c, getAssetByUrl };
  }

  it("uses --media-id without a lookup", async () => {
    const { c, getAssetByUrl } = client(null);
    expect(await folderMediaID(c, "g", "a/b", 7)).toBe(7);
    expect(getAssetByUrl).not.toHaveBeenCalled();
  });

  it("looks the folder up by its encoded origin URL", async () => {
    const { c, getAssetByUrl } = client({ mediaID: 12, isFolder: true });
    expect(await folderMediaID(c, "g", "/my folder/b&c/", undefined)).toBe(12);
    expect(getAssetByUrl).toHaveBeenCalledWith(encodeURIComponent("https://origin.example/inst/my folder/b&c"), "g");
  });

  it("refuses a file and an empty path", async () => {
    await expect(
      folderMediaID(client({ mediaID: 3, isFolder: false }).c, "g", "x.png", undefined)
    ).rejects.toMatchObject({
      status: "not_found",
    });
    await expect(folderMediaID(client(null).c, "g", "/", undefined)).rejects.toMatchObject({ status: "usage" });
    const missing = client(null);
    missing.getAssetByUrl.mockRejectedValue(new CliError("not_found", "raw 404", 404));
    await expect(folderMediaID(missing.c, "g", "gone", undefined)).rejects.toThrow(/^gone isn't an asset folder/);
  });
});

describe("itemError", () => {
  it("keeps the message of a JSON error and drops the stack trace", () => {
    const raw = JSON.stringify({ message: "Unable to publish item 9.", stackTrace: "at X.Y()" });
    expect(itemError(raw)).toBe("Unable to publish item 9.");
  });
  it("returns plain text as it is, and empty for nothing", () => {
    expect(itemError("plain failure")).toBe("plain failure");
    expect(itemError("{not json")).toBe("{not json");
    expect(itemError(null)).toBe("");
  });
});

describe("batchIDsOf", () => {
  it("accepts the SDK's [batchID] and a bare number, and rejects nothing", () => {
    expect(batchIDsOf([12])).toEqual([12]);
    expect(batchIDsOf(12)).toEqual([12]);
    expect(() => batchIDsOf([])).toThrow(/batch ID/);
    expect(() => batchIDsOf(undefined)).toThrow(/batch ID/);
  });
});

describe("versionWarnings", () => {
  const current: Record<number, any> = { 1: { properties: { versionID: 10 } }, 2: { properties: { versionID: 20 } } };
  const read = async (id: number) => {
    if (!current[id]) throw new Error("404");
    return current[id];
  };

  it("warns only for items whose version moved on", async () => {
    const items = [
      { contentID: 1, properties: { versionID: 10 } },
      { contentID: 2, properties: { versionID: 19 } },
      { contentID: -1, properties: { versionID: 0 } },
      { contentID: 3, properties: { versionID: 5 } },
      { contentID: 1, properties: {} },
    ];
    const w = await versionWarnings(items, (i) => i.contentID, read, "Content item");
    expect(w).toEqual([
      "Content item 2 changed since it was read (versionID 19, now 20). Saving anyway: the last write wins.",
    ]);
  });
});

describe("plan and prompt", () => {
  it("summarises a JSON body as a hash and size, never the body", () => {
    const e: Endpoint = {
      resource: "content",
      action: "save",
      describe: "",
      effect: "write",
      sdk: ["contentMethods.saveContentItems"],
      args: [flag("data", "json", "")],
      needsLocale: true,
      call: async () => null,
    };
    const plan = planOf(e, { guid: "g", locale: "en-us", data: [{ fields: { secret: "x" } }] }, "manage content save");
    expect(JSON.stringify(plan)).not.toContain("secret");
    expect(plan.args.data).toMatchObject({
      count: 1,
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("puts warnings before the question and shouts on a delete", () => {
    const text = confirmQuestion(
      { command: "manage page delete", effect: "delete", guid: "g", locale: "en-us", sdk: [], args: { id: 4 } },
      ["Page 4 changed"]
    );
    expect(text.split("\n")).toEqual([
      "warning: Page 4 changed",
      "manage page delete id=4 will DELETE data on g (en-us). Continue? [y/N] ",
    ]);
  });
});

describe("audit log", () => {
  it("appends one JSON line per write, creating the folder", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-")), "nested", "audit.jsonl");
    const entry: AuditEntry = {
      at: "t",
      cliVersion: "v",
      command: "manage model delete",
      guid: "g",
      args: { id: 1 },
      status: "ok",
      exitCode: 0,
    };
    expect(appendAudit(entry, file)).toBeNull();
    expect(appendAudit(entry, file)).toBeNull();
    expect(
      fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    ).toEqual([entry, entry]);
  });

  it("can be turned off or moved", () => {
    expect(auditLogPath({ AGILITY_AUDIT_LOG: "off" })).toBeNull();
    expect(auditLogPath({ AGILITY_AUDIT_LOG: "/x/y.jsonl" })).toBe("/x/y.jsonl");
    expect(auditLogPath({})).toMatch(/\.agility[/\\]manage-audit\.jsonl$/);
  });

  it("returns a warning instead of throwing when it can't write", () => {
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-")), "file");
    fs.writeFileSync(blocker, "");
    expect(appendAudit({} as AuditEntry, path.join(blocker, "audit.jsonl"))).toMatch(/Couldn't write the audit log/);
  });
});

describe("manage request", () => {
  it("accepts an instance-relative path", () => {
    expect(requestPath("/en-us/item/1?x=1")).toBe("en-us/item/1?x=1");
  });

  it.each(["https://evil.test/x", "a/../../other-guid/x", "a/%2e%2E/x", "a%2f..%2fx", ""])("refuses %j", (p) => {
    expect(() => requestPath(p)).toThrow();
  });

  it("classifies the method", () => {
    expect(requestEndpoint("get").effect).toBe("read");
    expect(requestEndpoint("POST").effect).toBe("write");
    expect(requestEndpoint("delete").effect).toBe("delete");
    expect(() => requestEndpoint("PATCH")).toThrow(/GET, POST, PUT, DELETE/);
  });

  it("goes through the write guards", async () => {
    const { deps } = setup({});
    expect(await runEndpoint(requestEndpoint("DELETE"), { path: "locales/fr-ca" }, deps)).toBe(6);
  });
});

describe("q", () => {
  it("encodes query values and sends an omitted one as empty", () => {
    expect(q("/My Folder/a+b")).toBe("%2FMy%20Folder%2Fa%2Bb");
    expect(q(undefined)).toBe("");
    expect(q(null)).toBe("");
    expect(q(0)).toBe("0");
  });
});

describe("messageOf", () => {
  it("adds the server's explanation from an HTTP error", () => {
    expect(
      messageOf({ message: "Request failed with status code 400", response: { data: { message: "Bad model" } } })
    ).toBe("Request failed with status code 400: Bad model");
    expect(messageOf({ message: "Unable to save", innerError: { response: { data: "Reference name taken" } } })).toBe(
      "Unable to save: Reference name taken"
    );
    expect(messageOf({ message: "Not found: gone", response: { data: "gone" } })).toBe("Not found: gone");
  });
});
