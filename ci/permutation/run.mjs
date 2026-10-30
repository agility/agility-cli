#!/usr/bin/env node
// CLI sync permutation test runner (PROD-3015, PROD-3016).
//
// Syncs a source (A) to a target (B), then runs rounds of changes in alternating directions:
//   round 0   first sync A → B
//   odd       edit A, sync A → B           (`sync`)
//   even      edit B, sync B → A           (`reverse-sync`, same A/B pair and mappings)
// Every round also edits the other instance (drift) and one item on both sides (a conflict).
//
// After each sync it checks:
//   sync        exit 0, no failed items
//   verify      `agility verify` finds no differences
//   noop        a preflight in the same direction plans no creates, updates or conflicts
//   conflict    the both-sides item ends at the synced side's value, or the sync reported a conflict
//   drift       the other side's own edit was overwritten, or reported; never silently kept
//   apply:*     the change itself could be made (an API rejection is a finding too)
// Nothing stops the run early: every round runs and every result is recorded.
//
// Env: SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN, CLI (command for the CLI under test),
//      TIER (quick|beta|nightly), SEED (default random, printed), LOCALE (default en-us),
//      OUT_DIR (default ./permutation-out). Exit 0 when every check passes, 1 otherwise.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHANGES, QUICK_ROUNDS, client, conflict, drift, readField, rng } from "./changes.mjs";

const { SOURCE_GUID: A, TARGET_GUID: B, AGILITY_TOKEN, CLI } = process.env;
const TIER = process.env.TIER || "quick";
const LOCALE = process.env.LOCALE || "en-us";
const SEED = Number(process.env.SEED) || Math.floor(Math.random() * 2 ** 31);
const OUT = resolve(process.env.OUT_DIR || "permutation-out");
const WORK = join(OUT, "work"); // the CLI writes agility-files/ (pulls, mappings, logs) under its cwd
for (const [k, v] of Object.entries({ SOURCE_GUID: A, TARGET_GUID: B, AGILITY_TOKEN, CLI })) {
  if (!v) {
    console.error(`::error::${k} is not set`);
    process.exit(1);
  }
}
mkdirSync(WORK, { recursive: true });

const r = rng(SEED);
const api = client(AGILITY_TOKEN);
const pair = [`--sourceGuid=${A}`, `--targetGuid=${B}`];
const results = [];
const rounds = [];
const state = { [A]: {}, [B]: {} };

function cli(step, args) {
  const summary = join(OUT, `${step}.json`);
  const [cmd, ...pre] = CLI.split(" ");
  console.log(`\n▶ ${step}: agility ${args.join(" ")}`);
  const started = Date.now();
  const p = spawnSync(cmd, [...pre, ...args, "--headless", `--jsonSummary=${summary}`], {
    cwd: WORK,
    stdio: "inherit",
    env: { ...process.env, AGILITY_TOKEN }, // the token goes by env, never on the command line
    timeout: 60 * 60 * 1000,
  });
  const json = existsSync(summary) ? JSON.parse(readFileSync(summary, "utf8")) : null;
  return { exitCode: p.status ?? -1, json, seconds: Math.round((Date.now() - started) / 1000) };
}

function record(round, direction, check, pass, detail, seconds = 0) {
  results.push({ round, direction, check, pass, detail, seconds });
  console.log(`${pass ? "✅" : "❌"} [r${round} ${direction}] ${check}: ${detail}`);
}

// Content ID on the other instance, from the sync's own mapping file (one file serves both directions).
function mapped(fromSourceSide) {
  const file = join(WORK, "agility-files", "mappings", `${A}-${B}`, LOCALE, "item", "mappings.json");
  const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  return (id) => {
    const row = rows.find((m) => (fromSourceSide ? m.sourceContentID === id : m.targetContentID === id));
    return row ? (fromSourceSide ? row.targetContentID : row.sourceContentID) : null;
  };
}

// One sync in a direction, with a plan before it, then verify and the no-op preflight.
function syncAndCheck(round, direction) {
  const cmd = direction === "A→B" ? "sync" : "reverse-sync";
  const plan = cli(`r${round}-plan`, [cmd, ...pair, "--preflight"]);
  const s = cli(`r${round}-sync`, [cmd, ...pair, "--autoPublish=both"]);
  const failed = s.json?.totals?.failed ?? "?";
  const opErr = s.json?.operationErrors?.[0]?.error;
  record(
    round,
    direction,
    "sync",
    s.exitCode === 0 && failed === 0,
    `exit ${s.exitCode}, ${s.json?.totals?.successful ?? "?"} ok, ${failed} failed${opErr ? `; ${String(opErr).slice(0, 160)}` : ""}`,
    s.seconds
  );
  for (const f of (s.json?.failures ?? []).slice(0, 8)) {
    record(round, direction, `sync-failure:${f.type ?? "item"}`, false, `${f.name}: ${String(f.error).slice(0, 180)}`);
  }

  const v = cli(`r${round}-verify`, ["verify", ...pair]);
  const findings = v.json?.findings ?? [];
  const kinds = [...new Set(findings.map((x) => x.kind ?? x.type ?? x.code).filter(Boolean))].slice(0, 6).join(", ");
  record(
    round,
    direction,
    "verify",
    v.exitCode === 0,
    { 0: "match", 1: `${findings.length || "some"} differences${kinds ? ` (${kinds})` : ""}`, 2: "could not verify" }[
      v.exitCode
    ] ?? `exit ${v.exitCode}`,
    v.seconds
  );

  const n = cli(`r${round}-noop`, [cmd, ...pair, "--preflight"]);
  const t = n.json?.preflight?.totals;
  record(
    round,
    direction,
    "noop",
    n.exitCode === 0 && !!t && t.create === 0 && t.update === 0 && t.conflict === 0,
    t ? `would create ${t.create}, update ${t.update}, conflict ${t.conflict}` : `exit ${n.exitCode}, no plan`,
    n.seconds
  );
  return { planConflicts: plan.json?.preflight?.totals?.conflict ?? 0 };
}

