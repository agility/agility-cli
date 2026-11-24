/**
 * `agility manage request <method> <path>`: a raw call to the instance's Management API, for
 * operations the SDK doesn't wrap yet (locales, URL redirections, PATs and others; see the Swagger
 * spec). It runs through the same runner as the registry, so a POST, PUT or DELETE gets the same
 * guards: --dry-run, confirmation, the audit log and the exit codes.
 */
import axios from "axios";
import type * as mgmtApi from "@agility/management-sdk";
import { CliError } from "../api-runtime/outcome";
import { Endpoint, flag, pos } from "./types";

export const REQUEST_METHODS = ["GET", "POST", "PUT", "DELETE"];

/** The instance-relative path, checked: no absolute URLs, no climbing out of the instance. */
export function requestPath(raw: string): string {
  const p = String(raw || "")
    .trim()
    .replace(/^\/+/, "");
  if (!p) throw new CliError("usage", "Give a path, e.g. `locales` or `en-us/item/123`.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) {
    throw new CliError("usage", "Give a path relative to the instance, not a URL: the CLI adds the host and the guid.");
  }
  // URL parsing also treats an encoded "%2e%2e" as "..".
  const pathPart = p.split(/[?#]/)[0];
  if (pathPart.split(/\/|%2f/i).some((segment) => /^(\.|%2e){2}$/i.test(segment))) {
    throw new CliError("usage", 'A path can\'t contain "..".');
  }
  return p;
}

/** The token and base URL the SDK client was built with, as the sync pipeline's upload does. */
function connection(client: mgmtApi.ApiClient): { token: string; baseUrl: string } {
  const options = (client as any)._options || {};
  return { token: options.token, baseUrl: options.baseUrl };
}

export function requestEndpoint(methodArg: string): Endpoint {
  const method = String(methodArg || "").toUpperCase();
  if (REQUEST_METHODS.indexOf(method) === -1) {
    throw new CliError("usage", `Method must be one of ${REQUEST_METHODS.join(", ")}, got "${methodArg}".`);
  }
  return {
    resource: "request",
    action: method,
    describe: "A raw Management API call",
    effect: method === "GET" ? "read" : method === "DELETE" ? "delete" : "write",
    sdk: [],
    args: [
      pos("path", "string", "Path under /api/v1/instance/<guid>/, e.g. locales"),
      flag("data", "json", "Request body as JSON, @file.json, or - for stdin"),
    ],
    call: async (client, a) => {
      const { token, baseUrl } = connection(client);
      const url = `${baseUrl}/api/v1/instance/${a.guid}/${requestPath(a.path)}`;
      const resp = await axios.request({
        method: method as any,
        url,
        data: a.data,
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return resp.data === "" ? null : resp.data;
    },
  };
}
