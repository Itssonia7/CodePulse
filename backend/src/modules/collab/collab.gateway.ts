import { Injectable, Logger } from '@nestjs/common';

export interface CollabSignalFrame {
  roomId: string;
  senderPeerId: string;
  type: 'CURSOR_MOVE' | 'POINTER_CLICK' | 'BITRATE_ADAPT' | 'WEBRTC_SIGNAL';
  xNormalized?: number;
  yNormalized?: number;
  timestampMs: number;
  payload?: Record<string, unknown>;
}

@Injectable()
export class CollabGateway {
  private readonly logger = new Logger(CollabGateway.name);
  private readonly roomFrames = new Map<string, CollabSignalFrame[]>();

  relayFrame(frame: CollabSignalFrame, nowMs = Date.now()): {
    delivered: boolean;
    relayLatencyMs: number;
    frame: CollabSignalFrame;
  } {
    const relayLatencyMs = Math.max(0, Number((nowMs - frame.timestampMs).toFixed(2)));
    const list = this.roomFrames.get(frame.roomId) ?? [];
    list.push(frame);
    this.roomFrames.set(frame.roomId, list);

    return {
      delivered: relayLatencyMs < 40,
      relayLatencyMs,
      frame,
    };
  }

  getRoomHistory(roomId: string): CollabSignalFrame[] {
    return this.roomFrames.get(roomId) ?? [];
  }
}
