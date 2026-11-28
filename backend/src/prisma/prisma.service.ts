export interface FederatedReportFilter {
  minXp?: number;
  role?: string;
  limit?: number;
}

export interface FederatedJoinQueryPlan {
  sql: string;
  params: Array<string | number>;
  pushesDownFilters: boolean;
  foreignSchemasUsed: string[];
}

export interface RawSqlRunner {
  queryRaw: (sql: string, params: Array<string | number>) => Promise<unknown[]> | unknown[];
}

export function buildFederatedAdminReportQuery(
  filter: FederatedReportFilter = {},
): FederatedJoinQueryPlan {
  const params: Array<string | number> = [];
  const predicates: string[] = [];

  if (typeof filter.minXp === 'number') {
    params.push(filter.minXp);
    predicates.push(`a.total_xp >= $${params.length}`);
  }

  if (filter.role) {
    params.push(filter.role);
    predicates.push(`u.role = $${params.length}`);
  }

  const whereClause = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(500, filter.limit ?? 50));
  params.push(safeLimit);

  const sql = [
    'SELECT',
    '  u.id AS user_id,',
    '  u.email AS user_email,',
    '  u.role AS user_role,',
    '  a.total_xp AS total_xp,',
    '  a.battles_won AS battles_won',
    'FROM ext_auth.users u',
    'INNER JOIN ext_analytics.developer_telemetry a ON a.user_id = u.id',
    whereClause,
    'ORDER BY a.total_xp DESC',
    `LIMIT $${params.length}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    sql,
    params,
    pushesDownFilters: true,
    foreignSchemasUsed: ['ext_auth', 'ext_analytics'],
  };
}

export class PrismaService {
  constructor(private readonly rawRunner?: RawSqlRunner) {}

  getFederatedReportPlan(filter: FederatedReportFilter = {}): FederatedJoinQueryPlan {
    return buildFederatedAdminReportQuery(filter);
  }

  async executeFederatedAdminReport<TRow = Record<string, unknown>>(
    filter: FederatedReportFilter = {},
    runner?: RawSqlRunner,
  ): Promise<{ rows: TRow[]; plan: FederatedJoinQueryPlan }> {
    const plan = buildFederatedAdminReportQuery(filter);
    const activeRunner = runner ?? this.rawRunner;

    if (!activeRunner) {
      return { rows: [], plan };
    }

    const rows = (await activeRunner.queryRaw(plan.sql, plan.params)) as TRow[];
    return { rows, plan };
  }
}
