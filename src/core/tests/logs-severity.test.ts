import { Logs, LogEntry, collapseErrorBody } from "../logs";
import { resetState } from "../state";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The entries a Logs instance has accumulated. Private on the class; read directly for assertions. */
const entriesOf = (logs: Logs): LogEntry[] => (logs as any).logs as LogEntry[];
const lastEntry = (logs: Logs): LogEntry => {
  const all = entriesOf(logs);
  return all[all.length - 1];
};

// ─── PROD-2533: severity follows status ────────────────────────────────────────

describe("logDataElement severity", () => {
  it("writes a failed element at ERROR", () => {
    const logs = new Logs("push");
    logs.logDataElement("content", "error", "failed", "Item", "guid", "boom", "en-us");
    expect(lastEntry(logs).logLevel).toBe("ERROR");
  });

  it("writes a conflict at WARN", () => {
    const logs = new Logs("push");
    logs.logDataElement("content", "uploaded", "conflict", "Item", "guid", "clash", "en-us");
    expect(lastEntry(logs).logLevel).toBe("WARN");
  });

  it("leaves success and skipped at INFO", () => {
    const logs = new Logs("push");
    logs.logDataElement("content", "created", "success", "Item", "guid", undefined, "en-us");
    expect(lastEntry(logs).logLevel).toBe("INFO");

    logs.logDataElement("model", "skipped", "skipped", "Model", "guid");
    expect(lastEntry(logs).logLevel).toBe("INFO");
  });

  it("a failed run is detectable by severity alone", () => {
    // The Brightstar run (PROD-2511) was 4,306 lines, every one INFO, so `grep ERROR` found
    // nothing on a sync that dropped 30 Components. A mixed run must not read that way.
    const logs = new Logs("push");
    logs.logDataElement("content", "created", "success", "Ok1", "guid", undefined, "en-us");
    logs.logDataElement("content", "created", "success", "Ok2", "guid", undefined, "en-us");
    logs.logDataElement("content", "error", "failed", "Bad", "guid", "nulls", "en-us");

    const levels = entriesOf(logs).map((e) => e.logLevel);
    expect(levels.filter((l) => l === "ERROR")).toHaveLength(1);
    expect(levels.filter((l) => l === "INFO")).toHaveLength(2);
  });
});

// ─── PROD-2533: upstream HTML error bodies collapse to one line ────────────────

describe("collapseErrorBody", () => {
  // Verbatim shape of the body that put 17 unlevelled lines into the Brightstar push log.
  const fastly503 = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"',
    ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
    "<html>",
    "  <head>",
    "    <title>503 first byte timeout</title>",
    "  </head>",
    "  <body>",
    "    <h1>Error 503 first byte timeout</h1>",
    "    <p>first byte timeout</p>",
    "    <h3>Error 54113</h3>",
    "    <p>Details: cache-dfw-kdal2120056-DFW 1789131586 210865483</p>",
    "    <hr>",
    "    <p>Varnish cache server</p>",
    "  </body>",
    "</html>",
  ].join("\n");

  it("reduces an HTML error page to a single line", () => {
    const out = collapseErrorBody(fastly503);
    expect(out).not.toContain("\n");
    expect(out).not.toContain("<html");
    expect(out).not.toContain("<!DOCTYPE");
  });

  it("keeps the diagnostically useful parts", () => {
    const out = collapseErrorBody(fastly503);
    expect(out).toContain("503 first byte timeout");
    expect(out).toContain("Details: cache-dfw-kdal2120056-DFW");
    expect(out).toContain("suppressed");
  });

  it("leaves an ordinary single-line message untouched", () => {
    const msg = "Column 'textColor' does not allow nulls.";
    expect(collapseErrorBody(msg)).toBe(msg);
  });

  it("flattens a multi-line non-markup body onto one line", () => {
    expect(collapseErrorBody("line one\nline two\r\nline three")).toBe("line one line two line three");
  });

  it("handles empty input", () => {
    expect(collapseErrorBody("")).toBe("");
  });
});
