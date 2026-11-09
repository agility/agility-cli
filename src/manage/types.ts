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
  call: (client: mgmtApi.ApiClient, a: ResolvedArgs) => Promise<unknown>;
}

export const pos = (name: string, type: ArgType, describe: string): ArgSpec => ({
  name,
  kind: "positional",
  type,
  describe,
  required: true,
});

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
