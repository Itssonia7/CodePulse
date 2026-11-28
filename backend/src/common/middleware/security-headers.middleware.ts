import crypto from 'node:crypto';

export interface SecurityHeadersResponse {
  locals?: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

export function generateCspNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    'report-uri /api/v1/security/csp-reports',
  ].join('; ');
}

export class SecurityHeadersMiddleware {
  use(
    _req: unknown,
    res: SecurityHeadersResponse,
    next: (err?: unknown) => void,
  ): string {
    const nonce = generateCspNonce();
    const cspValue = buildContentSecurityPolicy(nonce);

    if (res.locals) {
      res.locals.cspNonce = nonce;
    }

    res.setHeader('x-csp-nonce', nonce);
    res.setHeader('Content-Security-Policy', cspValue);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    next();
    return nonce;
  }
}
