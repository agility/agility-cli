/**
 * PROD-2914: the Management API checks component availability rules before it queues a page save,
 * and rejects a page that adds a component somewhere a rule doesn't allow with an HTTP 400 whose body
 * is the reason. The reasons are fixed texts, the same in every Agility stack:
 *
 *   The "{model}" component is disabled on this instance.
 *   You don't have permission to add the "{model}" component.
 *   The "{model}" component isn't allowed on the "{sitemap}" sitemap.
 *   The "{model}" component isn't allowed in the "{zone}" zone of the "{pageModel}" page model.
 */
const AVAILABILITY_REASON =
  /The ".+" component is disabled on this instance\.|You don't have permission to add the ".+" component\.|The ".+" component isn't allowed (?:on|in) the ".+"/;

/** The server's response body as text, from the SDK's Exception (or a raw axios error). */
function responseText(error: any): string | null {
  const data = error?.responseData ?? error?.response?.data;
  if (data === undefined || data === null) return null;
  if (typeof data === "string") return data;
  const text = data.exceptionMessage ?? data.message ?? data.Message ?? data.detail ?? data.title;
  return typeof text === "string" ? text : null;
}

/**
 * The component availability reason a page save was rejected with, or `null` when the error is
 * anything else.
 */
export function componentAvailabilityReason(error: any): string | null {
  const status = error?.statusCode ?? error?.response?.status;
  if (status !== 400) return null;
  const text = responseText(error);
  if (!text || !AVAILABILITY_REASON.test(text)) return null;
  return text.trim();
}

/** The message to report for a failed page save: the rule's reason when a rule rejected it. */
export function describePageSaveError(error: any): string {
  const reason = componentAvailabilityReason(error);
  if (reason) return `Rejected by a component availability rule: ${reason}`;
  return error?.message ? String(error.message) : String(error);
}
