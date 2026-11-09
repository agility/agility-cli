/**
 * Outcomes and exit codes for the API commands (`manage`, `fetch`).
 *
 * This contract covers only those commands. pull, push, sync, reverse-sync, verify and workflows
 * keep their own exit codes.
 */

export type Status = "ok" | "error" | "usage" | "conflict" | "auth" | "not_found" | "refused";

export const EXIT_CODES: Record<Status, number> = {
  ok: 0,
  error: 1,
  usage: 2,
  conflict: 3,
  auth: 4,
  not_found: 5,
  refused: 6,
};

/**
 * When several items have outcomes (a call on several ids), the worst one sets the exit code.
 * usage, auth and refused stop a call before it is sent, so they never mix with item outcomes,
 * but they rank highest in case they do.
 */
const SEVERITY: Status[] = ["ok", "conflict", "not_found", "error", "refused", "auth", "usage"];

export function worstStatus(statuses: Status[]): Status {
  let worst: Status = "ok";
  for (const s of statuses) {
    if (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst)) worst = s;
  }
  return worst;
}

/** An error the CLI raises itself, with the status it should exit with. */
export class CliError extends Error {
  readonly status: Status;
  readonly httpStatus?: number;
  constructor(status: Status, message: string, httpStatus?: number) {
    super(message);
    this.status = status;
    this.httpStatus = httpStatus;
    // Keep instanceof working when compiled to ES5.
    Object.setPrototypeOf(this, CliError.prototype);
  }
}

/** The HTTP status behind an error: the SDK's Exception carries `statusCode`, raw axios errors `response.status`. */
export function httpStatusOf(err: any): number | undefined {
  if (!err) return undefined;
  if (typeof err.httpStatus === "number") return err.httpStatus;
  if (typeof err.statusCode === "number") return err.statusCode;
  if (typeof err.response?.status === "number") return err.response.status;
  if (err.innerError) return httpStatusOf(err.innerError);
  return undefined;
}

/** Map any thrown value to a Status. */
export function statusOf(err: any): Status {
  if (err instanceof CliError) return err.status;
  const http = httpStatusOf(err);
  if (http === 401 || http === 403) return "auth";
  if (http === 404) return "not_found";
  // The management API returns 409 only when a write collides with something that already
  // exists (a model reference name, a duplicate webhook URL). Retrying won't help.
  if (http === 409) return "conflict";
  return "error";
}

export function messageOf(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}