// ── Round 0: first sync ───────────────────────────────────────────────────────────────────────
syncAndCheck(0, "A→B");

// ── Change rounds ─────────────────────────────────────────────────────────────────────────────
const names = Object.keys(CHANGES);
const plan =
  TIER === "quick"
    ? QUICK_ROUNDS
    : Array.from({ length: TIER === "nightly" ? 6 : 4 }, () =>
        Array.from({ length: 3 + r.int(3) }, () => r.pick(names))
      );

for (let i = 0; i < plan.length; i++) {
  const round = i + 1;
  const forward = round % 2 === 1;
  const direction = forward ? "A→B" : "B→A";
  const from = forward ? A : B;
  const to = forward ? B : A;
  const fromCtx = {
    c: api,
    guid: from,
    locale: LOCALE,
    round,
    side: forward ? "source" : "target",
    r,
    state: state[from],
  };
  const toCtx = { c: api, guid: to, locale: LOCALE, round, side: forward ? "target" : "source", r, state: state[to] };
  const applied = [];

  for (const name of plan[i]) {
    try {
      const did = await CHANGES[name](fromCtx);
      if (did) applied.push({ name, ...did });
      else console.log(`  (skipped ${name}: nothing it applies to)`);
    } catch (e) {
      record(round, direction, `apply:${name}`, false, String(e?.message ?? e).slice(0, 200));
    }
  }

  let drifted = null;
  try {
    drifted = await drift(toCtx);
    if (drifted) applied.push({ name: "drift", ...drifted, area: "drift" });
  } catch (e) {
    record(round, direction, "apply:drift", false, String(e?.message ?? e).slice(0, 200));
  }

  let both = null;
  try {
    both = await conflict(fromCtx, toCtx, mapped(forward));
    if (both) applied.push({ name: "conflict", ...both });
  } catch (e) {
    record(round, direction, "apply:conflict", false, String(e?.message ?? e).slice(0, 200));
  }

  rounds.push({ round, direction, changes: applied.map(({ sv, dv, ...rest }) => rest) });
  console.log(
    `\n── round ${round} (${direction}): ${applied.map((a) => `${a.area}/${a.change}`).join(", ") || "no changes"}`
  );

  const { planConflicts } = syncAndCheck(round, direction);

  if (both) {
    const after = await readField(api, to, LOCALE, both.dstId, both.field);
    const synced = after === both.sv;
    record(
      round,
      direction,
      "conflict",
      synced || planConflicts > 0,
      synced
        ? "the synced side's value won"
        : planConflicts > 0
          ? `kept, and preflight reported ${planConflicts} conflict(s)`
          : `silently kept the other side's value`
    );
  }
  if (drifted) {
    const id = Number(/#(\d+)/.exec(drifted.detail)?.[1]);
    const field = /field (\S+)/.exec(drifted.detail)?.[1];
    const otherId = mapped(!forward)(id);
    const [mine, theirs] = await Promise.all([
      readField(api, to, LOCALE, id, field),
      otherId ? readField(api, from, LOCALE, otherId, field) : undefined,
    ]);
    const same = mine === theirs;
    record(
      round,
      direction,
      "drift",
      same || planConflicts > 0,
      same
        ? "overwritten to match"
        : planConflicts > 0
          ? "kept, and reported as a conflict"
          : "the other side's edit was silently kept; the instances differ"
    );
  }
}

// ── Results ───────────────────────────────────────────────────────────────────────────────────
let cliVersion = "unknown";
try {
  cliVersion = JSON.parse(readFileSync(join(OUT, "r0-sync.json"), "utf8")).run.cliVersion;
} catch {}
writeFileSync(
  join(OUT, "results.json"),
  JSON.stringify({ cliVersion, tier: TIER, seed: SEED, source: A, target: B, rounds, results }, null, 2)
);

const failed = results.filter((x) => !x.pass);
const md = [
  `### Sync permutation test: CLI ${cliVersion}, tier ${TIER}, seed ${SEED}`,
  "",
  `A \`${A}\` ↔ B \`${B}\`: ${results.length} checks, **${failed.length} failed**. Replay with \`SEED=${SEED} TIER=${TIER}\`.`,
  "",
  "| Round | Direction | Changes |",
  "|---|---|---|",
  ...rounds.map((x) => `| ${x.round} | ${x.direction} | ${x.changes.map((c) => `${c.area}/${c.change}`).join(", ")} |`),
  "",
  "| Round | Direction | Check | Result | Detail | Time |",
  "|---|---|---|---|---|---|",
  ...results.map(
    (x) =>
      `| ${x.round} | ${x.direction} | ${x.check} | ${x.pass ? "✅" : "❌"} | ${String(x.detail).replace(/\|/g, "\\|")} | ${x.seconds}s |`
  ),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
writeFileSync(join(OUT, "summary.md"), md);

process.exit(failed.length ? 1 : 0);
