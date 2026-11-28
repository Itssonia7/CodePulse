import { describe, it, expect } from 'vitest';
import { ProfilerService } from '../../../backend/src/modules/analytics/profiler.service';
import { AnalyticsController } from '../../../backend/src/modules/analytics/analytics.controller';

describe('ProfilerService & AnalyticsController Regression Detection (#440)', () => {
  it('flags O(N -> N^2) CPU regression (>25%) and memory leak growth, generates flamegraph/heap summary, and serves GET performance-profile', () => {
    const service = new ProfilerService();
    const controller = new AnalyticsController(service);

    service.runCommitProfile({
      repositoryId: 'repo-440',
      commitSha: 'c1-base',
      sampleSizes: [100, 400],
      workloadFn: (n) => {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += i;
        return sum;
      },
      heapGrowthBytes: 512 * 1024,
      gcCycles: 1,
    });

    const regressed = controller.createPerformanceProfile('repo-440', {
      commitSha: 'c2-quadratic-leak',
      sampleSizes: [100, 900],
      workloadFn: (n) => {
        let total = 0;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            total += (i + j) % 5;
          }
        }
        return total;
      },
      heapGrowthBytes: 24 * 1024 * 1024,
      gcCycles: 12,
    });

    expect(regressed.regressionDetected).toBe(true);
    expect(regressed.delta.cpuTimeIncreasePercent).toBeGreaterThan(25);
    expect(regressed.delta.algorithmicComplexityEstimate).toBe('O(N^2)');
    expect(regressed.culpritFunctions.length).toBeGreaterThan(0);
    expect(regressed.flamegraph.children?.length).toBeGreaterThan(0);
    expect(regressed.heapSnapshot.allocationTimeline.length).toBe(2);
    expect(regressed.aiRootCauseAnalysis).toContain('c2-quadratic-leak');

    const fetched = controller.getPerformanceProfile('repo-440', 'c2-quadratic-leak');
    expect(fetched.id).toBe(regressed.id);
    expect(fetched.regressionDetected).toBe(true);
  });
});
