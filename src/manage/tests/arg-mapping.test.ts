import * as mgmtApi from "@agility/management-sdk";
import { registry } from "../registry";
import { ArgSpec, camel, Endpoint, ResolvedArgs } from "../types";

/**
 * Checks each registry entry hands its arguments to the SDK in the right positions. The SDK is
 * not consistent about order (`getContentItem(id, guid, locale)` but
 * `getContentHistory(locale, guid, id)`), so the guid and locale positions are read from the
 * SDK's own parameter names rather than trusted.
 */

const GUID = "guid-sentinel";
const LOCALE = "locale-sentinel";

/** Parameter names of a compiled SDK method: "function (contentID_1, guid_1, locale_1)" -> [contentID, guid, locale]. */
function paramNames(fn: (...args: any[]) => unknown): string[] {
  const m = /^[^(]*\(([^)]*)\)/.exec(fn.toString());
  if (!m) return [];
  return m[1]
    .split(",")
    .map((p) => p.trim().replace(/_\d+$/, ""))
    .filter(Boolean);
}

const realClient = (() => {
  const o = new mgmtApi.Options();
  o.token = "test";
  return new mgmtApi.ApiClient(o) as any;
})();

interface Call {
  method: string;
  args: unknown[];
}

function recordingClient(calls: Call[]): mgmtApi.ApiClient {
  const client: any = {};
  for (const group of Object.keys(realClient)) {
    if (!/Methods$/.test(group)) continue;
    client[group] = new Proxy(
      {},
      {
        get:
          (_t, method: string) =>
          async (...args: unknown[]) => {
            calls.push({ method: `${group}.${method}`, args });
            return { ok: true };
          },
      }
    );
  }
  return client;
}

function sample(spec: ArgSpec, i: number): unknown {
  switch (spec.type) {
    case "number":
      return 1000 + i;
    case "number[]":
      return [2000 + i];
    case "boolean":
      return true;
    case "string[]":
      return [`s-${spec.name}`];
    case "json":
      return { sentinel: spec.name };
    default:
      return spec.choices ? spec.choices[spec.choices.length - 1] : `s-${spec.name}`;
  }
}

function deepIncludes(haystack: unknown, needle: unknown): boolean {
  if (haystack === needle) return true;
  if (Array.isArray(needle) && Array.isArray(haystack) && JSON.stringify(needle) === JSON.stringify(haystack)) {
    return true;
  }
  if (needle && typeof needle === "object" && JSON.stringify(haystack) === JSON.stringify(needle)) return true;
  if (haystack && typeof haystack === "object") {
    return Object.keys(haystack).some((k) => deepIncludes((haystack as any)[k], needle));
  }
  return false;
}

/** Args whose value the entry transforms before the call, so they can't be found verbatim. */
const TRANSFORMED = new Set(["updated-since", "type", "zones", "include-defaults", "expand", "wait", "show-deleted"]);

async function invoke(e: Endpoint): Promise<{ call: Call; a: ResolvedArgs }> {
  const calls: Call[] = [];
  const a: ResolvedArgs = { guid: GUID, locale: LOCALE };
  e.args.forEach((spec, i) => {
    a[camel(spec.name)] = sample(spec, i);
  });
  await e.call(recordingClient(calls), a);
  expect(calls).toHaveLength(1);
  return { call: calls[0], a };
}

describe.each(registry.map((e) => [`${e.resource} ${e.action}`, e] as [string, Endpoint]))("%s", (_name, e) => {
  it("calls one of its declared SDK methods", async () => {
    const { call } = await invoke(e);
    expect(e.sdk).toContain(call.method);
  });

  it("puts guid and locale where the SDK expects them", async () => {
    const { call } = await invoke(e);
    const [group, method] = call.method.split(".");
    const names = paramNames(realClient[group][method]);
    const guidAt = names.indexOf("guid");
    expect(guidAt).toBeGreaterThanOrEqual(0);
    expect(call.args[guidAt]).toBe(GUID);
    const localeAt = names.indexOf("locale");
    if (localeAt >= 0) {
      expect(e.needsLocale).toBe(true);
      expect(call.args[localeAt]).toBe(LOCALE);
    }
  });

  it("passes every argument through", async () => {
    const { call, a } = await invoke(e);
    for (const spec of e.args) {
      if (TRANSFORMED.has(spec.name)) continue;
      expect({ arg: spec.name, found: deepIncludes(call.args, a[camel(spec.name)]) }).toEqual({
        arg: spec.name,
        found: true,
      });
    }
  });
});

describe("model list", () => {
  const e = registry.find((x) => x.resource === "model" && x.action === "list")!;
  it("lists content models by default and component models with --type component", async () => {
    const calls: Call[] = [];
    await e.call(recordingClient(calls), { guid: GUID, type: "content" });
    await e.call(recordingClient(calls), { guid: GUID, type: "component" });
    expect(calls.map((c) => c.method)).toEqual(["modelMethods.getContentModules", "modelMethods.getPageModules"]);
  });
});
