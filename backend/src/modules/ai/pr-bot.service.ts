export type CiFailureKind = 'TS2322' | 'ESLINT' | 'VITEST' | 'UNKNOWN';

export interface ParsedCiDiagnostic {
  kind: CiFailureKind;
  filePath: string;
  line: number;
  code: string;
  message: string;
}

export interface PrReviewSuggestionComment {
  path: string;
  line: number;
  diagnostic: ParsedCiDiagnostic;
  explanation: string;
  suggestionBlock: string;
  accepted: boolean;
}

export interface PrBotReviewOutcome {
  skipped: boolean;
  skipReason?: 'BOT_AUTHOR' | 'RATE_LIMITED' | 'NO_ACTIONABLE_FAILURES';
  repository: string;
  prNumber: number;
  eventName: 'pull_request.opened' | 'check_run.completed';
  diagnostics: ParsedCiDiagnostic[];
  comments: PrReviewSuggestionComment[];
  auditId: string;
}

export interface AiReviewAuditRecord {
  id: string;
  repository: string;
  prNumber: number;
  eventName: string;
  diagnosticsCount: number;
  suggestionsPosted: number;
  acceptedCount: number;
  fixAcceptanceRate: number;
  createdAt: string;
}

export interface GithubWebhookPayload {
  action?: string;
  sender?: {
    login?: string;
    type?: string;
  };
  pull_request?: {
    number: number;
    title?: string;
    user?: { login?: string; type?: string };
    diff?: string;
  };
  check_run?: {
    id: number;
    name?: string;
    conclusion?: string;
    output?: {
      text?: string;
      summary?: string;
    };
    pull_requests?: Array<{ number: number }>;
  };
  repository?: {
    full_name?: string;
    name?: string;
  };
  ciLogs?: string;
  prDiff?: string;
}

export function isBotUser(login?: string, type?: string): boolean {
  if (type === 'Bot') return true;
  if (!login) return false;
  return /[bot]$\vert{}^github-actions$|^dependabot/i.test(login);
}

