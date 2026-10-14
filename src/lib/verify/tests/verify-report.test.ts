import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildErrorReport,
  buildVerifyReport,
  computeExitCode,
  defaultReportPath,
  emptyRunInfo,
  EXIT_CANNOT_VERIFY,
  EXIT_DIFFERENCES,
  EXIT_PASS,
  FindingCollector,
  MAX_DETAILS_PER_CATEGORY,
  printVerifyReport,
  writeVerifyReport,
} from "../verify-report";

const OPTIONS = { locales: ["en-us"], channel: "", models: "", pages: "", containers: "" };

function collectorWith(severities: Array<"failure" | "warning" | "sourceDefect">): FindingCollector {
  const collector = new FindingCollector();
  severities.forEach((severity, i) =>
    collector.add({ category: `c${i}`, severity, entity: "content", locale: "en-us", sourceID: i, targetID: 100 + i })
  );
  return collector;
}

describe("exit codes", () => {
  it("is 0 with no findings", () => {
    expect(computeExitCode([])).toBe(EXIT_PASS);
  });

  it("is 0 when there are only warnings and source defects", () => {
    expect(computeExitCode(collectorWith(["warning", "sourceDefect"]).findings)).toBe(EXIT_PASS);
  });

  it("is 1 with any failure", () => {
    expect(computeExitCode(collectorWith(["warning", "failure"]).findings)).toBe(EXIT_DIFFERENCES);
  });

  it("is 2 for a run that could not verify", () => {
    const report = buildErrorReport({ source: "a", target: "b", options: OPTIONS, error: "boom", run: emptyRunInfo() });
    expect(report).toMatchObject({ verdict: "error", exitCode: EXIT_CANNOT_VERIFY, error: "boom", findings: [] });
  });
});

describe("buildVerifyReport — golden (without the volatile run block)", () => {
  it("serializes findings, per-locale tallies and totals", () => {
    const collector = new FindingCollector();
    collector.count("*", "model", "checked", 2);
    collector.count("*", "model", "matched", 2);
    collector.count("en-us", "page", "checked");
    collector.count("en-us", "page", "mismatched");
    collector.count("en-us", "zone", "checked");
    collector.count("en-us", "zone", "mismatched");
    collector.add({
      category: "componentOrderMismatch",
      severity: "failure",
      entity: "zone",
      locale: "en-us",
      sourceID: 10,
      targetID: 90,
      name: "home",
      path: "main",
      expected: ["hero#1", "text#2"],
      actual: ["text#2", "hero#1"],
    });
    collector.add({
      category: "publishStateDifference",
      severity: "warning",
      entity: "page",
      locale: "en-us",
      sourceID: 10,
      targetID: 90,
      name: "home",
      path: "state",
      expected: 2,
      actual: 1,
    });

    const report = buildVerifyReport({
      source: "src",
      target: "tgt",
      options: OPTIONS,
      collector,
      run: emptyRunInfo(),
    });
    const { run, ...stable } = report;

    expect(run).toEqual(expect.objectContaining({ cliVersion: expect.any(String), startedAt: expect.any(String) }));
    expect(JSON.parse(JSON.stringify(stable))).toEqual({
      schemaVersion: 1,
      command: "verify",
      verdict: "fail",
      exitCode: 1,
      source: "src",
      target: "tgt",
      options: { locales: ["en-us"], channel: "", models: "", pages: "", containers: "" },
      totals: {
        failures: 1,
        warnings: 1,
        sourceDefects: 0,
        byCategory: { componentOrderMismatch: 1, publishStateDifference: 1 },
        entities: {
          model: { checked: 2, matched: 2, mismatched: 0, missing: 0, extra: 0, known: 0 },
          page: { checked: 1, matched: 0, mismatched: 1, missing: 0, extra: 0, known: 0 },
          zone: { checked: 1, matched: 0, mismatched: 1, missing: 0, extra: 0, known: 0 },
        },
      },
      byLocale: {
        "*": {
          failures: 0,
          warnings: 0,
          sourceDefects: 0,
          entities: { model: { checked: 2, matched: 2, mismatched: 0, missing: 0, extra: 0, known: 0 } },
        },
        "en-us": {
          failures: 1,
          warnings: 1,
          sourceDefects: 0,
          entities: {
            page: { checked: 1, matched: 0, mismatched: 1, missing: 0, extra: 0, known: 0 },
            zone: { checked: 1, matched: 0, mismatched: 1, missing: 0, extra: 0, known: 0 },
          },
        },
      },
      findings: [
        {
          category: "componentOrderMismatch",
          severity: "failure",
          entity: "zone",
          locale: "en-us",
          sourceID: 10,
          targetID: 90,
          name: "home",
          path: "main",
          expected: ["hero#1", "text#2"],
          actual: ["text#2", "hero#1"],
        },
        {
          category: "publishStateDifference",
          severity: "warning",
          entity: "page",
          locale: "en-us",
          sourceID: 10,
          targetID: 90,
          name: "home",
          path: "state",
          expected: 2,
          actual: 1,
        },
      ],
    });
  });

  it("orders findings deterministically regardless of insertion order", () => {
    const a = collectorWith(["warning", "failure", "sourceDefect"]);
    const b = new FindingCollector();
    a.findings
      .slice()
      .reverse()
      .forEach((f) => b.add(f));
    const run = emptyRunInfo();
    expect(buildVerifyReport({ source: "s", target: "t", options: OPTIONS, collector: b, run }).findings).toEqual(
      buildVerifyReport({ source: "s", target: "t", options: OPTIONS, collector: a, run }).findings
    );
  });
});

