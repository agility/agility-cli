import type * as mgmtApi from "@agility/management-sdk";

export type ArgType = "number" | "string" | "boolean" | "number[]" | "string[]" | "json";

export interface ArgSpec {
  /** CLI name, kebab-case for flags ("include-defaults"); handlers read it camelCased ("includeDefaults"). */
  name: string;
  kind: "positional" | "flag";
  type: ArgType;
  describe: string;
  required?: boolean;
  default?: unknown;
  choices?: string[];
}

/** Arguments after parsing, keyed by camelCased name, plus the resolved instance and locale. */
export interface ResolvedArgs {
  [name: string]: any;
  guid: string;
  /** Resolved for endpoints with `needsLocale`; otherwise whatever --locale was, if given. */
  locale?: string;
}

export type Effect = "read" | "write" | "delete";

export interface Endpoint {
  resource: string;
  action: string;
  describe: string;
  effect: Effect;
  /**
   * The SDK methods this entry exposes, as "<methodsGroup>.<method>" ("contentMethods.getContentItem").
   * The coverage test checks every public SDK method appears in exactly one entry or a skip list.
   */
  sdk: string[];
  args: ArgSpec[];
  needsLocale?: boolean;
  /** Names of the take/skip args, for `--all`, which pages through until a short page. */
  paged?: { take: string; skip: string };
  /**
   * The call returns batch IDs (the SDK method was called with `returnBatchId`). The runner waits
   * for the batches and reports their items, unless `--no-wait`. The SDK's own wait is never used:
   * it has no timeout unless Options.retryCount is set, and it hides which items failed.
   */
  batched?: boolean;
  /**
   * Read-only checks before a write runs, after its arguments are resolved. Each string returned
   * is a warning; none of them stop the write. Used for the last-write-wins versionID check.
   */
  checks?: (client: mgmtApi.ApiClient, a: ResolvedArgs) => Promise<string[]>;
  call: (client: mgmtApi.ApiClient, a: ResolvedArgs) => Promise<unknown>;
}

export const pos = (name: string, type: ArgType, describe: string, extra: Partial<ArgSpec> = {}): ArgSpec => ({
  name,
  kind: "positional",
  type,
  describe,
  required: true,
  ...extra,
});

/**
 * A value for a query-string position in an SDK call. The SDK concatenates query values without
 * encoding them and turns an omitted optional value into the text "undefined" or "null", so an
 * omitted value is sent as empty, which the API binds as null.
 */
export function q(value: unknown): string {
  if (value === undefined || value === null) return "";
  return encodeURIComponent(String(value));
}

export const flag = (name: string, type: ArgType, describe: string, extra: Partial<ArgSpec> = {}): ArgSpec => ({
  name,
  kind: "flag",
  type,
  describe,
  ...extra,
});

/** Shared take/skip flags for list endpoints. */
export const takeSkip = (defaultTake: number): ArgSpec[] => [
  flag("take", "number", "How many to return", { default: defaultTake }),
  flag("skip", "number", "How many to skip, for paging", { default: 0 }),
];

export function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
