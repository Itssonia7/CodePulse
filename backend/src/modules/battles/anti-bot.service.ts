export type KeystrokeEventType = 'key_down' | 'key_up';

export interface BiometricKeystrokeEvent {
  type: KeystrokeEventType;
  key: string;
  timestampUs: number;
  isClipboardPaste?: boolean;
}

export interface KeystrokeMetricsSummary {
  sampleCount: number;
  dwellTimesMs: number[];
  flightTimesMs: number[];
  meanFlightTimeMs: number;
  flightVarianceMs2: number;
  flightStdDevMs: number;
  clipboardBurstCount: number;
}

export interface AntiCheatLogEntry {
  id: string;
  battleId: string;
  playerId: string;
  flagged: boolean;
  reasons: string[];
  flightStdDevMs: number;
  flightVarianceMs2: number;
  eloPaused: boolean;
  moderatorNotified: boolean;
  createdAt: string;
}

export interface CadenceEvaluationResult {
  battleId: string;
  playerId: string;
  flagged: boolean;
  reasons: string[];
  metrics: KeystrokeMetricsSummary;
  eloPaused: boolean;
  moderatorNotified: boolean;
  auditLog: AntiCheatLogEntry;
}

export function computeKeystrokeMetrics(
  events: readonly BiometricKeystrokeEvent[],
): KeystrokeMetricsSummary {
  const ordered = [...events].sort((a, b) => a.timestampUs - b.timestampUs);
  const openKeyDowns = new Map<string, number>();
  const dwellTimesMs: number[] = [];
  const downTimestampsUs: number[] = [];
  let clipboardBurstCount = 0;

  for (const ev of ordered) {
    if (ev.isClipboardPaste) {
      clipboardBurstCount++;
    }

    if (ev.type === 'key_down') {
      downTimestampsUs.push(ev.timestampUs);
      if (!openKeyDowns.has(ev.key)) {
        openKeyDowns.set(ev.key, ev.timestampUs);
      }
    } else if (ev.type === 'key_up') {
      const startUs = openKeyDowns.get(ev.key);
      if (startUs !== undefined && ev.timestampUs >= startUs) {
        dwellTimesMs.push(Number(((ev.timestampUs - startUs) / 1000).toFixed(4)));
        openKeyDowns.delete(ev.key);
      }
    }
  }

  const flightTimesMs: number[] = [];
  for (let i = 1; i < downTimestampsUs.length; i++) {
    const intervalMs = (downTimestampsUs[i] - downTimestampsUs[i - 1]) / 1000;
    flightTimesMs.push(Number(Math.max(0, intervalMs).toFixed(4)));
  }

  const meanFlightTimeMs =
    flightTimesMs.length === 0
      ? 0
      : flightTimesMs.reduce((acc, v) => acc + v, 0) / flightTimesMs.length;

  const flightVarianceMs2 =
    flightTimesMs.length === 0
      ? 0
      : flightTimesMs.reduce((acc, v) => {
          const diff = v - meanFlightTimeMs;
          return acc + diff * diff;
        }, 0) / flightTimesMs.length;

  const flightStdDevMs = Number(Math.sqrt(flightVarianceMs2).toFixed(4));

  return {
    sampleCount: ordered.length,
    dwellTimesMs,
    flightTimesMs,
    meanFlightTimeMs: Number(meanFlightTimeMs.toFixed(4)),
    flightVarianceMs2: Number(flightVarianceMs2.toFixed(4)),
    flightStdDevMs,
    clipboardBurstCount,
  };
}

export class AntiBotService {
  private readonly logs: AntiCheatLogEntry[] = [];
  private readonly moderatorAlerts: AntiCheatLogEntry[] = [];
  private readonly pausedBattles = new Set<string>();

  async analyzeCadenceAsync(params: {
    battleId: string;
    playerId: string;
    events: readonly BiometricKeystrokeEvent[];
  }): Promise<CadenceEvaluationResult> {
    await Promise.resolve();

    const metrics = computeKeystrokeMetrics(params.events);
    const reasons: string[] = [];

    if (metrics.clipboardBurstCount > 0 || metrics.flightTimesMs.some((f) => f < 1.5)) {
      reasons.push('Clipboard or sub-millisecond macro burst detected');
    }

    if (metrics.flightTimesMs.length >= 4 && metrics.flightStdDevMs < 5) {
      reasons.push(
        `Low flight-time cadence standard deviation (${metrics.flightStdDevMs}ms < 5ms threshold; variance=${metrics.flightVarianceMs2}ms^2)`,
      );
    }

    const flagged = reasons.length > 0;
    const eloPaused = flagged;
    const moderatorNotified = flagged;

    if (eloPaused) {
      this.pausedBattles.add(`${params.battleId}:${params.playerId}`);
    }

    const auditLog: AntiCheatLogEntry = {
      id: `ac-${this.logs.length + 1}-${params.battleId}`,
      battleId: params.battleId,
      playerId: params.playerId,
      flagged,
      reasons,
      flightStdDevMs: metrics.flightStdDevMs,
      flightVarianceMs2: metrics.flightVarianceMs2,
      eloPaused,
      moderatorNotified,
      createdAt: new Date().toISOString(),
    };

    this.logs.push(auditLog);
    if (moderatorNotified) {
      this.moderatorAlerts.push(auditLog);
    }

    return {
      battleId: params.battleId,
      playerId: params.playerId,
      flagged,
      reasons,
      metrics,
      eloPaused,
      moderatorNotified,
      auditLog,
    };
  }

  isEloPaused(battleId: string, playerId: string): boolean {
    return this.pausedBattles.has(`${battleId}:${playerId}`);
  }

  getAntiCheatLogs(): readonly AntiCheatLogEntry[] {
    return this.logs;
  }

  getModeratorAlerts(): readonly AntiCheatLogEntry[] {
    return this.moderatorAlerts;
  }
}
