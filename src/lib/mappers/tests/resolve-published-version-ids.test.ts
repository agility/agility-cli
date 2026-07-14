import { resolvePublishedVersionIDs, ObservedItem, PollDeps } from "../resolve-published-version-ids";

// Injected deps that never touch the network or real timers.
function makeDeps(overrides: Partial<PollDeps> = {}): Partial<PollDeps> {
  return {
    getStatus: jest.fn().mockResolvedValue({ inProgress: false }),
    waitForSync: jest.fn().mockResolvedValue(undefined),
    sleep: jest.fn().mockResolvedValue(undefined),
    now: () => 1_000, // constant clock → termination is driven by maxIterations, not wall-clock
    ...overrides,
  };
}

const obs = (versionID: number): ObservedItem => ({ versionID });

describe("resolvePublishedVersionIDs", () => {
  it("resolves an item once its versionID diverges from the baseline", async () => {
    const fetchItem = jest.fn().mockResolvedValue(obs(7));

    const result = await resolvePublishedVersionIDs([{ id: 1, baseline: 5 }], fetchItem, {
      guid: "g",
      deps: makeDeps(),
    });

    expect(result.resolved.get(1)).toEqual(obs(7));
    expect(result.missingCreates).toEqual([]);
    expect(result.unchangedUpdates).toEqual([]);
  });

  it("resolves a created item (baseline 0) as soon as it appears", async () => {
    const fetchItem = jest.fn().mockResolvedValue(obs(2));

    const result = await resolvePublishedVersionIDs([{ id: 4, baseline: 0 }], fetchItem, {
      guid: "g",
      deps: makeDeps(),
    });

    expect(result.resolved.get(4)).toEqual(obs(2));
    expect(result.missingCreates).toEqual([]);
  });

  it("classifies a new item that never appears as a missing create (non-blocking)", async () => {
    const fetchItem = jest.fn().mockResolvedValue(null); // never on the CDN

    const result = await resolvePublishedVersionIDs([{ id: 2, baseline: 0 }], fetchItem, {
      guid: "g",
      maxIterations: 3,
      deps: makeDeps(),
    });

    expect(result.resolved.size).toBe(0);
    expect(result.missingCreates).toEqual([2]);
    expect(result.unchangedUpdates).toEqual([]);
  });

  it("keeps a no-op update (baseline never diverges) with no error", async () => {
    const fetchItem = jest.fn().mockResolvedValue(obs(9)); // same as baseline forever

    const result = await resolvePublishedVersionIDs([{ id: 3, baseline: 9 }], fetchItem, {
      guid: "g",
      maxIterations: 3,
      deps: makeDeps(),
    });

    expect(result.resolved.size).toBe(0);
    expect(result.missingCreates).toEqual([]);
    expect(result.unchangedUpdates).toEqual([3]);
  });

  it("flags a never-observed item as missing even with a non-zero baseline (created items carry a create-time version)", async () => {
    const fetchItem = jest.fn().mockResolvedValue(null); // never on the CDN

    const result = await resolvePublishedVersionIDs([{ id: 8, baseline: 42 }], fetchItem, {
      guid: "g",
      maxIterations: 3,
      deps: makeDeps(),
    });

    // Classification keys off "never observed", not baseline === 0, so a created
    // item that already had a create-time versionID is still surfaced (not kept silently).
    expect(result.resolved.size).toBe(0);
    expect(result.missingCreates).toEqual([8]);
    expect(result.unchangedUpdates).toEqual([]);
  });

  it("backs off with sleep when no sync is in progress, then resolves on a later poll", async () => {
    const fetchItem = jest
      .fn()
      .mockResolvedValueOnce(null) // first poll: not propagated yet
      .mockResolvedValueOnce(obs(2)); // second poll: appeared
    const deps = makeDeps();

    const result = await resolvePublishedVersionIDs([{ id: 4, baseline: 0 }], fetchItem, {
      guid: "g",
      backoffMs: 1234,
      deps,
    });

    expect(result.resolved.get(4)).toEqual(obs(2));
    expect(deps.sleep).toHaveBeenCalledWith(1234); // backoff was used in the race window
    expect(deps.waitForSync).not.toHaveBeenCalled(); // no sync was in progress
  });

  it("waits for an in-progress sync instead of sleeping", async () => {
    const fetchItem = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(obs(3));
    const deps = makeDeps({
      getStatus: jest
        .fn()
        .mockResolvedValueOnce({ inProgress: true }) // first iteration: sync running
        .mockResolvedValue({ inProgress: false }),
    });

    const result = await resolvePublishedVersionIDs([{ id: 5, baseline: 1 }], fetchItem, {
      guid: "g",
      deps,
    });

    expect(result.resolved.get(5)).toEqual(obs(3));
    expect(deps.waitForSync).toHaveBeenCalledTimes(1);
  });
});
