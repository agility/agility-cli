import { componentAvailabilityReason, describePageSaveError } from "../component-availability-error";

/** An SDK Exception as the Management API 400 produces it. */
function sdkError(statusCode: number, responseData: unknown, message = "Unable to create page. (HTTP 400): ...") {
  return Object.assign(new Error(message), { statusCode, responseData });
}

describe("componentAvailabilityReason", () => {
  it.each([
    'The "Hero Banner" component is disabled on this instance.',
    'You don\'t have permission to add the "Hero Banner" component.',
    'The "Hero Banner" component isn\'t allowed on the "Website" sitemap.',
    'The "Hero Banner" component isn\'t allowed in the "Main" zone of the "Landing Page" page model.',
  ])("returns the rule's reason for: %s", (reason) => {
    expect(componentAvailabilityReason(sdkError(400, reason))).toBe(reason);
  });

  it("reads the reason from a JSON error body", () => {
    const reason = 'The "Hero" component is disabled on this instance.';
    expect(componentAvailabilityReason(sdkError(400, { message: reason }))).toBe(reason);
    expect(componentAvailabilityReason(sdkError(400, { Message: reason }))).toBe(reason);
  });

  it("reads a raw axios error", () => {
    const reason = 'The "Hero" component is disabled on this instance.';
    expect(componentAvailabilityReason({ response: { status: 400, data: reason } })).toBe(reason);
  });

  it("ignores any other 400", () => {
    expect(componentAvailabilityReason(sdkError(400, "Page name is required."))).toBeNull();
  });

  it("ignores a rule-like text on another status", () => {
    expect(componentAvailabilityReason(sdkError(500, 'The "Hero" component is disabled on this instance.'))).toBeNull();
  });

  it("ignores errors with no response", () => {
    expect(componentAvailabilityReason(new Error("socket hang up"))).toBeNull();
    expect(componentAvailabilityReason(undefined)).toBeNull();
  });
});

describe("describePageSaveError", () => {
  it("labels a rule rejection with the rule's reason", () => {
    const reason = 'The "Hero" component isn\'t allowed in the "Main" zone of the "Landing Page" page model.';
    expect(describePageSaveError(sdkError(400, reason))).toBe(`Rejected by a component availability rule: ${reason}`);
  });

  it("keeps any other error's message unchanged", () => {
    expect(describePageSaveError(sdkError(500, "boom", "Unable to create page. (HTTP 500): boom"))).toBe(
      "Unable to create page. (HTTP 500): boom"
    );
    expect(describePageSaveError("plain")).toBe("plain");
  });
});
