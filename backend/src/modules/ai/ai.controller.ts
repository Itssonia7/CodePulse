import { Body, Controller, Post, Res } from '@nestjs/common';
import {
  CodebaseAgentService,
  type CodebaseChatRequest,
  type CodebaseFileInput,
} from './codebase-agent.service';

export interface SseWritableResponse {
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: () => void;
}

@Controller('api/v1/ai')
export class AiController {
  constructor(
    private readonly codebaseAgentService: CodebaseAgentService = new CodebaseAgentService(),
  ) {}

  @Post('codebase-index')
  indexCodebase(
    @Body() body: { repository: string; files: CodebaseFileInput[] },
  ) {
    const chunks = this.codebaseAgentService.indexRepositoryFiles(
      body.repository,
      body.files ?? [],
    );
    return {
      repository: body.repository,
      indexedChunks: chunks.length,
    };
  }

  @Post('codebase-chat')
  async streamCodebaseChat(
    @Body() body: CodebaseChatRequest,
    @Res() res?: SseWritableResponse,
  ): Promise<string> {
    const sseChunks: string[] = [];

    if (res) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    for await (const frame of this.codebaseAgentService.streamCodebaseChatSse(body)) {
      const formatted = `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
      sseChunks.push(formatted);
      res?.write(formatted);
    }

    res?.end();
    return sseChunks.join('');
  }
}
