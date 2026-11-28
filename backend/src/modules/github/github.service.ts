import { Body, Controller, Injectable, Post } from '@nestjs/common';
import {
  ConflictResolverService,
  type ResolveConflictInput,
  type ResolveConflictResult,
} from '../git/conflict-resolver.service';

@Injectable()
export class GithubService {
  constructor(
    private readonly conflictResolverService: ConflictResolverService = new ConflictResolverService(),
  ) {}

  async resolveGitConflict(input: ResolveConflictInput): Promise<ResolveConflictResult> {
    return this.conflictResolverService.resolveConflict(input);
  }
}

@Controller('api/v1/git')
export class GitConflictController {
  constructor(private readonly githubService: GithubService = new GithubService()) {}

  @Post('resolve-conflict')
  resolveConflict(@Body() body: ResolveConflictInput): Promise<ResolveConflictResult> {
    return this.githubService.resolveGitConflict(body);
  }
}
