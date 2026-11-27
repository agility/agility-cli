/**
 * PROD-3449: keep a browser login (Auth0) token valid for the whole run.
 *
 * A login token lasts 24 hours, and the CLI only checked it when a run started. A run that began
 * with 30 minutes left passed that check and then got 401 on every request once the token expired:
 * on 2026-11-25 a 107-minute sync's final mapping refresh hit 134 × 401, and the next run re-pushed
 * 537 unchanged items.
 *
 * Two parts:
 * - While a run is going, refresh the token through the Management API's /oauth/Refresh shortly
 *   before it expires (only possible when the login came with a refresh token, i.e. it asked for
 *   offline_access; logins from before this change didn't).
 * - When a run starts with a login that can't be refreshed and won't last a long sync, sign in again
 *   (interactive) or warn (headless). See Auth.checkAuthorization.
 *
 * Personal Access Tokens don't expire mid-run and aren't touched.
 */

export interface StoredLoginToken {
  access_token?: string | null;
  expires_in?: number | null;
  refresh_token?: string | null;
  timestamp?: string | null;
  [key: string]: any;
}

/** Refresh once the token has less than this left. */
export const REFRESH_WITHIN_MS = 15 * 60 * 1000;
/** How often the keeper checks the token while a run is going. */
export const CHECK_EVERY_MS = 60 * 1000;
/** A login that can't be refreshed and has less than this left is renewed before a run starts. */
export const MIN_LOGIN_REMAINING_MS = 4 * 60 * 60 * 1000;

/** When the token expires (ms since epoch), or null when it doesn't say. */
export function tokenExpiresAt(token: StoredLoginToken | null | undefined): number | null {
  if (!token?.timestamp || !token.expires_in) return null;
  const issuedAt = new Date(token.timestamp).getTime();
  if (Number.isNaN(issuedAt)) return null;
  return issuedAt + token.expires_in * 1000;
}

export function msUntilExpiry(token: StoredLoginToken | null | undefined, now = Date.now()): number | null {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt === null ? null : expiresAt - now;
}

/** The `sub` and `exp` of a JWT access token, or null when it isn't one. */
export function jwtClaims(accessToken: string | null | undefined): { sub?: string; exp?: number } | null {
  if (!accessToken || typeof accessToken !== "string") return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function canRefresh(token: StoredLoginToken | null | undefined): boolean {
  return typeof token?.refresh_token === "string" && token.refresh_token.length > 0;
}

/** The token to store after a refresh: the new access token, keeping the old refresh token if none came back. */
export function mergeRefreshedToken(
  previous: StoredLoginToken,
  refreshed: StoredLoginToken,
  now = new Date()
): StoredLoginToken {
  return {
    ...previous,
    access_token: refreshed.access_token,
    expires_in: refreshed.expires_in ?? previous.expires_in,
    token_type: refreshed.token_type ?? previous.token_type,
    refresh_token: refreshed.refresh_token || previous.refresh_token,
    timestamp: now.toISOString(),
  };
}

export interface TokenKeeperDeps {
  readToken: () => Promise<StoredLoginToken | null>;
  /** Refresh and store the token, and point the running API clients at it. True on success. */
  refresh: () => Promise<boolean>;
  /** The access token this process is sending now. */
  inUseToken?: () => string | null | undefined;
  /** Switch this process to another access token (one another process stored). */
  adopt?: (accessToken: string) => void;
  warn: (message: string) => void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => any;
  clearInterval?: (handle: any) => void;
}

export class TokenKeeper {
  private handle: any = null;
  private busy = false;
  private warned = false;

  constructor(private deps: TokenKeeperDeps) {}

  start(everyMs = CHECK_EVERY_MS): void {
    if (this.handle) return;
    const set = this.deps.setInterval ?? setInterval;
    this.handle = set(() => void this.check(), everyMs);
    // Don't keep the process alive just for this timer.
    if (this.handle && typeof this.handle.unref === "function") this.handle.unref();
    // Check once now too: a token close to expiry shouldn't wait a full interval.
    void this.check();
  }

  stop(): void {
    if (!this.handle) return;
    (this.deps.clearInterval ?? clearInterval)(this.handle);
    this.handle = null;
  }

  /** Refresh the token if it can be refreshed and is close to expiring. Exposed for tests. */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.deps.warn(message);
  }

  async check(): Promise<
    "refreshed" | "adopted" | "other-login" | "not-needed" | "cannot-refresh" | "failed" | "busy"
  > {
    if (this.busy) return "busy";
    this.busy = true;
    try {
      const token = await this.deps.readToken();
      const now = (this.deps.now ?? Date.now)();
      const left = msUntilExpiry(token, now);
      const inUse = this.deps.inUseToken?.();
      if (token?.access_token && inUse && token.access_token !== inUse) {
        // The keychain holds a different token than this run sends: another CLI process refreshed,
        // or someone ran `agility login`. Never switch to another account's login mid-run.
        const stored = jwtClaims(token.access_token);
        const current = jwtClaims(inUse);
        if (!stored?.sub || !current?.sub || stored.sub !== current.sub) {
          this.warnOnce(
            "Your stored login changed to a different account during this run; this run keeps its own token until it expires."
          );
          return "other-login";
        }
        // Same login, refreshed elsewhere: take it over only when ours is about to expire, rather
        // than refresh again with a refresh token the other process may already have rotated.
        const currentLeft = typeof current.exp === "number" ? current.exp * 1000 - now : null;
        if (currentLeft === null || currentLeft > REFRESH_WITHIN_MS) return "not-needed";
        if (left !== null && left > REFRESH_WITHIN_MS && this.deps.adopt) {
          this.deps.adopt(token.access_token);
          return "adopted";
        }
      }
      if (left === null || left > REFRESH_WITHIN_MS) return "not-needed";
      if (!canRefresh(token)) return "cannot-refresh";
      const ok = await this.deps.refresh();
      if (!ok && !this.warned) {
        this.warned = true;
        this.deps.warn(
          "Couldn't refresh your login token; requests may fail with 401 once it expires. Run `agility login` and sync again."
        );
      }
      return ok ? "refreshed" : "failed";
    } catch (error: any) {
      if (!this.warned) {
        this.warned = true;
        this.deps.warn(`Couldn't refresh your login token (${error?.message ?? error}).`);
      }
      return "failed";
    } finally {
      this.busy = false;
    }
  }
}
