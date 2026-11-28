"use client";

import React, { useEffect, useMemo } from "react";
import { ErrorCard } from "@/components/feedback/error-card";
import "./globals.css";

const JWT_TOKEN_REGEX = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const EMAIL_ADDRESS_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export interface ScrubbedTelemetryPayload {
  message: string;
  stack?: string;
  digest?: string;
  scrubbed: boolean;
}

export function scrubSensitiveTelemetry(input: string): string {
  return input
    .replace(JWT_TOKEN_REGEX, "[REDACTED_JWT]")
    .replace(EMAIL_ADDRESS_REGEX, "[REDACTED_EMAIL]");
}

export function sanitizeCrashError(
  error: Error & { digest?: string },
): {
  sanitizedError: Error & { digest?: string };
  telemetry: ScrubbedTelemetryPayload;
} {
  const rawMessage =
    error.message ||
    "A critical error prevented the application layout from rendering.";
  const rawStack = error.stack;
  const rawDigest = error.digest;

  const scrubbedMessage = scrubSensitiveTelemetry(rawMessage);
  const scrubbedStack = rawStack ? scrubSensitiveTelemetry(rawStack) : undefined;
  const scrubbedDigest = rawDigest ? scrubSensitiveTelemetry(rawDigest) : undefined;

  const scrubbed =
    scrubbedMessage !== rawMessage ||
    scrubbedStack !== rawStack ||
    scrubbedDigest !== rawDigest;

  const sanitizedError: Error & { digest?: string } = scrubbed
    ? Object.assign(new Error(scrubbedMessage), {
        name: error.name || "Error",
        stack: scrubbedStack,
        digest: scrubbedDigest,
      })
    : error;

  return {
    sanitizedError,
    telemetry: {
      message: scrubbedMessage,
      stack: scrubbedStack,
      digest: scrubbedDigest,
      scrubbed,
    },
  };
}

export interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  onReportTelemetry?: (payload: ScrubbedTelemetryPayload) => void;
}

export default function GlobalError({
  error,
  reset,
  onReportTelemetry,
}: GlobalErrorProps) {
  const { sanitizedError, telemetry } = useMemo(
    () => sanitizeCrashError(error),
    [error],
  );

  useEffect(() => {
    console.error("Global Error Boundary caught an exception:", sanitizedError);
    onReportTelemetry?.(telemetry);
  }, [onReportTelemetry, sanitizedError, telemetry]);

  return (
    <html lang="en" className="dark">
      <body
        className="flex min-h-screen w-full items-center justify-center bg-slate-950 px-3 py-4 font-sans text-slate-100 antialiased dark:bg-[#020617] dark:text-slate-100 sm:px-6 sm:py-6 md:px-8 lg:py-10"
        style={{ backgroundColor: "#020617", color: "#f8fafc" }}
      >
        <div className="w-full max-w-xl sm:max-w-2xl lg:max-w-3xl">
          <ErrorCard
            error={sanitizedError}
            reset={reset}
            title="Critical Application Error"
            message="A critical error prevented the application layout from rendering. Please click Try Again or return to the dashboard."
            showDashboardLink={true}
          />
        </div>
      </body>
    </html>
  );
}
