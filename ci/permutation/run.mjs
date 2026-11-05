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
//   drift       the other side's own edit was overwritten, or kept with a "target changed" warning
//   drift:listOrder, drift:template, drift:urlRedirection
//               a list reorder, template edit or redirection edit on the other side alone is kept
//               with a "target changed" warning, or reported as a conflict if the round's own changes
//               touched it too; never overwritten without --overwrite (PROD-3078)
//   resolve     when the sync kept such edits: the same sync with --overwrite settles them
//   verify      `agility verify` finds no differences (verify and noop: up to 3 tries, 90s apart)
//   noop        a preflight in the same direction plans no creates, updates, deletes or conflicts
//   apply:*     the change itself could be made (an API rejection is a finding too)
// Syncs and preflights pass --syncDeletes, so a delete on one side reaches the other.
// Nothing stops the run early: every round runs and every result is recorded.
//
// A check is skipped, not failed, when the Fetch API never showed a change it depends on: the
// environment didn't deliver what the sync reads, so the check can't grade the CLI. That covers a
// wait for the Fetch API that times out, a later drift:listOrder on a list whose earlier change never
// showed, and a verify whose only differences are list orders the CLI itself reports as not in the
// Fetch API yet. A skip never fails the run.
//
// Env: SOURCE_GUID, TARGET_GUID, AGILITY_TOKEN, CLI (command for the CLI under test),
//      TIER (quick|beta|nightly), SEED (default random, printed), LOCALE (default en-us),
//      OUT_DIR (default ./permutation-out). Exit 0 when every check passes, 1 otherwise.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHANGES, QUICK_ROUNDS, STRUCTURAL_DRIFTS, client, conflict, drift, readField, rng } from "./changes.mjs";
import {
  changedSince,
  checkReferenceCycles,
  contentVersions,
  editRedirection,
  seedRedirection,
  seedReferenceCycles,
  waitForFetchSync,
  waitForFetchItemOrder,
  waitForFetchVersions,
} from "./fixtures.mjs";

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

// `pass` is true, false, or SKIP (the environment, not the CLI; see the header)
const SKIP = "skip";
const icon = (pass) => (pass === SKIP ? "⏭️" : pass ? "✅" : "❌");
function record(round, direction, check, pass, detail, seconds = 0) {
  results.push({ round, direction, check, pass, detail, seconds });
  console.log(`${icon(pass)} [r${round} ${direction}] ${check}: ${detail}`);
}

// A wait for the Fetch API that ran out of time (fixtures.mjs throws these): a skip, not a failure.
// Any other error is still a failure.
const FETCH_TIMEOUT = /in the Fetch API after \d+s|Fetch API still (behind|shows the old order)/;
function recordApplyError(round, direction, check, e) {
  const message = String(e?.message ?? e).slice(0, 200);
  const lagged = FETCH_TIMEOUT.test(message);
  record(round, direction, check, lagged ? SKIP : false, lagged ? `environment: ${message}` : message);
  return lagged;
}

