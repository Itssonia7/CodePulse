import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SpatialLeaderboardService,
  SpatialLeaderboardController,
  fuzzCoordinatesToCityCenter,
} from '../../../backend/src/modules/leaderboards/spatial-leaderboard.service';

describe('SpatialLeaderboardService & PostGIS Setup (#386)', () => {
  it('fuzzes coordinates for privacy, filters within 50km radius, clusters regions, and serves GET /api/v1/leaderboards/nearby', () => {
    const service = new SpatialLeaderboardService();
    const controller = new SpatialLeaderboardController(service);

    const exactStreetLat = 52.520008;
    const exactStreetLng = 13.404954;
    const fuzzed = fuzzCoordinatesToCityCenter(exactStreetLat, exactStreetLng, 'Berlin');
    expect(fuzzed.lat).not.toBe(exactStreetLat);
    expect(fuzzed.lng).not.toBe(exactStreetLng);

    service.syncUserLocation({
      userId: 'u-berlin-1',
      username: 'berlin_dev',
      elo: 1850,
      xp: 9200,
      city: 'Berlin',
      lat: exactStreetLat,
      lng: exactStreetLng,
    });

    service.syncUserLocation({
      userId: 'u-tokyo-1',
      username: 'tokyo_dev',
      elo: 2100,
      xp: 14000,
      city: 'Tokyo',
      lat: 35.6762,
      lng: 139.6503,
    });

    const nearby = controller.getNearby('52.52', '13.40', '50');
    expect(nearby).toHaveLength(1);
    expect(nearby[0].userId).toBe('u-berlin-1');
    expect(nearby[0].distanceKm).toBeLessThanOrEqual(50);

    const clusters = service.clusterDevelopers();
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    const sqlPath = path.resolve(process.cwd(), 'backend/prisma/migrations/postgis_setup.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    expect(sqlContent).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    expect(sqlContent).toContain('USING GIST');
  });
});
