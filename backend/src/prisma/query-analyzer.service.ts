export interface ExplainPlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  Plans?: ExplainPlanNode[];
}

export interface ExplainJsonPayload {
  Plan?: ExplainPlanNode;
  'Startup Cost'?: number;
  'Total Cost'?: number;
}

export interface QueryAnalysisResult {
  modelOrTarget: string;
  operation: 'findMany' | 'rawQuery';
  startupCost: number;
  totalCost: number;
  seqScanDetected: boolean;
  seqScanTable?: string;
  estimatedRows: number;
  warnings: string[];
  diagnostics: string[];
}

export interface ExplainExecutor {
  runExplainJson: (sqlOrQuery: string) => Promise<ExplainJsonPayload[]> | ExplainJsonPayload[];
}

export const QUERY_COST_THRESHOLD = 5000;
export const SEQ_SCAN_ROW_THRESHOLD = 10000;

export function isQueryAnalyzerEnabled(nodeEnv = process.env.NODE_ENV): boolean {
  const normalized = (nodeEnv ?? 'development').toLowerCase();
  return normalized !== 'production';
}

export function extractCostAndScans(plans: ExplainJsonPayload[]): {
  startupCost: number;
  totalCost: number;
  seqScanTable?: string;
  estimatedRows: number;
} {
  let startupCost = 0;
  let totalCost = 0;
  let seqScanTable: string | undefined;
  let estimatedRows = 0;

  const visit = (node: ExplainPlanNode | undefined): void => {
    if (!node) return;
    if (typeof node['Startup Cost'] === 'number') {
      startupCost = Math.max(startupCost, node['Startup Cost']);
    }
    if (typeof node['Total Cost'] === 'number') {
      totalCost = Math.max(totalCost, node['Total Cost']);
    }
    if (typeof node['Plan Rows'] === 'number') {
      estimatedRows = Math.max(estimatedRows, node['Plan Rows']);
    }
    if (
      node['Node Type'] === 'Seq Scan' &&
      typeof node['Plan Rows'] === 'number' &&
      node['Plan Rows'] > SEQ_SCAN_ROW_THRESHOLD
    ) {
      seqScanTable = node['Relation Name'] ?? 'DeveloperRating';
    }
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        visit(child);
      }
    }
  };

  for (const item of plans) {
    if (typeof item['Startup Cost'] === 'number') {
      startupCost = Math.max(startupCost, item['Startup Cost']);
    }
    if (typeof item['Total Cost'] === 'number') {
      totalCost = Math.max(totalCost, item['Total Cost']);
    }
    visit(item.Plan);
  }

  return {
    startupCost,
    totalCost,
    seqScanTable,
    estimatedRows,
  };
}

export class QueryAnalyzerService {
  private readonly diagnosticsLog: QueryAnalysisResult[] = [];

  constructor(private readonly nodeEnv = process.env.NODE_ENV) {}

  async analyzeQuery(params: {
    modelOrTarget: string;
    operation: 'findMany' | 'rawQuery';
    queryDescriptor: string;
    explainExecutor: ExplainExecutor;
  }): Promise<QueryAnalysisResult> {
    if (!isQueryAnalyzerEnabled(this.nodeEnv)) {
      return {
        modelOrTarget: params.modelOrTarget,
        operation: params.operation,
        startupCost: 0,
        totalCost: 0,
        seqScanDetected: false,
        estimatedRows: 0,
        warnings: [],
        diagnostics: ['Query analyzer disabled in production mode.'],
      };
    }

    const explainSql = `EXPLAIN (FORMAT JSON) ${params.queryDescriptor}`;
    const planJson = await params.explainExecutor.runExplainJson(explainSql);
    const { startupCost, totalCost, seqScanTable, estimatedRows } = extractCostAndScans(planJson);

    const warnings: string[] = [];
    const diagnostics: string[] = [
      `[${params.modelOrTarget}.${params.operation}] startupCost=${startupCost}, totalCost=${totalCost}, rows=${estimatedRows}`,
    ];

    const seqScanDetected = Boolean(seqScanTable);
    if (seqScanDetected) {
      const targetTable =
        seqScanTable === 'DeveloperRating' || params.modelOrTarget === 'DeveloperRating'
          ? 'DeveloperRating'
          : seqScanTable ?? params.modelOrTarget;
      const indexHint =
        targetTable === 'DeveloperRating'
          ? 'Unindexed query detected on table DeveloperRating. Missing composite index on [xp, elo]'
          : `Unindexed query detected on table ${targetTable} (Seq Scan on ${estimatedRows} rows). Consider adding a composite index.`;
      warnings.push(indexHint);
      diagnostics.push(indexHint);
    }

    if (totalCost > QUERY_COST_THRESHOLD) {
      const costErr = `Query cost exceeded threshold (${totalCost} > ${QUERY_COST_THRESHOLD}) on ${params.modelOrTarget} (${params.operation}).`;
      warnings.push(costErr);
      diagnostics.push(costErr);
      this.diagnosticsLog.push({
        modelOrTarget: params.modelOrTarget,
        operation: params.operation,
        startupCost,
        totalCost,
        seqScanDetected,
        seqScanTable,
        estimatedRows,
        warnings,
        diagnostics,
      });
      throw new Error(`${costErr} ${warnings.join(' ')}`);
    }

    const result: QueryAnalysisResult = {
      modelOrTarget: params.modelOrTarget,
      operation: params.operation,
      startupCost,
      totalCost,
      seqScanDetected,
      seqScanTable,
      estimatedRows,
      warnings,
      diagnostics,
    };

    this.diagnosticsLog.push(result);
    return result;
  }

  getDiagnosticsHistory(): readonly QueryAnalysisResult[] {
    return this.diagnosticsLog;
  }
}
