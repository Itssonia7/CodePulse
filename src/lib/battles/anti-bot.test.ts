import { describe, it, expect, vi } from 'vitest';
import {
  AntiBotService,
  type BiometricKeystrokeEvent,
} from '../../../backend/src/modules/battles/anti-bot.service';
import { BattlesGateway } from '../../../backend/src/modules/battles/battles.gateway';

function buildHumanCadence(startUs = 1_000_000): BiometricKeystrokeEvent[] {
  const events: BiometricKeystrokeEvent[] = [];
  const flightOffsetsMs = [85, 162, 110, 215, 94, 178, 132, 195];
  const dwellOffsetsMs = [68, 92, 55, 104, 71, 88, 63, 97];
  let cursorUs = startUs;

  for (let i = 0; i < flightOffsetsMs.length; i++) {
    if (i > 0) {
      cursorUs += flightOffsetsMs[i] * 1000;
    }
    const key = `k${i}`;
    events.push({ type: 'key_down', key, timestampUs: cursorUs });
    events.push({
      type: 'key_up',
      key,
      timestampUs: cursorUs + dwellOffsetsMs[i] * 1000,
    });
  }
  return events;
}

function buildBotMacroCadence(startUs = 2_000_000): BiometricKeystrokeEvent[] {
  const events: BiometricKeystrokeEvent[] = [];
  let cursorUs = startUs;
  for (let i = 0; i < 8; i++) {
    if (i > 0) {
      cursorUs += 50_000; // constant 50ms bot interval -> ~0ms std dev
    }
    const key = `b${i}`;
    events.push({ type: 'key_down', key, timestampUs: cursorUs });
    events.push({ type: 'key_up', key, timestampUs: cursorUs + 20_000 });
  }
  return events;
}

describe('AntiBotService & BattlesGateway Keystroke Cadence Engine (#401)', () => {
  it('permits natural human typing variance without false positives and flags synthetic bot cadence', async () => {
    const antiBot = new AntiBotService();
    const alertSpy = vi.fn();
    const gateway = new BattlesGateway(antiBot, alertSpy);

    const humanAck = gateway.onKeystrokeBatch({
      battleId: 'match-101',
      playerId: 'human-player',
      events: buildHumanCadence(),
    });
    expect(humanAck.accepted).toBe(true);

    const [humanResult] = await gateway.flushPendingAnalyses();
    expect(humanResult.flagged).toBe(false);
    expect(humanResult.eloPaused).toBe(false);
    expect(antiBot.isEloPaused('match-101', 'human-player')).toBe(false);

    gateway.onKeystrokeBatch({
      battleId: 'match-101',
      playerId: 'macro-bot',
      events: buildBotMacroCadence(),
    });

    const [botResult] = await gateway.flushPendingAnalyses();
    expect(botResult.flagged).toBe(true);
    expect(botResult.metrics.flightStdDevMs).toBeLessThan(5);
    expect(botResult.eloPaused).toBe(true);
    expect(antiBot.isEloPaused('match-101', 'macro-bot')).toBe(true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(antiBot.getAntiCheatLogs()).toHaveLength(2);
  });
});
