#!/usr/bin/env node
// CLI sync permutation test runner (PROD-3015, PROD-3016).
//
// Syncs a source (A) to a target (B), then runs rounds of changes in alternating directions:
//   round 0   first sync A → B
//   odd       edit A, sync A → B           (`sync`)
//   even      edit B, sync B → A           (`reverse-sync`, same A/B pair and mappings)
// Every round also edits the other instance (drift) and one item on both sides (a conflict).
//
// Before the first sync it adds fixtures the blog template lacks (fixtures.mjs): content that
// references itself and each other (PROD-3076), checked after round 0 by `cycles`.
//
// After each sync it checks:
//   sync        exit 0, no failed items
//   conflict    the both-sides item ends at the synced side's value, or a preflight reported it
//   drift       the other side's own edit was overwritten, or reported as a conflict on that item
//   resolve     when the sync kept such edits: the same sync with --overwrite settles them
//   verify      `agility verify` finds no differences (verify and noop: up to 3 tries, 90s apart)
//   noop        a preflight in the same direction plans no creates, updates, deletes or conflicts
//   apply:*     the change itself could be made (an API rejection is a finding too)
// Syncs and preflights pass --syncDeletes, so a delete on one side reaches the other.
// Nothing stops the run early: every round runs and every result is recorded.
//
// Env: SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN, CLI (command for the CLI under test),
//      TIER (quick|beta|nightly), SEED (default random, printed), LOCALE (default en-us),
//      OUT_DIR (default ./permutation-out). Exit 0 when every check passes, 1 otherwise.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHANGES, QUICK_ROUNDS, client, conflict, drift, readField, rng } from "./changes.mjs";
import { checkReferenceCycles, seedReferenceCycles, waitForFetchSync } from "./fixtures.mjs";

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

// Every sync and preflight also syncs deletes, so a delete on one side reaches the other.
const SYNC = ["--autoPublish=both", "--syncDeletes"];
const PLAN = ["--preflight", "--syncDeletes"];

// One sync in a direction, with a plan before it and one after. The plan after shows what the sync
// left in conflict: the edits it kept on the receiving side. `step` is "sync", or "resolve" for the
// `--overwrite` sync that settles kept conflicts.
function syncStep(round, direction, step = "sync", extra = []) {
  const cmd = direction === "A→B" ? "sync" : "reverse-sync";
  const before = step === "sync" ? cli(`r${round}-plan`, [cmd, ...pair, ...PLAN]) : null;
  const s = cli(`r${round}-${step}`, [cmd, ...pair, ...SYNC, ...extra]);
  const failed = s.json?.totals?.failed ?? "?";
  const opErr = s.json?.operationErrors?.[0]?.error;
  record(
    round,
    direction,
    step,
    s.exitCode === 0 && failed === 0,
    `exit ${s.exitCode}, ${s.json?.totals?.successful ?? "?"} ok, ${failed} failed${opErr ? `; ${String(opErr).slice(0, 160)}` : ""}`,
    s.seconds
  );
  for (const f of (s.json?.failures ?? []).slice(0, 8)) {
    record(
      round,
      direction,
      `${step}-failure:${f.type ?? "item"}`,
      false,
      `${f.name}: ${String(f.error).slice(0, 180)}`
    );
  }
  const after = step === "sync" ? cli(`r${round}-after`, [cmd, ...pair, ...PLAN]) : null;
  const entries = [before, after].flatMap((x) => x?.json?.preflight?.entries ?? []);
  const details = entries.filter((e) => e.action === "conflict").map((e) => e.detail ?? "");
  return {
    // Whether a preflight reported a conflict on this content item (its URL is in the detail)
    reported: (guid, id) =>
      details.some((d) => new RegExp(`/instance/${guid}/[^/]+/content/listitem-${id}(?!\\d)`).test(d)),
  };
}

