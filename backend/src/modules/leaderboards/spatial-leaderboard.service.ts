import { Controller, Get, Query } from '@nestjs/common';

export interface SpatialDeveloperProfile {
  userId: string;
  username: string;
  elo: number;
  xp: number;
  city?: string;
  country?: string;
  lat: number;
  lng: number;
}

export interface NearbyDeveloperResult {
  userId: string;
  username: string;
  elo: number;
  xp: number;
  city: string;
  fuzzedLat: number;
  fuzzedLng: number;
  distanceKm: number;
}

export interface GeoClusterBucket {
  clusterId: string;
  centerLat: number;
  centerLng: number;
  developerCount: number;
  topElo: number;
}

const CITY_CENTROIDS: Record<string, { lat: number; lng: number; city: string }> = {
  berlin: { lat: 52.52, lng: 13.405, city: 'Berlin' },
  sangli: { lat: 16.8524, lng: 74.5815, city: 'Sangli' },
  pune: { lat: 18.5204, lng: 73.8567, city: 'Pune' },
  bengaluru: { lat: 12.9716, lng: 77.5946, city: 'Bengaluru' },
  mumbai: { lat: 19.076, lng: 72.8777, city: 'Mumbai' },
  tokyo: { lat: 35.6762, lng: 139.6503, city: 'Tokyo' },
};

/**
 * Fuzzes coordinates to ~0.05-degree (~5km) city-center grid to protect user privacy
 * while preserving regional proximity and geospatial clustering.
 */
export function fuzzCoordinatesToCityCenter(
  lat: number,
  lng: number,
  cityHint?: string,
): { lat: number; lng: number; city: string } {
  const normalizedCity = (cityHint ?? '').trim().toLowerCase();
  if (normalizedCity && CITY_CENTROIDS[normalizedCity]) {
    const centroid = CITY_CENTROIDS[normalizedCity];
    return {
      lat: Number(centroid.lat.toFixed(2)),
      lng: Number(centroid.lng.toFixed(2)),
      city: centroid.city,
    };
  }

  const gridStepDeg = 0.05;
  const fuzzedLat = Number((Math.round(lat / gridStepDeg) * gridStepDeg).toFixed(2));
  const fuzzedLng = Number((Math.round(lng / gridStepDeg) * gridStepDeg).toFixed(2));
  return {
    lat: fuzzedLat,
    lng: fuzzedLng,
    city: cityHint ? cityHint.trim() : `Zone(${fuzzedLat},${fuzzedLng})`,
  };
}

export function resolveIpOrCityToCoordinates(params: {
  ipAddress?: string;
  city?: string;
  fallbackLat?: number;
  fallbackLng?: number;
}): { lat: number; lng: number; city: string } {
  if (params.city) {
    return fuzzCoordinatesToCityCenter(
      params.fallbackLat ?? 0,
      params.fallbackLng ?? 0,
      params.city,
    );
  }

  if (params.ipAddress) {
    const octets = params.ipAddress.split('.').map((n) => Number(n));
    if (octets.length === 4 && octets.every((n) => Number.isFinite(n))) {
      const approxLat = Number((((octets[0] % 140) - 70) + (octets[1] % 10) * 0.1).toFixed(2));
      const approxLng = Number((((octets[2] % 340) - 170) + (octets[3] % 10) * 0.1).toFixed(2));
      return fuzzCoordinatesToCityCenter(approxLat, approxLng, 'IP-Region');
    }
  }

  return fuzzCoordinatesToCityCenter(params.fallbackLat ?? 0, params.fallbackLng ?? 0);
}

/**
 * Mirrors PostGIS ST_DistanceSphere / ST_DWithin in meters & kilometers (SRID 4326).
 */
export function stDistanceSphereMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Number((earthRadiusMeters * c).toFixed(2));
}

export function stDWithinMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMeters: number,
): boolean {
  return stDistanceSphereMeters(lat1, lng1, lat2, lng2) <= radiusMeters;
}

export class SpatialLeaderboardService {
  private readonly profiles = new Map<string, NearbyDeveloperResult>();

  syncUserLocation(profile: SpatialDeveloperProfile): NearbyDeveloperResult {
    const fuzzed = fuzzCoordinatesToCityCenter(profile.lat, profile.lng, profile.city);
    const entry: NearbyDeveloperResult = {
      userId: profile.userId,
      username: profile.username,
      elo: profile.elo,
      xp: profile.xp,
      city: fuzzed.city,
      fuzzedLat: fuzzed.lat,
      fuzzedLng: fuzzed.lng,
      distanceKm: 0,
    };
    this.profiles.set(profile.userId, entry);
    return entry;
  }

  queryNearbyDevelopers(params: {
    lat: number;
    lng: number;
    radiusKm?: number;
  }): NearbyDeveloperResult[] {
    const radiusMeters = (params.radiusKm ?? 50) * 1000;
    const results: NearbyDeveloperResult[] = [];

    for (const dev of this.profiles.values()) {
      const distMeters = stDistanceSphereMeters(params.lat, params.lng, dev.fuzzedLat, dev.fuzzedLng);
      if (stDWithinMeters(params.lat, params.lng, dev.fuzzedLat, dev.fuzzedLng, radiusMeters)) {
        results.push({
          ...dev,
          distanceKm: Number((distMeters / 1000).toFixed(2)),
        });
      }
    }

    return results.sort((a, b) => a.distanceKm - b.distanceKm || b.elo - a.elo);
  }

  clusterDevelopers(gridPrecisionDeg = 0.5): GeoClusterBucket[] {
    const buckets = new Map<string, GeoClusterBucket>();

    for (const dev of this.profiles.values()) {
      const bLat = Number((Math.floor(dev.fuzzedLat / gridPrecisionDeg) * gridPrecisionDeg).toFixed(2));
      const bLng = Number((Math.floor(dev.fuzzedLng / gridPrecisionDeg) * gridPrecisionDeg).toFixed(2));
      const key = `${bLat}:${bLng}`;
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, {
          clusterId: key,
          centerLat: bLat,
          centerLng: bLng,
          developerCount: 1,
          topElo: dev.elo,
        });
      } else {
        existing.developerCount += 1;
        existing.topElo = Math.max(existing.topElo, dev.elo);
      }
    }

    return Array.from(buckets.values()).sort((a, b) => b.developerCount - a.developerCount);
  }
}

@Controller('api/v1/leaderboards')
export class SpatialLeaderboardController {
  constructor(
    private readonly spatialService: SpatialLeaderboardService = new SpatialLeaderboardService(),
  ) {}

  @Get('nearby')
  getNearby(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radiusKm') radiusKm?: string,
  ): NearbyDeveloperResult[] {
    return this.spatialService.queryNearbyDevelopers({
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: radiusKm ? Number(radiusKm) : 50,
    });
  }
}
