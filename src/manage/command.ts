/**
 * Builds `agility manage <resource> <action>` from the registry. Nothing here is per command:
 * each registry entry becomes a subcommand with its positionals, flags, help and handler.
 */
import type { Argv, Options, PositionalOptions } from "yargs";
import { EXIT_CODES } from "../api-runtime/outcome";
import { finish, processWriter } from "../api-runtime/output";
import { getPackageVersion } from "../lib/shared";
import { registry, resources } from "./registry";
import { ArgSpec, Endpoint } from "./types";
import { runEndpoint } from "./runner";
import { REQUEST_METHODS, requestEndpoint, requestPath } from "./request";

export const MANAGE_GLOBAL_OPTIONS: Record<string, Options> = {
  guid: { type: "string", describe: "Instance GUID. Defaults to AGILITY_GUID in .env." },
  locale: { type: "string", describe: "Locale, e.g. en-us. Defaults to the instance's only locale." },
  json: {
    type: "boolean",
    default: false,
    describe: "Print one JSON document with status, exit code, result and errors",
  },
  output: { type: "string", choices: ["json", "table"], default: "json", describe: "Result format without --json" },
  fields: {
    type: "string",
    describe: "Comma-separated fields to keep (dotted paths allowed), e.g. contentID,fields.title",
  },
  all: { type: "boolean", default: false, describe: "Page through every result of a list action" },
  token: { type: "string", describe: "Personal access token. Defaults to AGILITY_TOKEN or your login." },
  dev: { type: "boolean", default: false, describe: "Use the dev environment" },
  yes: {
    type: "boolean",
    default: false,
    describe: "Writes and deletes: run without the confirmation prompt (required when there's no terminal)",
  },
  "dry-run": {
    type: "boolean",
    default: false,
    describe: "Writes and deletes: show what would be sent, and send nothing",
  },
  wait: {
    type: "boolean",
    default: true,
    describe: "Wait for the write's batch to finish and report each item. --no-wait returns the batch IDs",
  },
  timeout: { type: "number", default: 300, describe: "Seconds to wait for a batch" },
};

function yargsType(spec: ArgSpec): "string" | "number" | "boolean" {
  if (spec.type === "number") return "number";
  if (spec.type === "boolean") return "boolean";
  // Arrays are comma-separated strings; JSON is a string, @file or -.
  return "string";
}

function commandString(e: Endpoint): string {
  const positionals = e.args.filter((a) => a.kind === "positional").map((a) => `<${a.name}>`);
  return [e.action, ...positionals].join(" ");
}

function buildAction(y: Argv, e: Endpoint): Argv {
  for (const spec of e.args) {
    if (spec.kind === "positional") {
      const opt: PositionalOptions = { type: yargsType(spec), describe: spec.describe };
      if (spec.choices) opt.choices = spec.choices;
      y.positional(spec.name, opt);
    } else {
      const opt: Options = { type: yargsType(spec), describe: spec.describe };
      if (spec.default !== undefined) opt.default = spec.default;
      if (spec.choices) opt.choices = spec.choices;
      y.option(spec.name, opt);
    }
  }
  return y;
}

function usageDocument(command: string, message: string): number {
  return finish(
    {
      command,
      status: "usage",
      result: undefined,
      errors: [{ status: "usage", message }],
      warnings: [],
      startedAt: new Date(),
      cliVersion: getPackageVersion(),
    },
    { json: process.argv.indexOf("--json") !== -1, output: "json" },
    processWriter
  );
}

/** A usage error from yargs itself (unknown action, missing positional). Exits 2. */
function onUsageError(msg: string | undefined, err: Error | undefined, y: Argv) {
  const message = msg || err?.message || "Invalid command";
  if (process.argv.indexOf("--json") !== -1) {
    process.exitCode = usageDocument("manage", message);
    return;
  }
  y.showHelp();
  process.stderr.write(`\n${message}\n`);
  process.exitCode = EXIT_CODES.usage;
}

/** Takes the `yargs` namespace import that src/index.ts uses, or any Argv. */
export function registerManageCommand(y: { command: Argv["command"] }): void {
  y.command({
    command: "manage",
    describe: "Call the Management API directly: agility manage <resource> <action>",
    builder: (my: Argv) => {
      my.options(MANAGE_GLOBAL_OPTIONS);
      for (const resource of resources()) {
        const endpoints = registry.filter((e) => e.resource === resource);
        my.command({
          command: resource,
          describe: endpoints.map((e) => e.action).join(", "),
          builder: (ry: Argv) => {
            for (const e of endpoints) {
              ry.command({
                command: commandString(e),
                describe: e.describe,
                builder: (ay: Argv) => buildAction(ay, e),
                handler: async (argv: any) => {
                  process.exitCode = await runEndpoint(e, argv);
                },
              });
            }
            return ry.demandCommand(1, `Choose a ${resource} action.`).fail(onUsageError);
          },
          // Reached only when the word after the resource isn't one of its actions.
          handler: (argv: any) => {
            const actions = endpoints.map((e) => e.action).join(", ");
            onUsageError(`Unknown ${resource} action "${argv._[2]}". Choose one of: ${actions}.`, undefined, my);
          },
        });
      }
      my.command({
        command: "request <method> <path>",
        describe: "A raw Management API call, for operations the SDK doesn't wrap (GET, POST, PUT, DELETE)",
        builder: (ay: Argv) =>
          ay
            .positional("method", { type: "string", describe: REQUEST_METHODS.join(", ") })
            .positional("path", { type: "string", describe: "Path under /api/v1/instance/<guid>/, e.g. locales" })
            .option("data", { type: "string", describe: "Request body as JSON, @file.json, or - for stdin" }),
        handler: async (argv: any) => {
          let endpoint;
          try {
            requestPath(argv.path);
            endpoint = requestEndpoint(argv.method);
          } catch (err: any) {
            process.exitCode = usageDocument(`manage request`, err.message);
            return;
          }
          process.exitCode = await runEndpoint(endpoint, argv);
        },
      });
      return my.demandCommand(1, "Choose a resource.").fail(onUsageError);
    },
    handler: (argv: any) => {
      onUsageError(
        `Unknown resource "${argv._[1]}". Choose one of: ${resources().concat("request").join(", ")}.`,
        undefined,
        y as Argv
      );
    },
  });
}
