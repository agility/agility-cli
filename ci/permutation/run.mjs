#!/usr/bin/env node
// CLI sync permutation test runner (PROD-3015, PROD-3016).
//
// Slice 0/1: one source (the dev "blog" template) synced to one new, empty target. Checks:
//   first-sync      `sync` exits 0 and its JSON summary reports no failures
//   verify          `verify` exits 0 (target matches source)
//   resync-noop     a `sync --preflight` straight after plans no creates, updates or conflicts
// Later slices add the generator (PROD-3017), change rounds (PROD-3018), the expected-result
// model (PROD-3019), more target types and directions. Each check becomes a row in the grid.
//
// Env: SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN (a token that can read and write both instances), CLI (command that runs the
// CLI under test, e.g. "node /path/dist/index.js"), OUT_DIR (results; default ./permutation-out).
// Exit 0 when every check passes, 1 otherwise.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN, CLI } = process.env;
const OUT = resolve(process.env.OUT_DIR || "permutation-out");
const WORK = join(OUT, "work"); // the CLI writes agility-files/ (pulls, mappings, logs) under its cwd
for (const [k, v] of Object.entries({ SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN, CLI })) {
  if (!v) {
    console.error(`::error::${k} is not set`);
    process.exit(1);
  }
}
mkdirSync(WORK, { recursive: true });

const pair = [`--sourceGuid=${SOURCE_GUID}`, `--targetGuid=${TARGET_GUID}`];
const results = [];

function cli(step, args) {
  const summary = join(OUT, `${step}.json`);
  const [cmd, ...pre] = CLI.split(" ");
  console.log(`\n▶ ${step}: agility ${args.join(" ")}`);
  const started = Date.now();
  const r = spawnSync(cmd, [...pre, ...args, "--headless", `--jsonSummary=${summary}`], {
    cwd: WORK,
    stdio: "inherit",
    env: { ...process.env, AGILITY_TOKEN }, // the token goes by env, never on the command line
    timeout: 60 * 60 * 1000,
  });
  const json = existsSync(summary) ? JSON.parse(readFileSync(summary, "utf8")) : null;
  return { exitCode: r.status ?? -1, json, seconds: Math.round((Date.now() - started) / 1000) };
}

function record(check, pass, detail, seconds) {
  results.push({
    area: "all",
    change: "none",
    target: "new-empty",
    direction: "forward",
    check,
    pass,
    detail,
    seconds,
  });
  console.log(`${pass ? "✅" : "❌"} ${check}: ${detail}`);
}

// 1. First sync to a new, empty target.
const sync = cli("first-sync", ["sync", ...pair, "--autoPublish=both"]);
const failed = sync.json?.totals?.failed ?? "?";
record(
  "first-sync",
  sync.exitCode === 0 && failed === 0,
  `exit ${sync.exitCode}, ${sync.json?.totals?.successful ?? "?"} ok, ${failed} failed, ${sync.json?.warnings?.length ?? "?"} warnings`,
  sync.seconds
);

// 2. Verify the target against the source.
const verify = cli("verify", ["verify", ...pair]);
record(
  "verify",
  verify.exitCode === 0,
  { 0: "target matches source", 1: "differences found", 2: "could not verify" }[verify.exitCode] ??
    `exit ${verify.exitCode}`,
  verify.seconds
);

// 3. A second sync must change nothing: preflight plans it without writing.
const again = cli("resync-noop", ["sync", ...pair, "--preflight"]);
const t = again.json?.preflight?.totals;
record(
  "resync-noop",
  again.exitCode === 0 && t && t.create === 0 && t.update === 0 && t.conflict === 0,
  t
    ? `would create ${t.create}, update ${t.update}, conflict ${t.conflict}, invalid ${t.invalid}`
    : `exit ${again.exitCode}, no preflight plan`,
  again.seconds
);

// Results: JSON for later tooling, a table for the job summary.
const cliVersion = sync.json?.run?.cliVersion ?? verify.json?.run?.cliVersion ?? "unknown";
writeFileSync(
  join(OUT, "results.json"),
  JSON.stringify({ cliVersion, source: SOURCE_GUID, target: TARGET_GUID, results }, null, 2)
);

const rows = results.map(
  (r) =>
    `| ${r.check} | ${r.target} | ${r.direction} | ${r.pass ? "✅ pass" : "❌ fail"} | ${r.detail} | ${r.seconds}s |`
);
const md = [
  `### CLI sync permutation test: CLI ${cliVersion}`,
  "",
  `Source \`${SOURCE_GUID}\` → target \`${TARGET_GUID}\` (dev leases, deleted after the run).`,
  "",
  "| Check | Target | Direction | Result | Detail | Time |",
  "|---|---|---|---|---|---|",
  ...rows,
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

process.exit(results.every((r) => r.pass) ? 0 : 1);
