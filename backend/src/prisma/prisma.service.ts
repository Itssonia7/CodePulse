import {
  QueryAnalyzerService,
  type ExplainExecutor,
  type QueryAnalysisResult,
} from './query-analyzer.service';

export interface QueryExtensionContext {
  model?: string;
  operation: string;
  args?: unknown;
  query: (args?: unknown) => Promise<unknown>;
}

export class PrismaService {
  constructor(
    private readonly queryAnalyzerService: QueryAnalyzerService = new QueryAnalyzerService(),
    private readonly explainExecutor?: ExplainExecutor,
  ) {}

  getAnalyzer(): QueryAnalyzerService {
    return this.queryAnalyzerService;
  }

  async executeWithGuardrail<TResult>(
    ctx: QueryExtensionContext,
    customExecutor?: ExplainExecutor,
  ): Promise<{ result: TResult; analysis?: QueryAnalysisResult }> {
    const isInterceptedOp =
      ctx.operation === 'findMany' ||
      ctx.operation === '$queryRaw' ||
      ctx.operation === '$queryRawUnsafe' ||
      ctx.operation === 'rawQuery';

    const executor = customExecutor ?? this.explainExecutor;

    let analysis: QueryAnalysisResult | undefined;
    if (isInterceptedOp && executor) {
      const targetName = ctx.model ?? 'RawSQL';
      const normalizedOp: 'findMany' | 'rawQuery' =
        ctx.operation === 'findMany' ? 'findMany' : 'rawQuery';
      analysis = await this.queryAnalyzerService.analyzeQuery({
        modelOrTarget: targetName,
        operation: normalizedOp,
        queryDescriptor: `${targetName}.${ctx.operation}(${JSON.stringify(ctx.args ?? {})})`,
        explainExecutor: executor,
      });
    }

    const result = (await ctx.query(ctx.args)) as TResult;
    return { result, analysis };
  }
}
