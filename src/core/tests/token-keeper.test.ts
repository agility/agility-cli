import {
  TokenKeeper,
  canRefresh,
  mergeRefreshedToken,
  msUntilExpiry,
  REFRESH_WITHIN_MS,
  StoredLoginToken,
} from "../token-keeper";

const NOW = Date.parse("2026-11-25T16:00:00Z");

/** A 24-hour token with `minutesLeft` minutes to go at NOW. */
function token(minutesLeft: number, refresh: string | null = "rt-1"): StoredLoginToken {
  const issued = NOW - (24 * 60 - minutesLeft) * 60000;
  return { access_token: "at-1", expires_in: 86400, refresh_token: refresh, timestamp: new Date(issued).toISOString() };
}

describe("token lifetime helpers (PROD-3449)", () => {
  it("measures the time left from the timestamp and expires_in", () => {
    expect(msUntilExpiry(token(30), NOW)).toBe(30 * 60000);
    expect(msUntilExpiry({ access_token: "x" }, NOW)).toBeNull();
  });

  it("can refresh only with a refresh token", () => {
    expect(canRefresh(token(30))).toBe(true);
    expect(canRefresh(token(30, null))).toBe(false);
  });

  it("keeps the old refresh token when the refresh returns none", () => {
    const merged = mergeRefreshedToken(token(5), { access_token: "at-2", expires_in: 86400 }, new Date(NOW));
    expect(merged).toMatchObject({
      access_token: "at-2",
      refresh_token: "rt-1",
      timestamp: new Date(NOW).toISOString(),
    });
    expect(mergeRefreshedToken(token(5), { access_token: "at-3", refresh_token: "rt-2" }).refresh_token).toBe("rt-2");
  });
});

describe("TokenKeeper (PROD-3449)", () => {
  function keeper(current: StoredLoginToken | null, refreshResult: boolean | Error = true) {
    const refresh = jest.fn(async () => {
      if (refreshResult instanceof Error) throw refreshResult;
      return refreshResult;
    });
    const warn = jest.fn();
    const k = new TokenKeeper({ readToken: async () => current, refresh, warn, now: () => NOW });
    return { k, refresh, warn };
  }

  it("leaves a token with plenty of time alone", async () => {
    const { k, refresh } = keeper(token(120));
    await expect(k.check()).resolves.toBe("not-needed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes a token about to expire", async () => {
    const { k, refresh } = keeper(token(REFRESH_WITHIN_MS / 60000 - 1));
    await expect(k.check()).resolves.toBe("refreshed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("can't refresh a login without a refresh token", async () => {
    const { k, refresh } = keeper(token(5, null));
    await expect(k.check()).resolves.toBe("cannot-refresh");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("warns once when refreshing fails", async () => {
    const { k, warn } = keeper(token(5), new Error("HTTP 401"));
    await expect(k.check()).resolves.toBe("failed");
    await expect(k.check()).resolves.toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("HTTP 401");
  });

  /** A fake JWT for `sub` expiring `minutesLeft` after NOW. */
  function jwt(sub: string, minutesLeft: number, tag = ""): string {
    const enc = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${enc({ alg: "none" })}.${enc({ sub, exp: Math.floor((NOW + minutesLeft * 60000) / 1000), tag })}.sig`;
  }

  function adoptKeeper(stored: string, inUse: string) {
    const adopt = jest.fn();
    const refresh = jest.fn(async () => true);
    const warn = jest.fn();
    const k = new TokenKeeper({
      readToken: async () => ({ ...token(24 * 60 - 5), access_token: stored }),
      refresh,
      inUseToken: () => inUse,
      adopt,
      warn,
      now: () => NOW,
    });
    return { k, adopt, refresh, warn };
  }

  it("takes over a newer token of the same login once its own is about to expire", async () => {
    const { k, adopt, refresh } = adoptKeeper(jwt("user-a", 24 * 60, "new"), jwt("user-a", 5));
    await expect(k.check()).resolves.toBe("adopted");
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps its own token while it still has time, even if the same login was refreshed elsewhere", async () => {
    const { k, adopt } = adoptKeeper(jwt("user-a", 24 * 60, "new"), jwt("user-a", 120));
    await expect(k.check()).resolves.toBe("not-needed");
    expect(adopt).not.toHaveBeenCalled();
  });

  it("never switches to another account's login, and warns once", async () => {
    const { k, adopt, refresh, warn } = adoptKeeper(jwt("user-b", 24 * 60), jwt("user-a", 5));
    await expect(k.check()).resolves.toBe("other-login");
    await expect(k.check()).resolves.toBe("other-login");
    expect(adopt).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("checks once as soon as it starts", async () => {
    const readToken = jest.fn(async () => token(5));
    const refresh = jest.fn(async () => true);
    const k = new TokenKeeper({ readToken, refresh, warn: () => {}, now: () => NOW, setInterval: () => ({}) });
    k.start();
    await new Promise((r) => setImmediate(r));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts one timer, which doesn't hold the process open, and stops it", () => {
    const handle = { unref: jest.fn() };
    const set = jest.fn(() => handle);
    const clear = jest.fn();
    const k = new TokenKeeper({
      readToken: async () => null,
      refresh: async () => true,
      warn: () => {},
      setInterval: set,
      clearInterval: clear,
    });
    k.start(1000);
    k.start(1000);
    expect(set).toHaveBeenCalledTimes(1);
    expect(handle.unref).toHaveBeenCalled();
    k.stop();
    expect(clear).toHaveBeenCalledWith(handle);
  });
});
