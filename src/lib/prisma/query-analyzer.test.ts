import { describe, it, expect, vi } from 'vitest';
import {
  QueryAnalyzerService,
  type ExplainExecutor,
} from '../../../backend/src/prisma/query-analyzer.service';
import { PrismaService } from '../../../backend/src/prisma/prisma.service';

describe('QueryAnalyzerService & PrismaService EXPLAIN Guardrail (#388)', () => {
  it('flags Seq Scan on DeveloperRating (>10,000 rows) with [xp, elo] index guidance and rejects cost > 5000', async () => {
    const analyzer = new QueryAnalyzerService('test');
    const prisma = new PrismaService(analyzer);

    const highCostExecutor: ExplainExecutor = {
      runExplainJson: vi.fn().mockReturnValue([
        {
          Plan: {
            'Node Type': 'Seq Scan',
            'Relation Name': 'DeveloperRating',
            'Startup Cost': 12.5,
            'Total Cost': 8420.75,
            'Plan Rows': 45000,
          },
        },
      ]),
    };

    await expect(
      prisma.executeWithGuardrail(
        {
          model: 'DeveloperRating',
          operation: 'findMany',
          args: { where: { xp: { gt: 100 } }, orderBy: { elo: 'desc' } },
          query: async () => [{ id: '1' }],
        },
        highCostExecutor,
      ),
    ).rejects.toThrow(
      'Unindexed query detected on table DeveloperRating. Missing composite index on [xp, elo]',
    );

    expect(highCostExecutor.runExplainJson).toHaveBeenCalledWith(
      expect.stringContaining('EXPLAIN (FORMAT JSON)'),
    );
  });

  it('skips query cost enforcement when NODE_ENV is production', async () => {
    const prodAnalyzer = new QueryAnalyzerService('production');
    const prodPrisma = new PrismaService(prodAnalyzer);
    const executor: ExplainExecutor = {
      runExplainJson: vi.fn().mockReturnValue([
        {
          Plan: {
            'Node Type': 'Seq Scan',
            'Relation Name': 'DeveloperRating',
            'Startup Cost': 0,
            'Total Cost': 99999,
            'Plan Rows': 100000,
          },
        },
      ]),
    };

    const { result, analysis } = await prodPrisma.executeWithGuardrail(
      {
        model: 'DeveloperRating',
        operation: 'findMany',
        query: async () => ['ok'],
      },
      executor,
    );

    expect(result).toEqual(['ok']);
    expect(analysis?.warnings).toEqual([]);
    expect(executor.runExplainJson).not.toHaveBeenCalled();
  });
});
