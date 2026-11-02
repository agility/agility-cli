#!/usr/bin/env node
// Test-instance lease client for CI.
//
// Leases throwaway instances for the live sync test and tears them down. Plain Node (>= 20, global
// fetch), no dependencies.
//
// Configuration (set as GitHub Environment variables, never committed):
//   LEASE_API_URL    the lease endpoint's base URL
//   LEASE_API_TOKEN  a bearer token for it (in GitHub Actions: OIDC, then `az account get-access-token`)
//
//   node ci/leases.mjs create  <prefix> <role>:<template> [<role>:<template> ...] [--ttl 60] [--timeout 900]
//   node ci/leases.mjs release <prefix> [--reason text]
//   node ci/leases.mjs sweep   <prefix> --older-than-hours 6
//
// Every lease is labelled <prefix><role>. `release` deletes every live lease of this caller whose
// label starts with <prefix>, so a run can always clean up after itself, even after a crash.
// `create` writes `<role>_guid` and `<role>_lease` to $GITHUB_OUTPUT when it's set.

import { appendFileSync } from "node:fs";

const BASE = (process.env.LEASE_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.LEASE_API_TOKEN;
const RUN_URL = process.env.GITHUB_RUN_URL || undefined;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function args(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

// One call with retries. A call can occasionally hang, so every attempt has its own timeout;
// creates are safe to retry because of the Idempotency-Key.
async function call(method, path, { body, headers = {}, ok = [200, 202], attempts = 5 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (ok.includes(res.status)) return { status: res.status, json };
      last = new Error(`${method} ${path} → ${res.status} ${json?.reasonCode ?? ""} ${json?.error ?? text}`);
      last.status = res.status;
      last.reasonCode = json?.reasonCode;
      if (res.status !== 429 && res.status < 500) throw last;
      const wait = Number(res.headers.get("retry-after")) || 10 * i;
      log(`  ${last.message.trim()}; retrying in ${wait}s`);
      await sleep(wait * 1000);
    } catch (e) {
      if (e.status && e.status !== 429 && e.status < 500) throw e;
      last = e;
      log(`  ${method} ${path} failed (${e.message}); retry ${i}/${attempts}`);
      await sleep(5000 * i);
    }
  }
  throw last;
}

async function list() {
  return (await call("GET", "")).json.items;
}

async function create(prefix, specs, { ttl = "60", timeout = "900" } = {}) {
  const leases = [];
  for (const spec of specs) {
    const [role, template = "blank"] = spec.split(":");
    const label = `${prefix}${role}`;
    const { json } = await call("POST", "", {
      body: { label, template, ttlMinutes: Number(ttl), displayName: `cli-perm ${label}`, runUrl: RUN_URL },
      headers: { "Idempotency-Key": label },
    });
    log(`leased ${label} (lease ${json.leaseId}, template ${template}, expires ${json.expiresAt})`);
    leases.push({ role, label, leaseId: json.leaseId });
  }

  // Poll them together: pool claims take ~20 s, builds from scratch several minutes.
  const deadline = Date.now() + Number(timeout) * 1000;
  const pending = new Set(leases);
  while (pending.size) {
    for (const l of [...pending]) {
      const { json } = await call("GET", `/${l.leaseId}`, { ok: [200] });
      if (json.status === "ready") {
        l.guid = json.instance.guid;
        log(`ready  ${l.label}: ${l.guid}`);
        pending.delete(l);
      } else if (json.status !== "provisioning") {
        throw new Error(`lease ${l.leaseId} (${l.label}) is ${json.status}: ${json.error ?? "no error given"}`);
      }
    }
    if (!pending.size) break;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${[...pending].map((l) => l.label).join(", ")}`);
    await sleep(10_000);
  }

  if (process.env.GITHUB_OUTPUT) {
    for (const l of leases)
      appendFileSync(process.env.GITHUB_OUTPUT, `${l.role}_guid=${l.guid}\n${l.role}_lease=${l.leaseId}\n`);
  }
  return leases;
}

// Teardown. Never stops at the first failure: tries every lease, then fails if any delete failed.
async function release(prefix, { reason = "run finished", olderThanHours } = {}) {
  const cutoff = olderThanHours ? Date.now() - Number(olderThanHours) * 3600_000 : Infinity;
  const live = (await list()).filter(
    (l) =>
      l.label.startsWith(prefix) &&
      !["deleting", "deleted", "kept"].includes(l.status) &&
      new Date(l.createdAt).getTime() < cutoff
  );
  if (!live.length) {
    log(`no live leases match ${prefix}${olderThanHours ? ` older than ${olderThanHours}h` : ""}`);
    return 0;
  }
  let failed = 0;
  for (const l of live) {
    try {
      await call("DELETE", `/${l.leaseId}?reason=${encodeURIComponent(reason)}`, { ok: [202, 404] });
      log(`released ${l.label} (lease ${l.leaseId}, was ${l.status})`);
    } catch (e) {
      failed++;
      log(`::error::could not release ${l.label} (lease ${l.leaseId}): ${e.message}`);
    }
  }
  if (failed)
    throw new Error(
      `${failed} of ${live.length} leases could not be released; the reaper deletes them when their TTL runs out`
    );
  return live.length;
}

async function main() {
  if (!BASE) throw new Error("LEASE_API_URL is not set");
  if (!TOKEN) throw new Error("LEASE_API_TOKEN is not set");
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opts } = args(rest);
  const prefix = pos[0];
  if (!prefix || !/^[A-Za-z0-9._-]+$/.test(prefix)) throw new Error("a label prefix is required ([A-Za-z0-9._-])");

  if (cmd === "create") await create(prefix, pos.slice(1), opts);
  else if (cmd === "release") await release(prefix, opts);
  else if (cmd === "sweep") {
    if (!opts["older-than-hours"]) throw new Error("sweep needs --older-than-hours");
    const n = await release(prefix, {
      reason: "sweep: left behind by an earlier run",
      olderThanHours: opts["older-than-hours"],
    });
    if (n) log(`::warning::swept ${n} lease(s) an earlier run left behind; its release job failed or never ran`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `swept=${n}\n`);
  } else throw new Error(`unknown command: ${cmd ?? "(none)"}`);
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
