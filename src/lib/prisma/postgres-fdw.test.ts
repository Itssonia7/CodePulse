import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { PrismaService } from '../../../backend/src/prisma/prisma.service';

describe('PostgreSQL FDW Setup & Federated Queries (#383)', () => {
  it('defines postgres_fdw servers, isolated schemas, IMPORT FOREIGN SCHEMA, and planner cost options', () => {
    const sqlPath = path.resolve(process.cwd(), 'backend/prisma/migrations/postgres_fdw.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS postgres_fdw');
    expect(sql).toContain('CREATE SERVER IF NOT EXISTS analytics_server');
    expect(sql).toContain('CREATE SERVER IF NOT EXISTS auth_server');
    expect(sql).toContain('IMPORT FOREIGN SCHEMA analytics');
    expect(sql).toContain('INTO ext_analytics');
    expect(sql).toContain("use_remote_estimate 'true'");
  });

  it('builds parameterized cross-schema federated join queries with pushed-down filters', async () => {
    const mockRunner = {
      queryRaw: vi.fn().mockResolvedValue([
        {
          user_id: 'usr-1',
          user_email: 'lead@codepulse.dev',
          user_role: 'ADMIN',
          total_xp: 15200,
          battles_won: 48,
        },
      ]),
    };

    const prisma = new PrismaService(mockRunner);
    const { rows, plan } = await prisma.executeFederatedAdminReport({
      minXp: 10000,
      role: 'ADMIN',
      limit: 25,
    });

    expect(plan.pushesDownFilters).toBe(true);
    expect(plan.sql).toContain('FROM ext_auth.users u');
    expect(plan.sql).toContain('INNER JOIN ext_analytics.developer_telemetry a');
    expect(plan.sql).toContain('a.total_xp >= $1');
    expect(plan.sql).toContain('u.role = $2');
    expect(plan.params).toEqual([10000, 'ADMIN', 25]);
    expect(rows).toHaveLength(1);
    expect(mockRunner.queryRaw).toHaveBeenCalledTimes(1);
  });
});
