/**
 * Output for the API commands. stdout carries only the result (or, with --json, the result
 * document); everything else goes to stderr so `agility manage ... | jq` works.
 */
import { EXIT_CODES, Status } from "./outcome";

export const JSON_DOCUMENT_SCHEMA_VERSION = 1;

export type OutputFormat = "json" | "table";

export interface ItemOutcome {
  [key: string]: unknown;
  status: Status;
  httpStatus?: number;
  message?: string;
}

export interface ErrorEntry {
  [key: string]: unknown;
  status: Status;
  message: string;
  httpStatus?: number;
}

export interface ResultDocument {
  schemaVersion: number;
  command: string;
  status: Status;
  exitCode: number;
  result: unknown;
  items?: ItemOutcome[];
  errors: ErrorEntry[];
  warnings: string[];
  /** Fields that change between otherwise identical runs, kept apart so golden-file tests can drop one key. */
  run: { startedAt: string; durationMs: number; cliVersion: string };
}

export interface Writer {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
}

export const processWriter: Writer = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: !!process.stdout.isTTY,
};

/** Read a dotted path ("a.b.c") from an object. */
function getPath(obj: any, path: string): unknown {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj: any, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function pick(obj: unknown, fields: string[]): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = getPath(obj, f);
    if (v !== undefined) setPath(out, f, v);
  }
  return out;
}

/**
 * The list keys of the SDK's paged results: ContentList and PagedResult (`items`), AssetMediaList
 * (`assetMedias`), assetGalleries (`assetMediaGroupings`). Other objects that happen to hold an
 * array, such as a user's `websiteAccess`, are single results.
 */
const PAGED_LIST_KEYS = ["items", "assetMedias", "assetMediaGroupings"];

/** The array a result is "a list of", if any: the result itself, or the list of a paged result. */
export function listOf(result: unknown): { key: string | null; list: unknown[] } | null {
  if (Array.isArray(result)) return { key: null, list: result };
  if (result && typeof result === "object") {
    for (const key of PAGED_LIST_KEYS) {
      const value = (result as any)[key];
      if (Array.isArray(value)) return { key, list: value };
    }
  }
  return null;
}

/** Trim a result client-side to the given fields. Applies per item when the result is a list. */
export function selectFields(result: unknown, fields: string[] | undefined): unknown {
  if (!fields || fields.length === 0) return result;
  const l = listOf(result);
  if (l) {
    const picked = l.list.map((item) => pick(item, fields));
    if (l.key === null) return picked;
    return { ...(result as object), [l.key]: picked };
  }
  return pick(result, fields);
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).replace(/\s+/g, " ");
}

/** A plain-text table of a list result: one row per item, one column per top-level key. */
export function renderTable(result: unknown): string {
  const l = listOf(result);
  const rows: any[] = l ? l.list : [result];
  if (rows.length === 0) return "(no results)\n";
  const columns: string[] = [];
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) if (columns.indexOf(k) === -1) columns.push(k);
    }
  }
  if (columns.length === 0) return rows.map((r) => cell(r)).join("\n") + "\n";
  const MAX = 60;
  const text = rows.map((r) => columns.map((c) => cell(r?.[c]).slice(0, MAX)));
  const widths = columns.map((c, i) => Math.max(c.length, ...text.map((t) => t[i].length)));
  const line = (vals: string[]) =>
    vals
      .map((v, i) => v + " ".repeat(widths[i] - v.length))
      .join("  ")
      .replace(/\s+$/, "");
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...text.map(line)].join("\n") + "\n";
}

export function renderJson(value: unknown, pretty: boolean): string {
  return (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + "\n";
}

export interface FinishInput {
  command: string;
  status: Status;
  result: unknown;
  items?: ItemOutcome[];
  errors: ErrorEntry[];
  warnings: string[];
  startedAt: Date;
  cliVersion: string;
}

export interface FinishOptions {
  json: boolean;
  output: OutputFormat;
  fields?: string[];
}

/**
 * The single exit point for the API commands. Writes the result or the document, prints errors
 * and warnings to stderr, and returns the exit code. The caller sets `process.exitCode`; nothing
 * here calls `process.exit()`, so stdout always flushes.
 */
export function finish(input: FinishInput, opts: FinishOptions, w: Writer = processWriter): number {
  const exitCode = EXIT_CODES[input.status];
  const result = selectFields(input.result, opts.fields);

  for (const warning of input.warnings) w.stderr(`warning: ${warning}\n`);
  for (const e of input.errors) w.stderr(`error: ${e.message}\n`);

  if (opts.json) {
    const doc: ResultDocument = {
      schemaVersion: JSON_DOCUMENT_SCHEMA_VERSION,
      command: input.command,
      status: input.status,
      exitCode,
      result: result === undefined ? null : result,
      ...(input.items ? { items: input.items } : {}),
      errors: input.errors,
      warnings: input.warnings,
      run: {
        startedAt: input.startedAt.toISOString(),
        durationMs: Date.now() - input.startedAt.getTime(),
        cliVersion: input.cliVersion,
      },
    };
    w.stdout(renderJson(doc, w.isTTY));
    return exitCode;
  }

  if (result !== undefined) {
    w.stdout(opts.output === "table" ? renderTable(result) : renderJson(result, w.isTTY));
  }
  return exitCode;
}