// Lists (lowercased reference names) with a change the Fetch API never showed. The CLI rightly treats
// such a list as pending until it does, so its later list-order checks can't grade the CLI.
const fetchStale = new Set();

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
  const conflicts = entries.filter((e) => e.action === "conflict").map((e) => e.detail ?? "");
  const kept = entries.filter((e) => e.action === "skip" && /kept the target's version/.test(e.detail ?? ""));
  const names = (guid, id) => new RegExp(`/instance/${guid}/[^/]+/content/listitem-${id}(?!\\d)`);
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  return {
    // Whether the sync kept a target-only change to this entity (a targetChangeKept warning)
    keptByType: (type, name) =>
      (s.json?.warnings ?? []).some((w) => w.code === "targetChangeKept" && w.type === type && same(w.name, name)),
    // Whether a preflight reported a conflict on this entity in a phase
    conflictIn: (phase, name) => entries.some((e) => e.action === "conflict" && e.phase === phase && same(e.name, name)),
    // Whether a preflight reported a conflict on this content item (its URL is in the detail)
    reported: (guid, id) => conflicts.some((d) => names(guid, id).test(d)),
    // Whether a preflight kept this content item's target-only change, with a warning
    keptWarned: (guid, id) => kept.some((e) => names(guid, id).test(e.detail)),
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
  // Lists the no-op preflight holds back because the last sync's change isn't in the Fetch API yet.
  // A verify whose only differences are those lists' order is the environment, not the CLI.
  const pending = new Set(
    (n.json?.preflight?.entries ?? [])
      .filter((e) => e.action === "skip" && /isn't in the Fetch API yet/.test(e.detail ?? ""))
      .map((e) => String(e.name).toLowerCase())
  );
  const onlyPending =
    v.exitCode === 1 &&
    findings.length > 0 &&
    findings.every((x) => x.category === "listOrderMismatch" && pending.has(String(x.name).toLowerCase()));
  if (onlyPending) for (const x of findings) fetchStale.add(String(x.name).toLowerCase());
  record(
    round,
    direction,
    "verify",
    v.exitCode === 0 || (onlyPending ? SKIP : false),
    onlyPending
      ? `environment: ${outcome}, all in lists the CLI reports as not in the Fetch API yet${later}`
      : `${outcome}${later}`,
    v.seconds
  );
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

// A redirection for the rounds to edit on the receiving side (PROD-3078)
let redirection = null;
try {
  redirection = await seedRedirection(AGILITY_TOKEN, A, SEED);
  record(0, "A→B", "apply:fixture-redirection", true, `${redirection.originUrl}, in the Fetch API after ${redirection.waited}s`);
} catch (e) {
  record(0, "A→B", "apply:fixture-redirection", false, String(e?.message ?? e).slice(0, 200));
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
  const versionsBefore = {
    [from]: await contentVersions(api, from, LOCALE),
    [to]: await contentVersions(api, to, LOCALE),
  };

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
    // The receiving side's copies of content items this round touched on the sending side: edits,
    // list reorders, publishes and deletes. Page and model changes name page IDs
    // or none, so only the content and ordering areas count.
    const editedThere = applied
      .filter((a) => a.area === "content" || a.area === "ordering")
      .flatMap((a) => [...String(a.detail ?? "").matchAll(/#(\d+)/g)].map((m) => Number(m[1])))
      .map((id) => mapped(forward)(id))
      .filter(Boolean);
    drifted = await drift(toCtx, new Set(editedThere));
    if (drifted) applied.push({ name: "drift", ...drifted, area: "drift" });
  } catch (e) {
    record(round, direction, "apply:drift", false, String(e?.message ?? e).slice(0, 200));
  }

  // A list reorder and a template edit on the receiving side alone (PROD-3078)
  const structural = [];
  for (const d of STRUCTURAL_DRIFTS) {
    try {
      const avoidLists = applied.filter((x) => x.change === "list-reorder" && x.entity).map((x) => x.entity);
      const did = await CHANGES[d.change]({ ...toCtx, avoidLists });
      if (did) {
        structural.push({ ...d, ...did });
        applied.push({ name: `drift:${d.kind}`, ...did, area: "drift" });
      } else console.log(`  (skipped drift:${d.kind}: nothing it applies to)`);
    } catch (e) {
      recordApplyError(round, direction, `apply:drift:${d.kind}`, e);
    }
  }

  if (redirection) {
    try {
      const did = await editRedirection(AGILITY_TOKEN, to, redirection.originUrl, `r${round}d`);
      if (did) {
        structural.push({ kind: "urlRedirection", phase: "URL Redirections", ...did });
        applied.push({ name: "drift:urlRedirection", ...did, area: "drift" });
      } else record(round, direction, "apply:drift:urlRedirection", false, `${redirection.originUrl} isn't on ${to}`);
    } catch (e) {
      // The edit was saved but never showed: no drift:urlRedirection check this round
      recordApplyError(round, direction, "apply:drift:urlRedirection", e);
    }
  }

  let both = null;
  try {
    const driftedId = drifted ? Number(/#(\d+)/.exec(drifted.detail)?.[1]) || null : null;
    both = await conflict(fromCtx, toCtx, mapped(forward), driftedId);
    if (both) applied.push({ name: "conflict", ...both });
  } catch (e) {
    record(round, direction, "apply:conflict", false, String(e?.message ?? e).slice(0, 200));
  }

  rounds.push({ round, direction, changes: applied.map(({ sv, dv, orders, ...rest }) => rest) });
  console.log(
    `\n── round ${round} (${direction}): ${applied.map((a) => `${a.area}/${a.change}`).join(", ") || "no changes"}`
  );

  // The sync reads both instances through the Fetch API: wait until it shows this round's edits
  for (const guid of [from, to]) {
    try {
      const changed = changedSince(versionsBefore[guid], await contentVersions(api, guid, LOCALE));
      const waited = await waitForFetchVersions(AGILITY_TOKEN, guid, LOCALE, changed);
      if (changed.size) console.log(`  Fetch API showed ${changed.size} edited item(s) on ${guid} after ${waited}s`);
    } catch (e) {
      recordApplyError(round, direction, "apply:fetch-catch-up", e);
    }
  }
  // A list swap's new order shows in the Fetch API later than the items' new versions
  for (const a of applied.filter((x) => x.orders)) {
    try {
      const waited = await waitForFetchItemOrder(AGILITY_TOKEN, a.orders.guid, LOCALE, a.orders.items);
      console.log(`  Fetch API showed the new order of ${a.entity ?? a.detail} on ${a.orders.guid} after ${waited}s`);
    } catch (e) {
      if (recordApplyError(round, direction, "apply:fetch-order", e) && a.entity) fetchStale.add(a.entity.toLowerCase());
    }
  }

  const { reported, keptWarned, keptByType, conflictIn } = syncStep(round, direction);
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
      same || keptWarned(to, id),
      same
        ? "overwritten to match"
        : keptWarned(to, id)
          ? "kept, with a target-changed warning"
          : reported(to, id)
            ? "reported as a conflict, but only the target changed"
            : "the other side's edit was silently kept; the instances differ"
    );
    kept ||= !same;
  }

  for (const d of structural) {
    const warned = keptByType(d.kind, d.entity);
    const conflicted = conflictIn(d.phase, d.entity);
    const stale = d.kind === "listOrder" && fetchStale.has(String(d.entity).toLowerCase());
    record(
      round,
      direction,
      `drift:${d.kind}`,
      warned || conflicted || (stale ? SKIP : false),
      warned
        ? `${d.entity}: kept, with a target-changed warning`
        : conflicted
          ? `${d.entity}: reported as a conflict (the round's own changes touched it too)`
          : stale
            ? `${d.entity}: environment: an earlier change to this list never showed in the Fetch API, so the CLI treats it as pending`
            : `${d.entity}: the other side's edit was overwritten without --overwrite, or not seen`
    );
    kept ||= warned || conflicted;
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

const failed = results.filter((x) => x.pass === false);
const skipped = results.filter((x) => x.pass === SKIP);
const md = [
  `### Sync permutation test: CLI ${cliVersion}, tier ${TIER}, seed ${SEED}`,
  "",
  `A \`${A}\` ↔ B \`${B}\`: ${results.length} checks, **${failed.length} failed**${skipped.length ? `, ${skipped.length} skipped (the Fetch API never showed a change)` : ""}. Replay with \`SEED=${SEED} TIER=${TIER}\`.`,
  "",
  "| Round | Direction | Changes |",
  "|---|---|---|",
  ...rounds.map((x) => `| ${x.round} | ${x.direction} | ${x.changes.map((c) => `${c.area}/${c.change}`).join(", ")} |`),
  "",
  "| Round | Direction | Check | Result | Detail | Time |",
  "|---|---|---|---|---|---|",
  ...results.map(
    (x) =>
      `| ${x.round} | ${x.direction} | ${x.check} | ${icon(x.pass)} |${String(x.detail).replace(/\|/g, "\\|")} | ${x.seconds}s |`
  ),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
writeFileSync(join(OUT, "summary.md"), md);

process.exit(failed.length ? 1 : 0);
