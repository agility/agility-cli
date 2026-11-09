import * as fs from "fs";
import type * as mgmtApi from "@agility/management-sdk";
import { ApiArgs, ApiContext, createApiContext } from "../api-runtime/context";
import { CliError, httpStatusOf, messageOf, statusOf } from "../api-runtime/outcome";
import { finish, listOf, OutputFormat, processWriter, Writer } from "../api-runtime/output";
import { getPackageVersion } from "../lib/shared";
import { ArgSpec, camel, Endpoint, ResolvedArgs } from "./types";

export interface GlobalArgs extends ApiArgs {
  json?: boolean;
  output?: OutputFormat;
  fields?: string;
  all?: boolean;
  [key: string]: unknown;
}

export interface RunDeps {
  createContext: (args: ApiArgs) => Promise<ApiContext>;
  writer: Writer;
  readStdin: () => string;
  readFile: (path: string) => string;
  cliVersion: () => string;
}

export const defaultDeps: RunDeps = {
  createContext: createApiContext,
  writer: processWriter,
  readStdin: () => fs.readFileSync(0, "utf8"),
  readFile: (p) => fs.readFileSync(p, "utf8"),
  cliVersion: getPackageVersion,
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
  const base = { command: commandName(e), startedAt, cliVersion: deps.cliVersion(), warnings: [] as string[] };
  try {
    const values = collectArgs(e, argv, deps);
    if (argv.all && !e.paged) {
      throw new CliError("usage", `--all isn't supported by ${commandName(e)}`);
    }
    const ctx = await deps.createContext({ guid: argv.guid, locale: argv.locale, dev: argv.dev });
    const a: ResolvedArgs = {
      ...values,
      guid: ctx.guid,
      locale: e.needsLocale ? await ctx.locale() : argv.locale || undefined,
    };
    const result = argv.all ? await callAll(e, ctx.client, a) : await e.call(ctx.client, a);
    return finish({ ...base, status: "ok", result, errors: [] }, opts, deps.writer);
  } catch (err) {
    const status = statusOf(err);
    const httpStatus = httpStatusOf(err);
    return finish(
      {
        ...base,
        status,
        result: undefined,
        errors: [{ status, message: messageOf(err), ...(httpStatus ? { httpStatus } : {}) }],
      },
      opts,
      deps.writer
    );
  }
}
