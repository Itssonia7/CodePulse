import {
  AntiBotService,
  type BiometricKeystrokeEvent,
  type CadenceEvaluationResult,
} from './anti-bot.service';

export interface KeystrokePacketMessage {
  battleId: string;
  playerId: string;
  events: BiometricKeystrokeEvent[];
}

export class BattlesGateway {
  private readonly pendingAnalyses = new Map<string, Promise<CadenceEvaluationResult>>();

  constructor(
    private readonly antiBotService: AntiBotService = new AntiBotService(),
    private readonly onModeratorAlert?: (result: CadenceEvaluationResult) => void,
  ) {}

  onKeystrokeBatch(packet: KeystrokePacketMessage): {
    accepted: boolean;
    queuedAtUs: number;
  } {
    const queuedAtUs = Date.now() * 1000;
    const taskKey = `${packet.battleId}:${packet.playerId}:${queuedAtUs}`;

    const job = this.antiBotService
      .analyzeCadenceAsync({
        battleId: packet.battleId,
        playerId: packet.playerId,
        events: packet.events,
      })
      .then((result) => {
        if (result.flagged && result.moderatorNotified) {
          this.onModeratorAlert?.(result);
        }
        return result;
      })
      .finally(() => {
        this.pendingAnalyses.delete(taskKey);
      });

    this.pendingAnalyses.set(taskKey, job);

    return {
      accepted: true,
      queuedAtUs,
    };
  }

  async flushPendingAnalyses(): Promise<CadenceEvaluationResult[]> {
    const tasks = Array.from(this.pendingAnalyses.values());
    return Promise.all(tasks);
  }
}
