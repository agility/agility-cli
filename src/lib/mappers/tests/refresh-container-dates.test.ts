import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { state, resetState, setState } from "../../../core/state";
import { advanceContainerDates, refreshContainerDatesAfterPageSaves } from "../refresh-container-dates";

const T0 = "10/30/2026 10:00AM"; // recorded at the last sync
const T1 = "10/30/2026 10:05AM"; // set by this run's page save
const TX = "10/30/2026 09:30AM"; // older

const record = (id: number, date: string) => ({ sourceContentViewID: id - 100, targetContentViewID: id, targetLastModifiedDate: date });

describe("advanceContainerDates", () => {
  it("advances a container that was in sync at the start and was bumped during the run", () => {
    const records = [record(101, T0)];

    const updates = advanceContainerDates(records, new Map([[101, T0]]), new Map([[101, T1]]));

    expect(updates).toEqual([{ targetContentViewID: 101, from: T0, to: T1 }]);
    expect(records[0].targetLastModifiedDate).toBe(T1);
  });

  it("keeps the conflict for a container already changed on the target before the run", () => {
    // The pull already had a date after the mapping: a real target edit.
    const records = [record(101, T0)];

    const updates = advanceContainerDates(records, new Map([[101, T1]]), new Map([[101, "10/30/2026 10:10AM"]]));

    expect(updates).toEqual([]);
    expect(records[0].targetLastModifiedDate).toBe(T0);
  });

  it("leaves a container whose date didn't move", () => {
    const records = [record(101, T0)];

    expect(advanceContainerDates(records, new Map([[101, T0]]), new Map([[101, T0]]))).toEqual([]);
  });

  it("counts a pulled date older than the mapping as in sync", () => {
    const records = [record(101, T0)];

    expect(advanceContainerDates(records, new Map([[101, TX]]), new Map([[101, T1]]))).toHaveLength(1);
  });

  it("treats a container missing from the pull (created this run) as in sync", () => {
    const records = [record(101, T0)];

    expect(advanceContainerDates(records, new Map(), new Map([[101, T1]]))).toHaveLength(1);
  });

  it("skips records it can't read and containers no longer on the target", () => {
    const records = [record(101, "not a date"), record(102, T0), { targetContentViewID: 0, targetLastModifiedDate: T0 }];

    expect(advanceContainerDates(records, new Map(), new Map([[101, T1]]))).toEqual([]);
  });
});

describe("refreshContainerDatesAfterPageSaves", () => {
  const SRC = "src-1";
  const TGT = "tgt-1";
  let root: string;
  const mappingFile = () => path.join(root, "mappings", `${SRC}-${TGT}`, "containers", "mappings.json");

  const writeJson = (rel: string, data: any) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "container-dates-"));
    // 130: a page's component container, in sync. 131: edited on the target before this run.
    writeJson(`${TGT}/containers/130.json`, { contentViewID: 130, referenceName: "home_heading", lastModifiedDate: T0 });
    writeJson(`${TGT}/containers/131.json`, { contentViewID: 131, referenceName: "posts", lastModifiedDate: T1 });
    writeJson(`mappings/${SRC}-${TGT}/containers/mappings.json`, [record(130, T0), record(131, T0)]);

    resetState();
    setState({ rootPath: root, sourceGuid: SRC, targetGuid: TGT, locales: "en-us", isSync: true });
    state.cachedApiClient = {
      containerMethods: {
        getContainerList: jest.fn(async () => [
          { contentViewID: 130, lastModifiedDate: T1 },
          { contentViewID: 131, lastModifiedDate: "10/30/2026 10:10AM" },
        ]),
      },
    } as any;
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("advances only the container the page save bumped, and saves the mapping", async () => {
    const count = await refreshContainerDatesAfterPageSaves(SRC, TGT, "en-us");

    expect(count).toBe(1);
    const saved = JSON.parse(fs.readFileSync(mappingFile(), "utf8"));
    expect(saved.find((r: any) => r.targetContentViewID === 130).targetLastModifiedDate).toBe(T1);
    expect(saved.find((r: any) => r.targetContentViewID === 131).targetLastModifiedDate).toBe(T0);
  });

  it("does nothing in preflight", async () => {
    state.preflight = true;

    expect(await refreshContainerDatesAfterPageSaves(SRC, TGT, "en-us")).toBe(0);
    expect((state.cachedApiClient as any).containerMethods.getContainerList).not.toHaveBeenCalled();
  });

  it("is bookkeeping only: an API error doesn't throw", async () => {
    (state.cachedApiClient as any).containerMethods.getContainerList.mockRejectedValueOnce(new Error("busy"));

    await expect(refreshContainerDatesAfterPageSaves(SRC, TGT, "en-us")).resolves.toBe(0);
  });
});
