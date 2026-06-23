import { Auth } from "../auth";
import { resetState, setState, getState } from "../state";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  // Clear argv token flags between tests
  process.argv = ["node", "script.js"];
  delete process.env.AGILITY_TOKEN;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── getEnv ────────────────────────────────────────────────────────────────────

describe("Auth.getEnv", () => {
  it('returns "prod" by default', () => {
    const auth = new Auth();
    expect(auth.getEnv()).toBe("prod");
  });

  it('returns "dev" when state.dev is true', () => {
    setState({ dev: true });
    const auth = new Auth();
    expect(auth.getEnv()).toBe("dev");
  });
});

// ─── getEnvKey ─────────────────────────────────────────────────────────────────

describe("Auth.getEnvKey", () => {
  it("returns the correct key format for prod", () => {
    const auth = new Auth();
    expect(auth.getEnvKey("prod")).toBe("cli-auth-token:prod");
  });

  it("returns the correct key format for dev", () => {
    const auth = new Auth();
    expect(auth.getEnvKey("dev")).toBe("cli-auth-token:dev");
  });
});

// ─── determineBaseUrl ──────────────────────────────────────────────────────────

describe("Auth.determineBaseUrl", () => {
  it('returns US mgmt URL for GUID ending in "u"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-guid-u")).toBe("https://mgmt.aglty.io");
  });

  it('returns CA mgmt URL for GUID ending in "c"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-guid-c")).toBe("https://mgmt-ca.aglty.io");
  });

  it('returns EU mgmt URL for GUID ending in "e"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-e")).toBe("https://mgmt-eu.aglty.io");
  });

  it('returns AUS mgmt URL for GUID ending in "a"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-a")).toBe("https://mgmt-aus.aglty.io");
  });

  it('returns dev URL for GUID ending in "d"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-d")).toBe("https://mgmt-dev.aglty.io");
  });

  it('returns US2 URL for GUID ending in "us2"', () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl("my-instance-us2")).toBe("https://mgmt-usa2.aglty.io");
  });

  it("returns dev URL when state.dev is true", () => {
    setState({ dev: true });
    const auth = new Auth();
    expect(auth.determineBaseUrl("any-guid")).toBe("https://mgmt-dev.aglty.io");
  });

  it("returns default US URL when no GUID is given and no state flags", () => {
    const auth = new Auth();
    expect(auth.determineBaseUrl()).toBe("https://mgmt.aglty.io");
  });

  it("falls back to sourceGuid[0] when no explicit guid is provided", () => {
    setState({ sourceGuid: "my-guid-c" });
    const auth = new Auth();
    expect(auth.determineBaseUrl()).toBe("https://mgmt-ca.aglty.io");
  });
});

// ─── determineFetchUrl ────────────────────────────────────────────────────────

describe("Auth.determineFetchUrl", () => {
  it('returns US fetch URL for GUID ending in "u"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-u")).toBe("https://api.aglty.io");
  });

  it('returns CA fetch URL for GUID ending in "c"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-c")).toBe("https://api-ca.aglty.io");
  });

  it('returns EU fetch URL for GUID ending in "e"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-e")).toBe("https://api-eu.aglty.io");
  });

  it('returns AUS fetch URL for GUID ending in "a"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-a")).toBe("https://api-aus.aglty.io");
  });

  it('returns dev fetch URL for GUID ending in "d"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-d")).toBe("https://api-dev.aglty.io");
  });

  it('returns US2 fetch URL for GUID ending in "us2"', () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl("my-guid-us2")).toBe("https://api-usa2.aglty.io");
  });

  it("returns default US fetch URL when no guid provided", () => {
    const auth = new Auth();
    expect(auth.determineFetchUrl()).toBe("https://api.aglty.io");
  });
});

// ─── determineCloudMgmtUrl ────────────────────────────────────────────────────

describe("Auth.determineCloudMgmtUrl", () => {
  it("always returns cloud URL even when local flag is set", () => {
    setState({ local: true });
    const auth = new Auth();
    expect(auth.determineCloudMgmtUrl("my-guid-u")).toBe("https://mgmt.aglty.io");
  });

  it('returns CA cloud mgmt URL for GUID ending in "c"', () => {
    const auth = new Auth();
    expect(auth.determineCloudMgmtUrl("my-guid-c")).toBe("https://mgmt-ca.aglty.io");
  });
});

// ─── getBaseUrl ───────────────────────────────────────────────────────────────

describe("Auth.getBaseUrl", () => {
  it("appends /oauth to the management base URL", () => {
    const auth = new Auth();
    const result = auth.getBaseUrl("my-guid-u");
    expect(result).toBe("https://mgmt.aglty.io/oauth");
  });
});

// ─── generateCode ─────────────────────────────────────────────────────────────

describe("Auth.generateCode", () => {
  it("returns a 6-character alphanumeric code", async () => {
    const auth = new Auth();
    const code = await auth.generateCode();
    expect(code).toMatch(/^[a-z0-9]{6}$/);
  });

  it("generates different codes on successive calls", async () => {
    const auth = new Auth();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(await auth.generateCode());
    }
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ─── validateAndResolveParams ─────────────────────────────────────────────────

describe("Auth.validateAndResolveParams", () => {
  it("returns params from args when all are provided", () => {
    const auth = new Auth();
    const result = auth.validateAndResolveParams(
      { sourceGuid: "guid1", targetGuid: "guid2", locale: "en-us", channel: "website" },
      []
    );
    expect(result.sourceGuid).toBe("guid1");
    expect(result.targetGuid).toBe("guid2");
    expect(result.locale).toBe("en-us");
    expect(result.channel).toBe("website");
  });

  it("throws when a required field is missing", () => {
    const auth = new Auth();
    expect(() => auth.validateAndResolveParams({ targetGuid: "guid2" }, ["sourceGuid"])).toThrow();
  });

  it("throws with helpful message for missing sourceGuid", () => {
    const auth = new Auth();
    expect(() => auth.validateAndResolveParams({}, ["sourceGuid"])).toThrow(/sourceGuid/i);
  });

  it("throws with helpful message for missing targetGuid", () => {
    const auth = new Auth();
    expect(() => auth.validateAndResolveParams({}, ["targetGuid"])).toThrow(/targetGuid/i);
  });

  it("does not throw when no fields are required", () => {
    const auth = new Auth();
    expect(() => auth.validateAndResolveParams({}, [])).not.toThrow();
  });
});
