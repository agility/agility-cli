/**
 * PROD-2542: validate a content item's fields against its (target) model before the payload is
 * sent to the Management API.
 *
 * The batch engine enforces a Required field at the database ("Column 'promoTitle' does not allow
 * nulls."), so an item missing one fails server-side with an opaque error — and, inside a batch,
 * used to be reported against whichever item happened to share its index. Catching it here lets the
 * CLI skip the item client-side with a precise reason.
 *
 * Deliberately conservative: only a missing/null value for a SCALAR required field is a failure (the
 * DB rejection is confirmed for those). Attachments, galleries, linked content and custom fields are
 * only warned about, since it isn't confirmed the API rejects them. Everything else (empty strings,
 * over-length text, unknown dropdown values) is a warning and never blocks the item.
 *
 * Pure: no state, no I/O. Keep the exported signatures stable — another branch copies this file.
 */

export interface RequiredFieldIssue {
  name: string;
  type: string;
}

export interface FieldValidationResult {
  missing: RequiredFieldIssue[];
  warnings: string[];
}

/** Field types whose missing required value is a confirmed server-side (DB) failure. Lower-cased. */
const SCALAR_FIELD_TYPES = new Set([
  "text",
  "longtext",
  "html",
  "integer",
  "decimal",
  "date",
  "dropdownlist",
  "boolean",
]);

/** Model settings are strings ("True"/"true"/"False"/"") or absent — compare case-insensitively. */
function isTruthySetting(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/**
 * Parse a DropdownList `settings.Choices` value. Real model data stores one choice per line as
 * "Label|value" (e.g. "Static|static\nDynamic|dynamic"); a line without "|" is its own value.
 */
export function parseDropdownChoices(choices: unknown): string[] {
  if (typeof choices !== "string" || choices.trim() === "") return [];
  return choices
    .split(/\r?\n/)
    .map((line) => {
      const pipe = line.indexOf("|");
      return (pipe >= 0 ? line.substring(pipe + 1) : line).trim();
    })
    .filter((value) => value !== "");
}

/**
 * Check `fields` (a content item's field map, as pulled from the source) against `model`.
 * Item field keys match model field names case-insensitively (model "Title" ↔ item "title").
 */
export function validateContentItemAgainstModel(
  fields: Record<string, any> | null | undefined,
  model: { referenceName?: string; fields?: any[] } | null | undefined
): FieldValidationResult {
  const result: FieldValidationResult = { missing: [], warnings: [] };
  if (!model || !Array.isArray(model.fields) || model.fields.length === 0) return result;

  // Case-insensitive view of the item's fields (an absent key and an explicit null both count as missing).
  const itemFields = new Map<string, any>();
  for (const [key, value] of Object.entries(fields || {})) {
    itemFields.set(key.toLowerCase(), value);
  }

  for (const fieldDef of model.fields) {
    if (!fieldDef || typeof fieldDef.name !== "string" || fieldDef.name === "") continue;
    const type = String(fieldDef.type || "");
    const typeKey = type.toLowerCase();
    if (typeKey === "tab") continue;

    const settings = fieldDef.settings || {};
    const name: string = fieldDef.name;
    const key = name.toLowerCase();
    const value = itemFields.get(key);

    if (isTruthySetting(settings.Required)) {
      if (value === null || value === undefined) {
        if (SCALAR_FIELD_TYPES.has(typeKey)) {
          result.missing.push({ name, type });
        } else {
          result.warnings.push(`Required field ${name} (${type}) has no value`);
        }
        continue;
      }
      if (typeof value === "string" && value.trim() === "") {
        result.warnings.push(`Required field ${name} (${type}) is empty`);
        continue;
      }
    }

    if (value === null || value === undefined) continue;

    // Text over its configured Length ("" / "0" mean unlimited).
    if (typeKey === "text" && typeof value === "string") {
      const maxLength = parseInt(String(settings.Length ?? ""), 10);
      if (maxLength > 0 && value.length > maxLength) {
        result.warnings.push(`Field ${name} (${type}) is ${value.length} characters, over its Length of ${maxLength}`);
      }
    }

    // DropdownList value not among the configured Choices (compared case-insensitively).
    if (typeKey === "dropdownlist" && (typeof value === "string" || typeof value === "number")) {
      const text = String(value).trim();
      const choices = parseDropdownChoices(settings.Choices);
      if (text !== "" && choices.length > 0) {
        const allowed = new Set(choices.map((c) => c.toLowerCase()));
        if (!allowed.has(text.toLowerCase())) {
          result.warnings.push(`Field ${name} (${type}) value "${text}" is not one of its Choices`);
        }
      }
    }
  }

  return result;
}

/** "Missing required field(s) on model PromoBanner: promoTitle (Text), promoSubtitle (Text)" */
export function formatMissingRequiredFields(modelName: string, missing: RequiredFieldIssue[]): string {
  const list = missing.map((m) => `${m.name} (${m.type})`).join(", ");
  return `Missing required field(s) on model ${modelName}: ${list}`;
}
