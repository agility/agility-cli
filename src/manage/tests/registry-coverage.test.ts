import * as mgmtApi from "@agility/management-sdk";
import { registry, PLANNED_SDK_METHODS, SKIPPED_SDK_METHODS } from "../registry";

/** Every public method on every `*Methods` group of the SDK client, as "group.method". */
function sdkMethods(): string[] {
  const options = new mgmtApi.Options();
  options.token = "test";
  const client = new mgmtApi.ApiClient(options) as any;
  const out: string[] = [];
  for (const group of Object.keys(client)) {
    if (!/Methods$/.test(group)) continue;
    const proto = Object.getPrototypeOf(client[group]);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || name.startsWith("_")) continue;
      if (typeof proto[name] !== "function") continue;
      out.push(`${group}.${name}`);
    }
  }
  return out.sort();
}

describe("manage registry coverage", () => {
  const sdk = sdkMethods();
  const exposed = registry.reduce<string[]>((acc, e) => acc.concat(e.sdk), []);

  it("finds the SDK's method groups", () => {
    expect(sdk.length).toBeGreaterThan(50);
  });

  it("exposes, plans or skips every public SDK method", () => {
    const known = new Set([...exposed, ...PLANNED_SDK_METHODS, ...SKIPPED_SDK_METHODS]);
    const missing = sdk.filter((m) => !known.has(m));
    // A new SDK method lands here. Add a registry entry, or list it as planned or skipped.
    expect(missing).toEqual([]);
  });

  it("names only methods the SDK has", () => {
    const names = new Set(sdk);
    const unknown = [...exposed, ...PLANNED_SDK_METHODS, ...SKIPPED_SDK_METHODS].filter((m) => !names.has(m));
    // An SDK rename or removal lands here.
    expect(unknown).toEqual([]);
  });

  it("lists each SDK method once", () => {
    const all = [...exposed, ...PLANNED_SDK_METHODS, ...SKIPPED_SDK_METHODS];
    const dupes = all.filter((m, i) => all.indexOf(m) !== i);
    expect(dupes).toEqual([]);
  });

  it("has no duplicate resource/action pairs", () => {
    const keys = registry.map((e) => `${e.resource} ${e.action}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it("exposes only reads until the write guards land", () => {
    expect(registry.filter((e) => e.effect !== "read").map((e) => `${e.resource} ${e.action}`)).toEqual([]);
  });
});
