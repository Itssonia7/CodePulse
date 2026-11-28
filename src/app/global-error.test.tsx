import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GlobalError, {
  sanitizeCrashError,
  scrubSensitiveTelemetry,
} from "./global-error";

vi.mock("@/components/feedback/error-card", () => ({
  ErrorCard: ({
    error,
    reset,
    title,
  }: {
    error: Error & { digest?: string };
    reset: () => void;
    title: string;
  }) => (
    <div data-testid="mock-error-card">
      <h1>{title}</h1>
      <p data-testid="mock-error-message">{error.message}</p>
      <pre data-testid="mock-error-stack">{error.stack ?? ""}</pre>
      <button type="button" data-testid="mock-reset-btn" onClick={reset}>
        Try Again
      </button>
    </div>
  ),
}));

describe("GlobalError PII & JWT Telemetry Scrubbing (#6161)", () => {
  const jwtSample =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.dBj9ThWq4_sCVz-r5mW4m2b7N8pQ1xZ3kL9mN2oP4qR";
  const emailSample = "developer.user@codepulse.dev";

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks JWT tokens and email addresses in strings", () => {
    const raw = `Auth token ${jwtSample} failed for ${emailSample}`;
    const masked = scrubSensitiveTelemetry(raw);

    expect(masked).not.toContain(jwtSample);
    expect(masked).not.toContain(emailSample);
    expect(masked).toContain("[REDACTED_JWT]");
    expect(masked).toContain("[REDACTED_EMAIL]");
  });

  it("sanitizes error message, stack, and digest before dispatching telemetry", () => {
    const err = Object.assign(
      new Error(`Session failed for ${emailSample} with bearer ${jwtSample}`),
      {
        stack: `Error at ${emailSample} (${jwtSample})`,
        digest: `digest: ${emailSample}`,
      },
    );

    const { sanitizedError, telemetry } = sanitizeCrashError(err);

    expect(sanitizedError.message).toBe(
      "Session failed for [REDACTED_EMAIL] with bearer [REDACTED_JWT]",
    );
    expect(sanitizedError.stack).not.toContain(jwtSample);
    expect(sanitizedError.stack).not.toContain(emailSample);
    expect(telemetry.scrubbed).toBe(true);
    expect(telemetry.digest).toBe("digest: [REDACTED_EMAIL]");
  });

  it("renders sanitized error inside GlobalError and calls reset on retry", () => {
    const onReportTelemetry = vi.fn();
    const reset = vi.fn();
    const err = new Error(`Token ${jwtSample} expired for ${emailSample}`);

    render(
      <GlobalError
        error={err}
        reset={reset}
        onReportTelemetry={onReportTelemetry}
      />,
    );

    expect(screen.getByTestId("mock-error-message").textContent).toBe(
      "Token [REDACTED_JWT] expired for [REDACTED_EMAIL]",
    );
    expect(onReportTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Token [REDACTED_JWT] expired for [REDACTED_EMAIL]",
        scrubbed: true,
      }),
    );

    fireEvent.click(screen.getByTestId("mock-reset-btn"));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
