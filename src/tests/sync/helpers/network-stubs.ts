/**
 * Belt-and-braces stubs for the code paths that do NOT go through `getApiClient()`.
 *
 * Injecting `state.cachedApiClient` redirects the great majority of the pipeline, but four
 * things reach the network on their own and would otherwise escape a "hermetic" test:
 *
 * | Escape                            | Where                                            |
 * | --------------------------------- | ------------------------------------------------ |
 * | Content + page pull               | `@agility/content-sync`                          |
 * | Asset upload (raw axios)          | `lib/pushers/asset-pusher`                       |
 * | URL redirections (global `fetch`) | `lib/pushers/url-redirection-api`                |
 * | Login (global `fetch`)            | `core/auth`                                      |
 *
 * A test that leaves one of these live does not fail loudly — it hangs on DNS, or worse,
 * quietly succeeds against something real. These stubs make the escape routes inert.
 *
 * ## Module mocks belong in the test file, inline
 *
 * `jest.mock` calls are hoisted above the imports, so a factory that references an imported
 * binding throws "Cannot read properties of undefined" before any test runs. That means the
 * module mocks cannot be shared from here — write them inline in each test file:
 *
 * ```ts
 * jest.mock("lib/pushers/batch-polling", () => ({
 *   pollBatchUntilComplete: jest.fn().mockResolvedValue({}),
 *   extractContentBatchResults: jest.fn().mockReturnValue([]),
 * }));
 * ```
 *
 * This file therefore supplies only the runtime stubbing, which is not hoisted.
 */

export interface InstalledNetworkStubs {
  /** Every global fetch call made during the test, for assertions. */
  fetchCalls: Array<{ url: string; init?: any }>;
  restore(): void;
}

/**
 * Replace global `fetch` with a stub that records and refuses.
 *
 * It rejects rather than returning an empty 200: a silent empty response looks like "the
 * endpoint returned nothing", which is a legitimate state the pushers handle, so a test could
 * pass while never noticing it went to the wire. A rejection is unmistakable.
 */
export function installNetworkStubs(): InstalledNetworkStubs {
  const fetchCalls: Array<{ url: string; init?: any }> = [];
  const originalFetch = (globalThis as any).fetch;

  (globalThis as any).fetch = jest.fn(async (url: any, init?: any) => {
    fetchCalls.push({ url: String(url), init });
    throw new Error(
      `Hermetic test attempted a real fetch to ${String(url)}. ` +
        `Stub the caller, or extend network-stubs if this is a new escape route.`
    );
  });

  return {
    fetchCalls,
    restore() {
      (globalThis as any).fetch = originalFetch;
    },
  };
}