// verify, then the no-op preflight. Both read the instances through the Fetch API, which lags behind
// the Management API: a save shows up within seconds, but an edit that creates no version (a list
// reorder, a model field rename) can take a few minutes. So when either finds something, both are
// tried again, up to three times 90s apart; a real difference survives that.
async function checkStep(round, direction) {
  const cmd = direction === "A→B" ? "sync" : "reverse-sync";
  let v, n, t;
  let tries = 0;
  for (;;) {
    tries++;
    const suffix = tries === 1 ? "" : `-try${tries}`;
    v = cli(`r${round}-verify${suffix}`, ["verify", ...pair]);
    n = cli(`r${round}-noop${suffix}`, [cmd, ...pair, ...PLAN]);
    t = n.json?.preflight?.totals;
    const clean = v.exitCode === 0 && n.exitCode === 0 && !!t && !t.create && !t.update && !t.delete && !t.conflict;
    if (clean || tries === 3) break;
    await new Promise((res) => setTimeout(res, 90_000));
  }
  const later = tries > 1 ? ` (try ${tries} of 3)` : "";

  const findings = (v.json?.findings ?? []).filter((x) => x.severity === "failure");
  const kinds = [...new Set(findings.map((x) => x.category).filter(Boolean))].slice(0, 6).join(", ");
  const outcome =
    { 0: "match", 1: `${findings.length || "some"} differences${kinds ? ` (${kinds})` : ""}`, 2: "could not verify" }[
      v.exitCode
    ] ?? `exit ${v.exitCode}`;
  record(round, direction, "verify", v.exitCode === 0, `${outcome}${later}`, v.seconds);
  record(
    round,
    direction,
    "noop",
    n.exitCode === 0 && !!t && t.create === 0 && t.update === 0 && t.delete === 0 && t.conflict === 0,
    (t
      ? `would create ${t.create}, update ${t.update}, delete ${t.delete}, conflict ${t.conflict}`
      : `exit ${n.exitCode}, no plan`) + later,
    n.seconds
  );
}

// ── Fixtures, then round 0: first sync ────────────────────────────────────────────────────────
let cycles = null;
try {
  cycles = await seedReferenceCycles(api, A, LOCALE);
  // The first sync pulls from the Fetch API, which lists new items a minute or two after publish
  const waited = await waitForFetchSync(
    AGILITY_TOKEN,
    A,
    LOCALE,
    cycles.links.map(([x]) => x)
  );
  record(
    0,
    "A→B",
    "apply:fixture-cycles",
    true,
    `A ↔ B and a self-reference (${cycles.links.map(([x]) => `#${x}`).join(", ")}), in the Fetch API after ${waited}s`
  );
} catch (e) {
  record(0, "A→B", "apply:fixture-cycles", false, String(e?.message ?? e).slice(0, 200));
}

syncStep(0, "A→B");

if (cycles) {
  const problems = await checkReferenceCycles(api, B, LOCALE, cycles, mapped(true));
  record(
    0,
    "A→B",
    "cycles",
    problems.length === 0,
    problems.length ? problems.join("; ").slice(0, 300) : "each copy points at its partner's target ID"
  );
}

await checkStep(0, "A→B");

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

  const { reported } = syncStep(round, direction);
  let kept = false;

  if (both) {
    const after = await readField(api, to, LOCALE, both.dstId, both.field);
    const synced = after === both.sv;
    record(
      round,
      direction,
      "conflict",
      synced || reported(to, both.dstId),
      synced
        ? "the synced side's value won"
        : reported(to, both.dstId)
          ? "kept, and reported as a conflict"
          : `silently kept the other side's value`
    );
    kept ||= !synced;
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
      same || reported(to, id),
      same
        ? "overwritten to match"
        : reported(to, id)
          ? "kept, and reported as a conflict"
          : "the other side's edit was silently kept; the instances differ"
    );
    kept ||= !same;
  }

  // The sync rightly kept the receiving side's own edits and reported them. Settle them the way an
  // editor would, by syncing again with --overwrite, so verify and the no-op check see one state.
  if (kept) syncStep(round, direction, "resolve", ["--overwrite"]);
  await checkStep(round, direction);
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
