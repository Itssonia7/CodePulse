import { Body, Controller, Get, Post } from '@nestjs/common';

export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RawCspReportBody {
  'csp-report'?: {
    'document-uri'?: string;
    'violated-directive'?: string;
    'effective-directive'?: string;
    'blocked-uri'?: string;
    'script-sample'?: string;
    'line-number'?: number;
  };
  documentUri?: string;
  violatedDirective?: string;
  blockedUri?: string;
  scriptSample?: string;
}

export interface ParsedCspViolation {
  id: string;
  documentUri: string;
  violatedDirective: string;
  blockedUri: string;
  scriptSample: string;
  xssProbingDetected: boolean;
  xssPatternsMatched: string[];
  severity: ViolationSeverity;
  discordAlertSent: boolean;
  receivedAt: string;
}

export interface DiscordAlertDispatcher {
  sendDiscordAlert: (message: string, violation: ParsedCspViolation) => Promise<void> | void;
}

const XSS_PROBING_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'script-tag', regex: /<\s*script\b/i },
  { name: 'javascript-uri', regex: /\bjavascript\s*:/i },
  { name: 'inline-event-handler', regex: /\bon(?:error|onload|onclick|onmouseover|onerror)\s*=/i },
  { name: 'dom-sink-eval', regex: /\b(?:eval|new Function|document\.write)\s*\(/i },
  { name: 'cookie-exfiltration', regex: /\bdocument\.cookie\b|\blocalStorage\b/i },
];

export function detectXssProbing(payloadText: string): string[] {
  const matched: string[] = [];
  for (const pat of XSS_PROBING_PATTERNS) {
    if (pat.regex.test(payloadText)) {
      matched.push(pat.name);
    }
  }
  return matched;
}

@Controller('api/v1/security')
export class SecurityReportsController {
  private readonly reports: ParsedCspViolation[] = [];

  constructor(private readonly discordNotifier?: DiscordAlertDispatcher) {}

  @Post('csp-reports')
  async ingestCspReport(@Body() body: RawCspReportBody): Promise<ParsedCspViolation> {
    const nested = body['csp-report'];
    const documentUri =
      nested?.['document-uri'] ?? body.documentUri ?? 'https://codepulse.local/';
    const violatedDirective =
      nested?.['effective-directive'] ??
      nested?.['violated-directive'] ??
      body.violatedDirective ??
      'script-src';
    const blockedUri = nested?.['blocked-uri'] ?? body.blockedUri ?? 'inline';
    const scriptSample = nested?.['script-sample'] ?? body.scriptSample ?? '';

    const combinedInspectionText = `${documentUri} ${violatedDirective} ${blockedUri} ${scriptSample}`;
    const xssPatternsMatched = detectXssProbing(combinedInspectionText);
    const xssProbingDetected = xssPatternsMatched.length > 0;

    const severity: ViolationSeverity = xssProbingDetected
      ? 'critical'
      : violatedDirective.includes('script-src') || violatedDirective.includes('frame-ancestors')
        ? 'high'
        : 'medium';

    const record: ParsedCspViolation = {
      id: `csp-${this.reports.length + 1}`,
      documentUri,
      violatedDirective,
      blockedUri,
      scriptSample,
      xssProbingDetected,
      xssPatternsMatched,
      severity,
      discordAlertSent: false,
      receivedAt: new Date().toISOString(),
    };

    if (severity === 'critical' || severity === 'high') {
      const alertMsg = [
        `[CRITICAL CSP ALERT] Severity=${severity.toUpperCase()} on ${record.documentUri}`,
        `Directive=${record.violatedDirective} | Blocked=${record.blockedUri}`,
        record.xssProbingDetected
          ? `XSS Patterns=[${record.xssPatternsMatched.join(', ')}]`
          : 'Directive policy violation detected',
      ].join(' | ');

      if (this.discordNotifier) {
        await this.discordNotifier.sendDiscordAlert(alertMsg, record);
      }
      record.discordAlertSent = true;
    }

    this.reports.push(record);
    return record;
  }

  @Get('csp-reports')
  listCspReports(): readonly ParsedCspViolation[] {
    return this.reports;
  }
}
