import { describe, it, expect } from 'vitest';
import { ConflictResolverService } from '../../../backend/src/modules/git/conflict-resolver.service';
import { GitConflictController, GithubService } from '../../../backend/src/modules/github/github.service';

describe('ConflictResolverService & POST /api/v1/git/resolve-conflict (#439)', () => {
  it('merges non-conflicting JS/TS imports and exports without duplicates and preserves syntax validity', async () => {
    const controller = new GitConflictController(new GithubService(new ConflictResolverService()));

    const conflicted = [
      "import { alpha } from './alpha';",
      '<<<<<<< HEAD',
      "import { beta } from './beta';",
      "export { beta };",
      '=======',
      "import { beta } from './beta';",
      "import { gamma } from './gamma';",
      "export { gamma };",
      '>>>>>>> feature/gamma',
      'export function run() { return alpha; }',
    ].join('\n');

    const result = await controller.resolveConflict({
      filePath: 'src/barrel.ts',
      conflictedContent: conflicted,
    });

    expect(result.hasRemainingConflictMarkers).toBe(false);
    expect(result.isSyntacticallyValid).toBe(true);
    expect(result.resolvedContent.match(/import \{ beta \} from '\.\/beta';/g)).toHaveLength(1);
    expect(result.resolvedContent).toContain("import { gamma } from './gamma';");
    expect(result.resolvedContent).toContain('export { beta };');
    expect(result.resolvedContent).toContain('export { gamma };');
    expect(result.explanations[0].strategy).toBe('ast-non-conflicting-merge');
  });

  it('uses LLM semantic synthesis with trade-off explanation on true semantic conflicts', async () => {
    const service = new ConflictResolverService();

    const conflicted = [
      '<<<<<<< HEAD',
      'const RETRY_LIMIT = 2;',
      '=======',
      'const RETRY_LIMIT = 5;',
      '>>>>>>> feature/resilient-retries',
    ].join('\n');

    const result = await service.resolveConflict({
      filePath: 'src/config/retry.ts',
      conflictedContent: conflicted,
      llmSynthesizer: async () => ({
        resolved: 'const RETRY_LIMIT = 3; // Balanced retries across fast & flaky endpoints',
        tradeOffExplanation:
          'Compromised between HEAD (2 retries, lower tail latency) and feature branch (5 retries, higher recovery) by choosing 3 retries.',
      }),
    });

    expect(result.hasRemainingConflictMarkers).toBe(false);
    expect(result.isSyntacticallyValid).toBe(true);
    expect(result.resolvedContent).toContain('const RETRY_LIMIT = 3;');
    expect(result.explanations[0].strategy).toBe('llm-semantic-synthesis');
    expect(result.explanations[0].tradeOffExplanation).toContain('3 retries');
  });
});
