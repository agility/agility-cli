import { resetState, state } from "core/state";
import { saveUrlRedirections, MAX_URL_REDIRECTION_BATCH_SIZE } from "../url-redirection-api";

// Mock core/auth so no keytar / network calls are made.
jest.mock("core/auth", () => {
  return {
    Auth: jest.fn().mockImplementation(() => ({
      getToken: jest.fn().mockResolvedValue("test-token"),
      determineBaseUrl: jest.fn().mockReturnValue("https://mgmt.test"),
    })),
  };
});

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePayload(urlRedirectionID = 0, originUrl = "/a", destinationUrl = "/b", httpCode = 301): any {
  return { urlRedirectionID, originUrl, destinationUrl, httpCode };
}

function makeOkResponse(body: any): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, statusText: string, body = ""): Response {
  return {
    ok: false,
    status,
    statusText,
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

// ─── MAX_URL_REDIRECTION_BATCH_SIZE guard ─────────────────────────────────────

describe("saveUrlRedirections — MAX_URL_REDIRECTION_BATCH_SIZE guard", () => {
  it("throws when payload length exceeds 250", async () => {
    const payloads = Array.from({ length: 251 }, (_, i) => makePayload(0, `/url-${i}`));
    await expect(saveUrlRedirections("test-guid-u", payloads)).rejects.toThrow(/250/);
  });

  it("does not throw when payload is exactly 250", async () => {
    const payloads = Array.from({ length: 250 }, (_, i) => makePayload(0, `/url-${i}`));
    global.fetch = jest.fn().mockResolvedValue(
      makeOkResponse({ created: [], updated: [], skipped: [] })
    ) as any;
    await expect(saveUrlRedirections("test-guid-u", payloads)).resolves.not.toThrow();
  });

  it("MAX_URL_REDIRECTION_BATCH_SIZE is 250", () => {
    expect(MAX_URL_REDIRECTION_BATCH_SIZE).toBe(250);
  });
});

// ─── non-ok response ──────────────────────────────────────────────────────────

describe("saveUrlRedirections — non-ok HTTP response", () => {
  it("throws an error containing status when response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeErrorResponse(400, "Bad Request", "invalid payload")) as any;
    await expect(saveUrlRedirections("test-guid-u", [makePayload()])).rejects.toThrow(/400/);
  });

  it("includes the response body in the error message when available", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeErrorResponse(422, "Unprocessable Entity", "origin URL already exists")) as any;
    await expect(saveUrlRedirections("test-guid-u", [makePayload()])).rejects.toThrow(
      /origin URL already exists/
    );
  });

  it("still throws when response.text() rejects (best-effort body)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: jest.fn().mockRejectedValue(new Error("stream error")),
    }) as any;
    await expect(saveUrlRedirections("test-guid-u", [makePayload()])).rejects.toThrow(/500/);
  });
});

// ─── response normalization (missing arrays) ──────────────────────────────────

describe("saveUrlRedirections — response normalization", () => {
  it("defaults missing created/updated/skipped to empty arrays", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeOkResponse({})) as any;
    const result = await saveUrlRedirections("test-guid-u", [makePayload()]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("defaults only missing fields when partial result is returned", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeOkResponse({ created: [{ index: 0, urlRedirectionID: 5 }] })) as any;
    const result = await saveUrlRedirections("test-guid-u", [makePayload()]);
    expect(result.created).toHaveLength(1);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("returns null result normalized to empty arrays", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeOkResponse(null)) as any;
    const result = await saveUrlRedirections("test-guid-u", [makePayload()]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

// ─── correct URL, method, headers, and body ───────────────────────────────────

describe("saveUrlRedirections — fetch call shape", () => {
  it("sends a POST to the correct URL with Authorization and Content-Type headers", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(makeOkResponse({ created: [], updated: [], skipped: [] }));
    global.fetch = mockFetch as any;

    const guid = "test-guid-u";
    await saveUrlRedirections(guid, [makePayload(0, "/src", "/dst")]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://mgmt.test/api/v1/instance/${guid}/url-redirections`);
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer test-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("serialises the payloads array as the request body", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(makeOkResponse({ created: [], updated: [], skipped: [] }));
    global.fetch = mockFetch as any;

    const payloads = [makePayload(0, "/x", "/y", 302), makePayload(3, "/old", "/new", 301)];
    await saveUrlRedirections("test-guid-u", payloads);

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(payloads);
  });

  it("uses state.baseUrl instead of determineBaseUrl when set", async () => {
    state.baseUrl = "https://custom-base.example.com";
    const mockFetch = jest
      .fn()
      .mockResolvedValue(makeOkResponse({ created: [], updated: [], skipped: [] }));
    global.fetch = mockFetch as any;

    await saveUrlRedirections("test-guid-u", [makePayload()]);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("https://custom-base.example.com");
  });
});
