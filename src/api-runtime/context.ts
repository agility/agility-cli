/**
 * What every API command needs before it can call anything: a token, the instance guid, the
 * region's base URL and, for locale-scoped calls, a locale.
 *
 * This is deliberately separate from `Auth.init()`, which also fetches Fetch/Preview keys for a
 * source and a target, loads the user and sets up the sync UI. None of that applies here.
 */
import * as mgmtApi from "@agility/management-sdk";
import { Auth } from "../core/auth";
import { state, resetState, primeFromEnv } from "../core/state";
import { CliError } from "./outcome";

export interface ApiArgs {
  guid?: string;
  locale?: string;
  dev?: boolean;
}

export interface ApiContext {
  guid: string;
  baseUrl: string;
  client: mgmtApi.ApiClient;
  /** Resolved on first use, so calls that don't need a locale never fetch the instance's locales. */
  locale: () => Promise<string>;
}

/** Instance guid: --guid, then AGILITY_GUID from a .env file. Never prompts. */
export function resolveGuid(argGuid: string | undefined, envGuid: string | undefined): string {
  const guid = (argGuid || envGuid || "").trim();
  if (!guid) {
    throw new CliError("usage", "No instance given. Pass --guid <guid> or set AGILITY_GUID in .env.");
  }
  return guid;
}

/**
 * Locale: --locale, then AGILITY_LOCALES from .env when it names exactly one, then the
 * instance's only locale. Several candidates and no --locale is a usage error, never a guess.
 */
export async function resolveLocale(
  argLocale: string | undefined,
  envLocales: string[],
  fetchLocales: () => Promise<string[]>
): Promise<string> {
  if (argLocale && argLocale.trim()) return argLocale.trim();
  const fromEnv = envLocales.map((l) => l.trim()).filter(Boolean);
  if (fromEnv.length === 1) return fromEnv[0];
  if (fromEnv.length > 1) {
    throw new CliError("usage", `Several locales in AGILITY_LOCALES (${fromEnv.join(", ")}). Pass --locale.`);
  }
  const locales = await fetchLocales();
  if (locales.length === 1) return locales[0];
  throw new CliError(
    "usage",
    locales.length === 0
      ? "The instance has no locales. Pass --locale."
      : `The instance has several locales (${locales.join(", ")}). Pass --locale.`
  );
}

export async function createApiContext(args: ApiArgs): Promise<ApiContext> {
  // Read .env the same way the other commands do, without carrying state between commands.
  resetState();
  primeFromEnv();
  if (args.dev) state.dev = true;

  const guid = resolveGuid(args.guid, state.sourceGuid);
  state.sourceGuid = guid;

  const auth = new Auth();
  let token: string;
  try {
    token = await auth.getToken();
  } catch (err: any) {
    throw new CliError("auth", stripEmoji(err?.message || "Not logged in. Run `agility login`."));
  }

  const baseUrl = auth.determineBaseUrl(guid);
  const options = new mgmtApi.Options();
  options.token = token;
  options.baseUrl = baseUrl;
  const client = new mgmtApi.ApiClient(options);

  const envLocales = state.locale.slice();
  let cached: Promise<string> | null = null;
  return {
    guid,
    baseUrl,
    client,
    locale: () => {
      if (!cached) {
        cached = resolveLocale(args.locale, envLocales, async () => {
          const locales = await client.instanceMethods.getLocales(guid);
          // The SDK types this as string arrays, but the API returns objects with `localeCode`.
          return Array.isArray(locales) ? locales.map((l: any) => (typeof l === "string" ? l : l?.localeCode)) : [];
        });
      }
      return cached;
    },
  };
}

function stripEmoji(message: string): string {
  return message.replace(/^[^\w`'"(]+/, "").trim();
}
