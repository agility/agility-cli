/**
 * Command-line argument normalizer
 * 
 * Handles edge cases where rich text editors (Word, Notepad, etc.) convert
 * characters when copying/pasting CLI arguments:
 * - Em/en dashes (—, –) → double hyphen (--)
 * - Curly quotes ("", '') → straight quotes (", ')
 */

/**
 * Normalizes dashes in argument strings
 * Replaces Unicode em dash (U+2014) and en dash (U+2013) with double hyphen
 */
function normalizeDashes(str: string): string {
  // Em dash (—) and en dash (–) → double hyphen (--)
  return str.replace(/[—–]/g, '--');
}

/**
 * Normalizes quotes in argument strings
 * Replaces Unicode curly quotes with straight quotes
 * Handles all common curly quote variants using Unicode ranges
 */
function normalizeQuotes(str: string): string {
  // Use Unicode ranges to catch all quote-like characters
  // This is more comprehensive than listing individual characters
  // Also use explicit character codes as fallback
  return str
    // Replace all left/right double quotes (U+201C-U+201F) with straight double quote
    .replace(/[\u201C-\u201F]/g, '"')
    // Also explicitly match common curly quote characters (fallback)
    .replace(/[""]/g, '"')  // Left/right double quotes
    .replace(/[„‟]/g, '"')  // Double low-9 and high-reversed-9 quotes
    // Replace all left/right single quotes (U+2018-U+201B) with straight single quote
    .replace(/[\u2018-\u201B]/g, "'")
    // Also explicitly match common curly single quotes (fallback)
    .replace(/['']/g, "'")  // Left/right single quotes
    .replace(/[‚‛]/g, "'")  // Single low-9 and high-reversed-9 quotes
    // Also handle any other quote-like characters that might slip through
    // Left-pointing double angle quotation mark (U+00AB) and right (U+00BB)
    .replace(/[\u00AB\u00BB]/g, '"')
    // Left-pointing single angle quotation mark (U+2039) and right (U+203A)
    .replace(/[\u2039\u203A]/g, "'");
}

/**
 * Normalizes a single argument string
 * Applies both dash and quote normalization
 */
function normalizeArg(arg: string): string {
  return normalizeQuotes(normalizeDashes(arg));
}

/**
 * Normalizes process.argv to handle rich text editor character conversions
 * 
 * This fixes common issues when users copy/paste CLI arguments from:
 * - Microsoft Word
 * - Notepad (Windows 11+ with smart quotes enabled)
 * - Other rich text editors
 * 
 * Modifies process.argv in-place to normalize:
 * - Argument names: --models-with-deps → --models-with-deps (if copied as —models-with-deps)
 * - Argument values: "" → "" (if copied with curly quotes)
 * 
 * @returns true if any normalization occurred, false otherwise
 */
export function normalizeProcessArgs(): boolean {
  let normalized = false;

  // Skip first two args (node executable and script path)
  for (let i = 2; i < process.argv.length; i++) {
    const original = process.argv[i];
    const normalizedArg = normalizeArg(original);

    if (original !== normalizedArg) {
      process.argv[i] = normalizedArg;
      normalized = true;
    }
  }

  return normalized;
}

/**
 * Normalizes a string value by removing curly quotes and dashes
 * Also strips leading/trailing quotes (both curly and straight) since they're
 * often included when copy/pasting from rich text editors.
 * 
 * @param value - String value to normalize
 * @returns Normalized string
 */
function normalizeStringValue(value: string): string {
  let normalized = normalizeQuotes(normalizeDashes(value));
  
  // Strip leading/trailing quotes (both curly and straight variants)
  // This handles cases where the entire value is quoted: "value" or "value"
  // Use Unicode ranges to catch all quote variants
  normalized = normalized.replace(/^[\u201C-\u201F\u2018-\u201B\u00AB\u00BB\u2039\u203A"']+|[\u201C-\u201F\u2018-\u201B\u00AB\u00BB\u2039\u203A"']+$/g, '');
  
  return normalized;
}

/**
 * Recursively normalizes all string values in an argv object
 * 
 * This normalizes the entire parsed argv object from yargs, ensuring all
 * string arguments (sourceGuid, targetGuid, locale, models, modelsWithDeps, etc.)
 * are cleaned before they reach setState().
 * 
 * Handles:
 * - String values: normalizes quotes and dashes, strips leading/trailing quotes
 * - String arrays: normalizes each element
 * - Other types: left unchanged
 * 
 * @param obj - The argv object (or any object) to normalize
 * @returns The normalized object (mutates in place, but also returns for convenience)
 */
export function normalizeArgv(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings - this is the most common case for argument values
  if (typeof obj === 'string') {
    return normalizeStringValue(obj);
  }

  // Handle arrays - normalize each element
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeArgv(item));
  }

  // Handle objects - recursively normalize all properties
  if (typeof obj === 'object') {
    // Check if it's a plain object (not Date, RegExp, etc.)
    if (obj.constructor !== Object && obj.constructor !== undefined) {
      // For non-plain objects, try to normalize if it's string-like
      if (typeof obj.toString === 'function' && obj.toString() !== '[object Object]') {
        const str = String(obj);
        if (str !== obj) {
          // It's string-like, normalize it
          return normalizeStringValue(str);
        }
      }
      // Otherwise return as-is
      return obj;
    }
    
    const normalized: any = {};
    
    for (const key in obj) {
      // Skip yargs internal properties, but normalize the key itself in case it has issues
      if (key === '_' || key === '$0') {
        normalized[key] = obj[key];
        continue;
      }
      
      // Normalize the property value
      normalized[key] = normalizeArgv(obj[key]);
    }
    
    return normalized;
  }

  // For all other types (numbers, booleans, etc.), return as-is
  return obj;
}
