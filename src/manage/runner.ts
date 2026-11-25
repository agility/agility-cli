import * as fs from "fs";
import type * as mgmtApi from "@agility/management-sdk";
import { ApiArgs, ApiContext, createApiContext } from "../api-runtime/context";
import { CliError, EXIT_CODES, httpStatusOf, messageOf, statusOf } from "../api-runtime/outcome";
import { ErrorEntry, finish, ItemOutcome, listOf, OutputFormat, processWriter, Writer } from "../api-runtime/output";
import { getPackageVersion } from "../lib/shared";
import { batchIDsOf, waitForBatches, WaitOptions } from "./batch-wait";
import { appendAudit, AuditEntry, confirmQuestion, isInteractive, planOf, promptYesNo } from "./guards";
import { ArgSpec, camel, Endpoint, ResolvedArgs } from "./types";

export interface GlobalArgs extends ApiArgs {
  json?: boolean;
  output?: OutputFormat;
  fields?: string;
  all?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  /** false with --no-wait. */
  wait?: boolean;
  /** Seconds to wait for a batch. */
  timeout?: number;
  [key: string]: unknown;
}

export interface RunDeps {
  createContext: (args: ApiArgs) => Promise<ApiContext>;
  writer: Writer;
  readStdin: () => string;
  readFile: (path: string) => string;
  cliVersion: () => string;
  /** Whether a person can answer a prompt (stdin and stderr are terminals). */
  interactive: () => boolean;
  confirm: (question: string) => Promise<boolean>;
  /** Record a write. Returns a warning when the record couldn't be written. */
  audit: (entry: AuditEntry) => string | null;
  /** Overrides for batch polling; tests make it instant. */
  wait?: Partial<WaitOptions>;
}

export const defaultDeps: RunDeps = {
  createContext: createApiContext,
  writer: processWriter,
  readStdin: () => fs.readFileSync(0, "utf8"),
  readFile: (p) => fs.readFileSync(p, "utf8"),
  cliVersion: getPackageVersion,
  interactive: isInteractive,
  confirm: promptYesNo,
  audit: (entry) => appendAudit(entry),
};

