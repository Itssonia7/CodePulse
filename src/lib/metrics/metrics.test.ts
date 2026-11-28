import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { MetricsService } from '../../../backend/src/modules/metrics/metrics.service';

describe('MetricsService & HPA Custom Metrics Autoscaling (#412)', () => {
  it('exposes codepulse_active_websockets_count and codepulse_queue_backlog_jobs in Prometheus format', () => {
    const metrics = new MetricsService();
    metrics.setActiveWebsocketsCount(1250);
    metrics.setQueueBacklogJobs(340);

    const output = metrics.renderPrometheusMetrics();
    expect(output).toContain('codepulse_active_websockets_count 1250');
    expect(output).toContain('codepulse_queue_backlog_jobs 340');
  });

  it('stops accepting new battle matches and drains active rooms on SIGTERM', async () => {
    const metrics = new MetricsService();
    metrics.registerBattleRoom('battle-1', 2, true);
    expect(metrics.canAcceptNewBattleMatch()).toBe(true);

    setTimeout(() => {
      metrics.completeBattleRoom('battle-1');
    }, 15);

    const state = await metrics.handleSigterm(5, 150);
    expect(metrics.canAcceptNewBattleMatch()).toBe(false);
    expect(state.draining).toBe(true);
    expect(state.remainingRooms).toBe(0);
    expect(state.disconnectedGracefully).toBe(true);
  });

  it('configures HPA targeting 500 sockets per pod with fast scale-out and 300s scale-down stabilization', () => {
    const manifestPath = path.resolve(process.cwd(), 'deploy/k8s/hpa-custom-metrics.yaml');
    const yamlContent = fs.readFileSync(manifestPath, 'utf8');

    expect(yamlContent).toContain('kind: HorizontalPodAutoscaler');
    expect(yamlContent).toContain('codepulse_active_websockets_count');
    expect(yamlContent).toContain('averageValue: "500"');
    expect(yamlContent).toContain('stabilizationWindowSeconds: 300');
  });
});
