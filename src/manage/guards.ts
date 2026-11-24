/**
 * The guards around a write or delete: the plan shown by --dry-run and the confirmation prompt,
 * the confirmation itself, and the local audit log.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { ArgSpec, camel, Endpoint, ResolvedArgs } from "./types";

export interface WritePlan {
  command: string;
  effect: Endpoint["effect"];
  guid: string;
  locale?: string;
  sdk: string[];
  /** The arguments, with JSON bodies summarised (see summariseArgs). */
  args: Record<string, unknown>;
}

/** A JSON body in the plan or the audit log: its size, hash and, for an array, length. Never the body. */
function summariseJson(value: unknown): Record<string, unknown> {
  const text = JSON.stringify(value) ?? "";
  return {
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    ...(Array.isArray(value) ? { count: value.length } : {}),
  };
}

export function summariseArgs(specs: ArgSpec[], a: ResolvedArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    const v = a[camel(spec.name)];
    if (v === undefined) continue;
    out[spec.name] = spec.type === "json" ? summariseJson(v) : v;
  }
  return out;
}

export function planOf(e: Endpoint, a: ResolvedArgs, command: string): WritePlan {
  return {
    command,
    effect: e.effect,
    guid: a.guid,
    ...(e.needsLocale ? { locale: a.locale } : {}),
    sdk: e.sdk,
    args: summariseArgs(e.args, a),
  };
}

/** The question asked before a write. Warnings come first so they're read before answering. */
export function confirmQuestion(plan: WritePlan, warnings: string[]): string {
  const target = plan.locale ? `${plan.guid} (${plan.locale})` : plan.guid;
  const ids = Object.entries(plan.args)
    .filter(([, v]) => typeof v !== "object" || Array.isArray(v))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
    .join(" ");
  const verb = plan.effect === "delete" ? "DELETE" : "change";
  return [
    ...warnings.map((w) => `warning: ${w}`),
    `${plan.command}${ids ? " " + ids : ""} will ${verb} data on ${target}. Continue? [y/N] `,
  ].join("\n");
}

/** Ask on the terminal (stderr, so stdout stays clean). Only a y or yes answer counts. */
export function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Both ends must be a terminal: a prompt nobody can see, or answered by piped input, isn't consent. */
export function isInteractive(): boolean {
  return !!process.stdin.isTTY && !!process.stderr.isTTY;
}

export interface AuditEntry {
  at: string;
  cliVersion: string;
  command: string;
  guid: string;
  locale?: string;
  args: Record<string, unknown>;
  status: string;
  exitCode: number;
  batchIDs?: number[];
  itemIDs?: number[];
  error?: string;
}

/**
 * Where the audit log goes: AGILITY_AUDIT_LOG, or ~/.agility/manage-audit.jsonl. Set
 * AGILITY_AUDIT_LOG=off to turn it off.
 */
export function auditLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.AGILITY_AUDIT_LOG || "").trim();
  if (configured.toLowerCase() === "off") return null;
  return configured || path.join(os.homedir(), ".agility", "manage-audit.jsonl");
}

/** Append one line to the audit log. Returns a warning if it can't, and never throws. */
export function appendAudit(entry: AuditEntry, file: string | null = auditLogPath()): string | null {
  if (!file) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
    return null;
  } catch (err: any) {
    return `Couldn't write the audit log ${file}: ${err?.message || err}`;
  }
}
