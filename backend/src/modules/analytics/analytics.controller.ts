import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ProfilerService,
  type CommitBenchmarkInput,
  type PerformanceProfileReport,
} from './profiler.service';

@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly profilerService: ProfilerService = new ProfilerService(),
  ) {}

  @Post('repositories/:id/performance-profile')
  createPerformanceProfile(
    @Param('id') id: string,
    @Body() body: Omit<CommitBenchmarkInput, 'repositoryId'>,
  ): PerformanceProfileReport {
    return this.profilerService.runCommitProfile({
      ...body,
      repositoryId: id,
    });
  }

  @Get('repositories/:id/performance-profile')
  getPerformanceProfile(
    @Param('id') id: string,
    @Query('commitSha') commitSha?: string,
  ): PerformanceProfileReport {
    return this.profilerService.getLatestPerformanceProfile(id, commitSha);
  }
}