describe("writeVerifyReport / defaultReportPath", () => {
  it("writes the report, creating directories, and never throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-report-"));
    const file = path.join(dir, "nested", "report.json");
    const report = buildErrorReport({ source: "a", target: "b", options: OPTIONS, error: "x", run: emptyRunInfo() });
    expect(writeVerifyReport(file, report)).toEqual({ written: true });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).command).toBe("verify");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to agility-files/logs/verify-{src}-{tgt}-{timestamp}.json", () => {
    expect(defaultReportPath("agility-files", "s", "t", new Date("2026-10-07T12:00:00.000Z"))).toBe(
      path.join("agility-files", "logs", "verify-s-t-2026-10-07T12-00-00-000Z.json")
    );
  });
});

describe("printVerifyReport", () => {
  it("prints a table per locale, capped details with links, and a verdict line", () => {
    const collector = new FindingCollector();
    collector.count("en-us", "content", "checked", 30);
    for (let i = 0; i < MAX_DETAILS_PER_CATEGORY + 5; i++) {
      collector.add({
        category: "fieldMismatch",
        severity: "failure",
        entity: "content",
        locale: "en-us",
        sourceID: i,
        targetID: 500 + i,
        path: "title",
        expected: "a",
        actual: "b",
      });
    }
    const lines: string[] = [];
    printVerifyReport(
      buildVerifyReport({ source: "s", target: "t", options: OPTIONS, collector, run: emptyRunInfo() }),
      {
        log: (l) => lines.push(l.replace(/\x1b\[[0-9;]*m/g, "")),
        linkFor: (f) => `link-${f.targetID}`,
      }
    );
    const text = lines.join("\n");
    expect(text).toContain("Locale en-us: 25 failure(s)");
    expect(text).toMatch(/entity\s+checked\s+matched\s+mismatched\s+missing\s+extra\s+known/);
    expect(text).toContain("FAILURE fieldMismatch (25)");
    expect(lines.filter((l) => l.includes("link-")).length).toBe(MAX_DETAILS_PER_CATEGORY);
    expect(text).toContain("…and 5 more");
    expect(text).toContain("VERDICT: FAIL");
  });

  it("prints the reason for a run that could not verify", () => {
    const lines: string[] = [];
    printVerifyReport(
      buildErrorReport({ source: "s", target: "t", options: OPTIONS, error: "no auth", run: emptyRunInfo() }),
      {
        log: (l) => lines.push(l),
      }
    );
    expect(lines.join("\n")).toContain("no auth");
    expect(lines.join("\n")).toContain("exit 2");
  });
});
