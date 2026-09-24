import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { removeLocalJsonNotIn, removeLocalJsonOlderThan, clearLocalJson } from "lib/downloaders/reconcile-local-files";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-reconcile-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, mtimeMs?: number) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "{}");
  if (mtimeMs !== undefined) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

describe("removeLocalJsonNotIn (PROD-2614)", () => {
  it("deletes json files whose id is not in the live list and keeps the rest", () => {
    write("1.json"); write("12.json"); write("20.json");
    const log = jest.fn();
    const removed = removeLocalJsonNotIn(dir, [1, "20"], "template", log);
    expect(removed.sort()).toEqual(["12"]);
    expect(fs.existsSync(path.join(dir, "1.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "20.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "12.json"))).toBe(false);
    expect(log).toHaveBeenCalledWith("Removed deleted template file: 12.json");
  });

  it("leaves non-json entries (binary sub-folders, other files) alone", () => {
    write("images/logo.png"); write("notes.txt"); write("5.json");
    removeLocalJsonNotIn(dir, [], "asset");
    expect(fs.existsSync(path.join(dir, "images/logo.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "5.json"))).toBe(false);
  });

  it("is a no-op for a folder that does not exist", () => {
    expect(removeLocalJsonNotIn(path.join(dir, "missing"), [1], "x")).toEqual([]);
  });
});

describe("removeLocalJsonOlderThan (PROD-2614)", () => {
  it("deletes only files last written before the cutoff", () => {
    const now = Date.now();
    write("old.json", now - 60_000);
    write("fresh.json", now);
    const removed = removeLocalJsonOlderThan(dir, now - 2000, "content [en-us]");
    expect(removed).toEqual(["old"]);
    expect(fs.existsSync(path.join(dir, "fresh.json"))).toBe(true);
  });

  it("is a no-op for a folder that does not exist", () => {
    expect(removeLocalJsonOlderThan(path.join(dir, "missing"), Date.now(), "x")).toEqual([]);
  });
});

describe("clearLocalJson (PROD-2614)", () => {
  it("removes every json file in the folder and reports the count", () => {
    write("a.json"); write("b.json"); write("keep.txt");
    expect(clearLocalJson(dir)).toBe(2);
    expect(fs.readdirSync(dir)).toEqual(["keep.txt"]);
    expect(clearLocalJson(path.join(dir, "missing"))).toBe(0);
  });
});
