export interface ActiveBattleRoom {
  roomId: string;
  activeSockets: number;
  inProgress: boolean;
}

export interface GracefulDrainState {
  acceptingNewMatches: boolean;
  draining: boolean;
  remainingRooms: number;
  remainingSockets: number;
  disconnectedGracefully: boolean;
}

export class MetricsService {
  private activeWebsocketsCount = 0;
  private queueBacklogJobs = 0;
  private acceptingNewMatches = true;
  private draining = false;
  private disconnectedGracefully = false;
  private readonly battleRooms = new Map<string, ActiveBattleRoom>();

  setActiveWebsocketsCount(count: number): number {
    this.activeWebsocketsCount = Math.max(0, Math.floor(count));
    return this.activeWebsocketsCount;
  }

  incrementActiveWebsockets(delta = 1): number {
    return this.setActiveWebsocketsCount(this.activeWebsocketsCount + delta);
  }

  setQueueBacklogJobs(count: number): number {
    this.queueBacklogJobs = Math.max(0, Math.floor(count));
    return this.queueBacklogJobs;
  }

  registerBattleRoom(roomId: string, activeSockets: number, inProgress = true): void {
    this.battleRooms.set(roomId, {
      roomId,
      activeSockets: Math.max(0, activeSockets),
      inProgress,
    });
    const totalSockets = Array.from(this.battleRooms.values()).reduce(
      (sum, r) => sum + r.activeSockets,
      0,
    );
    if (totalSockets > this.activeWebsocketsCount) {
      this.activeWebsocketsCount = totalSockets;
    }
  }

  completeBattleRoom(roomId: string): void {
    this.battleRooms.delete(roomId);
  }

  canAcceptNewBattleMatch(): boolean {
    return this.acceptingNewMatches && !this.draining;
  }

  renderPrometheusMetrics(): string {
    return [
      '# HELP codepulse_active_websockets_count Current active WebSocket connections on this pod.',
      '# TYPE codepulse_active_websockets_count gauge',
      `codepulse_active_websockets_count ${this.activeWebsocketsCount}`,
      '# HELP codepulse_queue_backlog_jobs Pending BullMQ jobs waiting in queue.',
      '# TYPE codepulse_queue_backlog_jobs gauge',
      `codepulse_queue_backlog_jobs ${this.queueBacklogJobs}`,
      '# HELP codepulse_draining_in_progress Whether pod is draining rooms on SIGTERM.',
      '# TYPE codepulse_draining_in_progress gauge',
      `codepulse_draining_in_progress ${this.draining ? 1 : 0}`,
    ].join('\n');
  }

  async handleSigterm(pollIntervalMs = 5, maxWaitMs = 150): Promise<GracefulDrainState> {
    this.acceptingNewMatches = false;
    this.draining = true;

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const hasActiveRooms = Array.from(this.battleRooms.values()).some((r) => r.inProgress);
      if (!hasActiveRooms) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    for (const [roomId, room] of this.battleRooms.entries()) {
      if (!room.inProgress) {
        this.battleRooms.delete(roomId);
      }
    }

    const remainingRooms = this.battleRooms.size;
    const remainingSockets = Array.from(this.battleRooms.values()).reduce(
      (sum, r) => sum + r.activeSockets,
      0,
    );

    if (remainingRooms === 0) {
      this.activeWebsocketsCount = 0;
      this.disconnectedGracefully = true;
    }

    return {
      acceptingNewMatches: this.acceptingNewMatches,
      draining: this.draining,
      remainingRooms,
      remainingSockets,
      disconnectedGracefully: this.disconnectedGracefully,
    };
  }
}
