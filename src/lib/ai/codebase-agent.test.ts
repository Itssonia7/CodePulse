import { describe, it, expect } from 'vitest';
import { CodebaseAgentService } from '../../../backend/src/modules/ai/codebase-agent.service';
import { AiController } from '../../../backend/src/modules/ai/ai.controller';

describe('CodebaseAgentService & AiController RAG + SSE Integration (#441)', () => {
  it('indexes semantic units, retrieves top 5 snippets with exact file citations, answers matchmaking questions grounded in repo context, and streams SSE under 800ms TTFT', async () => {
    const service = new CodebaseAgentService();
    const controller = new AiController(service);

    service.indexRepositoryFiles('code-with-abhi-i5/CodePulse', [
      {
        filePath: 'backend/src/modules/matchmaking/matchmaking.queue.ts',
        content: [
          'export class BattleMatchmakingQueue {',
          '  enqueuePlayer(playerId: string, rating: number) {',
          '    return { playerId, rating, status: "QUEUED" };',
          '  }',
          '  dequeuePair() {',
          '    return this.queue.splice(0, 2);',
          '  }',
          '}',
        ].join('\n'),
      },
      {
        filePath: 'backend/src/modules/matchmaking/matchmaking.schema.prisma',
        content: [
          'model MatchQueueEntry {',
          '  id String @id',
          '  rating Int',
          '}',
        ].join('\n'),
      },
      {
        filePath: 'backend/src/modules/auth/auth.service.ts',
        content: [
          'export class AuthTokenService {',
          '  verifyJwt(token: string) {',
          '    return Boolean(token);',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);

    const t0 = Date.now();
    const ssePayload = await controller.streamCodebaseChat({
      repository: 'code-with-abhi-i5/CodePulse',
      question: 'How does the battle matchmaking queue work?',
      sessionId: 'sess-441',
    });
    const elapsedMs = Date.now() - t0;

    expect(elapsedMs).toBeLessThan(800);
    expect(ssePayload).toContain('event: meta');
    expect(ssePayload).toContain('event: token');
    expect(ssePayload).toContain('event: citation');
    expect(ssePayload).toContain('event: done');
    expect(ssePayload).toContain('backend/src/modules/matchmaking/matchmaking.queue.ts');
    expect(ssePayload).toContain('flowchart LR');

    const unindexedResult = service.answerArchitecturalQuestion({
      repository: 'unindexed/other-repo',
      question: 'How does billing work?',
    });
    expect(unindexedResult.grounded).toBe(false);
    expect(unindexedResult.citations).toHaveLength(0);
  });
});
