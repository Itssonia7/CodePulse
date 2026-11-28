import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import {
  PrBotService,
  type GithubWebhookPayload,
  type PrBotReviewOutcome,
} from '../ai/pr-bot.service';

@Controller('api/v1/github/webhooks')
export class GithubWebhookController {
  constructor(private readonly prBotService: PrBotService = new PrBotService()) {}

  @Post()
  handleWebhook(
    @Headers('x-github-event') eventHeader: string | undefined,
    @Body() payload: GithubWebhookPayload,
  ): PrBotReviewOutcome {
    return this.prBotService.handleWebhookEvent(eventHeader, payload);
  }

  @Get('audits')
  getReviewAudits() {
    return this.prBotService.getAudits();
  }
}