/** A JSON argument: inline JSON, `@path/to/file.json`, or `-` for stdin. */
export function parseJsonArg(name: string, raw: unknown, deps: Pick<RunDeps, "readStdin" | "readFile">): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return raw;
  let text = raw;
  try {
    if (raw === "-") text = deps.readStdin();
    else if (raw.startsWith("@")) text = deps.readFile(raw.slice(1));
  } catch (err) {
    throw new CliError("usage", `--${name}: could not read ${raw === "-" ? "stdin" : raw.slice(1)}: ${messageOf(err)}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError("usage", `--${name}: not valid JSON: ${messageOf(err)}`);
  }
}

function coerce(spec: ArgSpec, raw: unknown, deps: RunDeps): unknown {
  if (raw === undefined || raw === null) {
    if (spec.required)
      throw new CliError("usage", `Missing ${spec.kind === "positional" ? "<" + spec.name + ">" : "--" + spec.name}`);
    return undefined;
  }
  switch (spec.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!isFinite(n)) throw new CliError("usage", `${spec.name} must be a number`);
      return n;
    }
    case "number[]": {
      const list = (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => Number(String(v).trim()));
      if (list.some((n) => !isFinite(n))) throw new CliError("usage", `${spec.name} must be numbers, got "${raw}"`);
      return list;
    }
    case "string[]":
      return (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => String(v).trim()).filter(Boolean);
    case "boolean":
      return !!raw;
    case "json":
      return parseJsonArg(spec.name, raw, deps);
    default:
      return String(raw);
  }
}

/** Collect an endpoint's arguments from parsed argv, keyed by camelCased name. */
export function collectArgs(e: Endpoint, argv: Record<string, unknown>, deps: RunDeps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of e.args) {
    const key = camel(spec.name);
    out[key] = coerce(spec, argv[key] ?? argv[spec.name], deps);
  }
  return out;
}

/** Page through a list endpoint until a short page, merging the pages into one result. */
export async function callAll(e: Endpoint, client: mgmtApi.ApiClient, a: ResolvedArgs): Promise<unknown> {
  if (!e.paged) return e.call(client, a);
  const takeKey = camel(e.paged.take);
  const skipKey = camel(e.paged.skip);
  const take = Number(a[takeKey]) > 0 ? Number(a[takeKey]) : 100;
  let skip = Number(a[skipKey]) || 0;
  let first: unknown = undefined;
  let key: string | null = null;
  const all: unknown[] = [];
  // A hard cap so a server that ignores skip can't loop forever.
  for (let pages = 0; pages < 10000; pages++) {
    const result = await e.call(client, { ...a, [takeKey]: take, [skipKey]: skip });
    const l = listOf(result);
    if (!l) return result;
    if (first === undefined) {
      first = result;
      key = l.key;
    }
    all.push(...l.list);
    const total = (result as any)?.totalCount;
    if (l.list.length < take || (typeof total === "number" && all.length >= total)) break;
    skip += l.list.length;
  }
  return key === null ? all : { ...(first as object), [key]: all };
}

export function commandName(e: Endpoint): string {
  return `manage ${e.resource} ${e.action}`;
}

interface Outcome {
  status: "ok" | "error";
  result: unknown;
  items?: ItemOutcome[];
  errors: ErrorEntry[];
}

/** Call a write, then wait for its batches unless --no-wait. */
async function runWrite(
  e: Endpoint,
  client: mgmtApi.ApiClient,
  a: ResolvedArgs,
  argv: GlobalArgs,
  deps: RunDeps
): Promise<Outcome> {
  const raw = await e.call(client, a);
  if (!e.batched) return { status: "ok", result: raw, errors: [] };
  const batchIDs = batchIDsOf(raw);
  if (argv.wait === false) {
    return { status: "ok", result: { batchIDs, waited: false }, errors: [] };
  }
  const timeout = Number(argv.timeout);
  const waited = await waitForBatches(client, a.guid, batchIDs, {
    ...(timeout > 0 ? { timeoutMs: timeout * 1000 } : {}),
    ...deps.wait,
  });
  return { status: waited.ok ? "ok" : "error", result: waited.result, items: waited.items, errors: waited.errors };
}

/** Run one endpoint and return the exit code. Never throws. */
export async function runEndpoint(e: Endpoint, argv: GlobalArgs, deps: RunDeps = defaultDeps): Promise<number> {
  const startedAt = new Date();
  const opts = {
    json: !!argv.json,
    output: (argv.output === "table" ? "table" : "json") as OutputFormat,
    fields: argv.fields
      ? String(argv.fields)
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
      : undefined,
  };
  const command = commandName(e);
  const warnings: string[] = [];
  const base = { command, startedAt, cliVersion: deps.cliVersion(), warnings };
  const isWrite = e.effect !== "read";
  let a: ResolvedArgs | undefined;

  try {
    const values = collectArgs(e, argv, deps);
    if (argv.all && !e.paged) {
      throw new CliError("usage", `--all isn't supported by ${command}`);
    }
    const ctx = await deps.createContext({ guid: argv.guid, locale: argv.locale, dev: argv.dev });
    a = {
      ...values,
      guid: ctx.guid,
      locale: e.needsLocale ? await ctx.locale() : argv.locale || undefined,
    };

    if (!isWrite) {
      const result = argv.all ? await callAll(e, ctx.client, a) : await e.call(ctx.client, a);
      return finish({ ...base, status: "ok", result, errors: [] }, opts, deps.writer);
    }

    if (e.checks) {
      try {
        warnings.push(...(await e.checks(ctx.client, a)));
      } catch (err) {
        warnings.push(`Couldn't run the pre-write checks: ${messageOf(err)}`);
      }
    }
    const plan = planOf(e, a, command);
    if (argv.dryRun) {
      return finish({ ...base, status: "ok", result: { dryRun: true, plan }, errors: [] }, opts, deps.writer);
    }
    if (!argv.yes) {
      if (!deps.interactive()) {
        throw new CliError("refused", `${command} changes data on ${a.guid}. Pass --yes to run it without a prompt.`);
      }
      // The prompt shows the warnings; don't print them again at the end.
      const shown = warnings.splice(0, warnings.length);
      if (!(await deps.confirm(confirmQuestion(plan, shown)))) {
        throw new CliError("refused", "Cancelled.");
      }
    }

    const outcome = await runWrite(e, ctx.client, a, argv, deps);
    const warning = record(deps, e, a, command, outcome.status, EXIT_CODES[outcome.status], outcome);
    if (warning) warnings.push(warning);
    return finish({ ...base, ...outcome }, opts, deps.writer);
  } catch (err) {
    const status = statusOf(err);
    const httpStatus = httpStatusOf(err);
    const errors = [{ status, message: messageOf(err), ...(httpStatus ? { httpStatus } : {}) }];
    // Record a write that reached the API and failed; not a refusal or a bad argument.
    if (isWrite && a && status !== "refused" && status !== "usage" && !argv.dryRun) {
      const warning = record(deps, e, a, command, status, EXIT_CODES[status], undefined, messageOf(err));
      if (warning) warnings.push(warning);
    }
    return finish({ ...base, status, result: undefined, errors }, opts, deps.writer);
  }
}

function record(
  deps: RunDeps,
  e: Endpoint,
  a: ResolvedArgs,
  command: string,
  status: string,
  exitCode: number,
  outcome?: Outcome,
  error?: string
): string | null {
  const plan = planOf(e, a, command);
  const r: any = outcome?.result;
  const warning = deps.audit({
    at: new Date().toISOString(),
    cliVersion: deps.cliVersion(),
    command,
    guid: plan.guid,
    ...(plan.locale ? { locale: plan.locale } : {}),
    args: plan.args,
    status,
    exitCode,
    ...(r && Array.isArray(r.batchIDs) ? { batchIDs: r.batchIDs } : {}),
    ...(r && Array.isArray(r.itemIDs) ? { itemIDs: r.itemIDs } : {}),
    ...(error ? { error } : {}),
  });
  return warning;
}
