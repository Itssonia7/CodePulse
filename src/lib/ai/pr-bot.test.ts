import { describe, it, expect } from 'vitest';
import { PrBotService } from '../../../backend/src/modules/ai/pr-bot.service';
import { GithubWebhookController } from '../../../backend/src/modules/github/github-webhook.controller';

describe('PrBotService & GithubWebhookController CI Fix Suggestions (#437)', () => {
  it('parses TS2322, ESLint, and Vitest failures, generates ```suggestion``` blocks, skips bots, and tracks AiReviewAudit acceptance rate', () => {
    const service = new PrBotService(5);
    const controller = new GithubWebhookController(service);

    const ciLogs = [
      "src/components/card.tsx(18,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      'src/utils/format.ts:9:1  error  Missing semicolon  @stylistic/semi',
      'FAIL  src/utils/format.test.ts:12:5 - expected 2 toBe(3)',
    ].join('\n');

    const diff = [
      '--- a/src/components/card.tsx',
      '+++ b/src/components/card.tsx',
      '+const count: number = rawCount',
    ].join('\n');

    const outcome = controller.handleWebhook('check_run', {
      action: 'completed',
      repository: { full_name: 'code-with-abhi-i5/CodePulse' },
      sender: { login: 'contributor-dev', type: 'User' },
      pull_request: {
        number: 437,
        user: { login: 'contributor-dev', type: 'User' },
        diff,
      },
      check_run: {
        id: 9001,
        conclusion: 'failure',
        pull_requests: [{ number: 437 }],
      },
      ciLogs,
    });

    expect(outcome.skipped).toBe(false);
    expect(outcome.diagnostics).toHaveLength(3);
    expect(outcome.comments).toHaveLength(3);
    expect(outcome.comments[0].suggestionBlock).toContain('```suggestion');

    const updatedAudit = service.recordSuggestionAcceptance(outcome.auditId, 2);
    expect(updatedAudit?.acceptedCount).toBe(2);
    expect(updatedAudit?.fixAcceptanceRate).toBe(66.67);

    // Bot PR should be skipped
    const botOutcome = controller.handleWebhook('pull_request', {
      action: 'opened',
      repository: { full_name: 'code-with-abhi-i5/CodePulse' },
      sender: { login: 'dependabot[bot]', type: 'Bot' },
      pull_request: {
        number: 438,
        user: { login: 'dependabot[bot]', type: 'Bot' },
      },
      ciLogs,
    });
    expect(botOutcome.skipped).toBe(true);
    expect(botOutcome.skipReason).toBe('BOT_AUTHOR');
  });
});