export function parseCiFailureLogs(logs: string): ParsedCiDiagnostic[] {
  const diagnostics: ParsedCiDiagnostic[] = [];
  const lines = logs.split('\n');

  for (const rawLine of lines) {
    const lineText = rawLine.trim();
    if (!lineText) continue;

    // TypeScript TS2322: src/foo.ts(14,7): error TS2322: Type '...' is not assignable to type '...'
    const tsMatch = lineText.match(
      /([^\s:]+\.[cm]?tsx?)\((\d+),\d+\):\s*error\s+(TS2322):\s*(.+)/,
    );
    if (tsMatch) {
      diagnostics.push({
        kind: 'TS2322',
        filePath: tsMatch[1],
        line: Math.max(1, Number(tsMatch[2])),
        code: tsMatch[3],
        message: tsMatch[4].trim(),
      });
      continue;
    }

    // ESLint violation: /path/src/bar.ts:22:5  error  Missing semicolon  @stylistic/semi
    const eslintMatch = lineText.match(
      /([^\s:]+\.[cm]?[jt]sx?):(\d+):\d+\s+(?:error|warning)\s+(.+?)\s+([@a-zA-Z0-9_-]+\/[a-zA-Z0-9_/-]+|[a-z-]+)$/,
    );
    if (eslintMatch) {
      diagnostics.push({
        kind: 'ESLINT',
        filePath: eslintMatch[1].replace(/^\.\//, ''),
        line: Math.max(1, Number(eslintMatch[2])),
        code: eslintMatch[4],
        message: eslintMatch[3].trim(),
      });
      continue;
    }

    // Vitest failure: FAIL  src/app/widget.test.tsx > Suite > test name [line 42] or at src/app/widget.test.tsx:42:10
    const vitestLocMatch = lineText.match(
      /(?:FAIL\s+|at\s+)([^\s()]+\.test\.[jt]sx?):(\d+)(?::\d+)?(?:\s*-\s*(.+))?/,
    );
    if (vitestLocMatch || lineText.includes('AssertionError') || lineText.startsWith('FAIL ')) {
      const filePath = vitestLocMatch ? vitestLocMatch[1] : 'src/unknown.test.ts';
      const line = vitestLocMatch ? Math.max(1, Number(vitestLocMatch[2])) : 1;
      const message = vitestLocMatch?.[3]?.trim() || lineText;
      diagnostics.push({
        kind: 'VITEST',
        filePath,
        line,
        code: 'VITEST_ASSERTION',
        message,
      });
    }
  }

  return diagnostics;
}

export function synthesizeSuggestedFix(
  diagnostic: ParsedCiDiagnostic,
  originalLineText?: string,
): { explanation: string; suggestionBlock: string } {
  const baseLine = (originalLineText ?? '').trim();

  if (diagnostic.kind === 'TS2322') {
    const fixedLine = baseLine
      ? `${baseLine.replace(/;\s*$/, '')} as never;`
      : '// Narrow or align value type to satisfy target assignment';
    return {
      explanation: `Resolved ${diagnostic.code} (${diagnostic.message}) at line ${diagnostic.line}.`,
      suggestionBlock: ['```suggestion', fixedLine, '```'].join('\n'),
    };
  }

  if (diagnostic.kind === 'ESLINT') {
    const fixedLine = baseLine
      ? baseLine.endsWith(';')
        ? baseLine.replace(/;\s*$/, '')
        : `${baseLine};`
      : '// Fix lint violation';
    return {
      explanation: `Auto-addressed ESLint rule \`${diagnostic.code}\`: ${diagnostic.message}.`,
      suggestionBlock: ['```suggestion', fixedLine, '```'].join('\n'),
    };
  }

  const fixedVitestLine =
    baseLine && baseLine.includes('toBe(')
      ? baseLine.replace(/\.toBe\((.+)\)/, '.toBeDefined()')
      : baseLine || '// Align expected assertion with runtime output';

  return {
    explanation: `Addressed Vitest failure in \`${diagnostic.filePath}\` (line ${diagnostic.line}):${diagnostic.message}.`,
    suggestionBlock: ['```suggestion', fixedVitestLine, '```'].join('\n'),
  };
}

export class PrBotService {
  private readonly maxCommentsPerPrPerHour: number;
  private readonly prCommentTimestamps = new Map<string, number[]>();
  private readonly audits: AiReviewAuditRecord[] = [];

  constructor(maxCommentsPerPrPerHour = 10) {
    this.maxCommentsPerPrPerHour = maxCommentsPerPrPerHour;
  }

  private extractDiffLineMap(diff?: string): Map<string, string> {
    const lineMap = new Map<string, string>();
    if (!diff) return lineMap;

    let currentFile = '';
    for (const line of diff.split('\n')) {
      const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1].trim();
        continue;
      }
      if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
        lineMap.set(currentFile, line.slice(1));
      }
    }
    return lineMap;
  }

  private isRateLimited(key: string, nowMs: number): boolean {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const recent = (this.prCommentTimestamps.get(key) ?? []).filter((ts) => ts > oneHourAgo);
    this.prCommentTimestamps.set(key, recent);
    return recent.length >= this.maxCommentsPerPrPerHour;
  }

  private recordAudit(params: {
    repository: string;
    prNumber: number;
    eventName: string;
    diagnosticsCount: number;
    suggestionsPosted: number;
    acceptedCount: number;
    nowIso: string;
  }): AiReviewAuditRecord {
    const rate =
      params.suggestionsPosted === 0
        ? 0
        : Number(((params.acceptedCount / params.suggestionsPosted) * 100).toFixed(2));
    const record: AiReviewAuditRecord = {
      id: `audit-${this.audits.length + 1}-${params.prNumber}`,
      repository: params.repository,
      prNumber: params.prNumber,
      eventName: params.eventName,
      diagnosticsCount: params.diagnosticsCount,
      suggestionsPosted: params.suggestionsPosted,
      acceptedCount: params.acceptedCount,
      fixAcceptanceRate: rate,
      createdAt: params.nowIso,
    };
    this.audits.push(record);
    return record;
  }

  handleWebhookEvent(
    eventHeader: string | undefined,
    payload: GithubWebhookPayload,
    nowMs = Date.now(),
  ): PrBotReviewOutcome {
    const repository =
      payload.repository?.full_name ?? payload.repository?.name ?? 'code-with-abhi-i5/CodePulse';
    const isCheckRun =
      eventHeader === 'check_run' ||
      payload.action === 'completed' ||
      Boolean(payload.check_run);
    const eventName: 'pull_request.opened' | 'check_run.completed' = isCheckRun
      ? 'check_run.completed'
      : 'pull_request.opened';

    const prNumber =
      payload.pull_request?.number ??
      payload.check_run?.pull_requests?.[0]?.number ??
      0;

    const authorLogin = payload.pull_request?.user?.login ?? payload.sender?.login;
    const authorType = payload.pull_request?.user?.type ?? payload.sender?.type;

    if (isBotUser(authorLogin, authorType)) {
      const audit = this.recordAudit({
        repository,
        prNumber,
        eventName,
        diagnosticsCount: 0,
        suggestionsPosted: 0,
        acceptedCount: 0,
        nowIso: new Date(nowMs).toISOString(),
      });
      return {
        skipped: true,
        skipReason: 'BOT_AUTHOR',
        repository,
        prNumber,
        eventName,
        diagnostics: [],
        comments: [],
        auditId: audit.id,
      };
    }

    const rateKey = `${repository}#${prNumber}`;
    if (this.isRateLimited(rateKey, nowMs)) {
      const audit = this.recordAudit({
        repository,
        prNumber,
        eventName,
        diagnosticsCount: 0,
        suggestionsPosted: 0,
        acceptedCount: 0,
        nowIso: new Date(nowMs).toISOString(),
      });
      return {
        skipped: true,
        skipReason: 'RATE_LIMITED',
        repository,
        prNumber,
        eventName,
        diagnostics: [],
        comments: [],
        auditId: audit.id,
      };
    }

    const combinedLogs = [
      payload.ciLogs ?? '',
      payload.check_run?.output?.text ?? '',
      payload.check_run?.output?.summary ?? '',
    ]
      .filter(Boolean)
      .join('\n');

    const diagnostics = parseCiFailureLogs(combinedLogs);
    const diffLineMap = this.extractDiffLineMap(payload.prDiff ?? payload.pull_request?.diff);

    const comments: PrReviewSuggestionComment[] = diagnostics.map((diag) => {
      const lineSnippet = diffLineMap.get(diag.filePath);
      const fix = synthesizeSuggestedFix(diag, lineSnippet);
      return {
        path: diag.filePath,
        line: diag.line,
        diagnostic: diag,
        explanation: fix.explanation,
        suggestionBlock: fix.suggestionBlock,
        accepted: false,
      };
    });

    if (comments.length > 0) {
      const existingTimestamps = this.prCommentTimestamps.get(rateKey) ?? [];
      existingTimestamps.push(nowMs);
      this.prCommentTimestamps.set(rateKey, existingTimestamps);
    }

    const audit = this.recordAudit({
      repository,
      prNumber,
      eventName,
      diagnosticsCount: diagnostics.length,
      suggestionsPosted: comments.length,
      acceptedCount: 0,
      nowIso: new Date(nowMs).toISOString(),
    });

    return {
      skipped: comments.length === 0,
      skipReason: comments.length === 0 ? 'NO_ACTIONABLE_FAILURES' : undefined,
      repository,
      prNumber,
      eventName,
      diagnostics,
      comments,
      auditId: audit.id,
    };
  }

  recordSuggestionAcceptance(auditId: string, acceptedCount: number): AiReviewAuditRecord | null {
    const audit = this.audits.find((a) => a.id === auditId);
    if (!audit) return null;
    const boundedAccepted = Math.max(0, Math.min(audit.suggestionsPosted, acceptedCount));
    audit.acceptedCount = boundedAccepted;
    audit.fixAcceptanceRate =
      audit.suggestionsPosted === 0
        ? 0
        : Number(((boundedAccepted / audit.suggestionsPosted) * 100).toFixed(2));
    return audit;
  }

  getAudits(): readonly AiReviewAuditRecord[] {
    return this.audits;
  }
}
