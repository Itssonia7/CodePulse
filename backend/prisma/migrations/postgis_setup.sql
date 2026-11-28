-- Enable PostGIS spatial extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add fuzzed city-center spatial location column (WGS 84 / SRID 4326) to User table
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS country VARCHAR(64),
  ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);

-- Spatial GIST index for fast radius & proximity queries across large leaderboards
CREATE INDEX IF NOT EXISTS idx_user_location_gist
  ON "User"
  USING GIST (location);
