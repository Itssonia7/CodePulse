-- Enable PostgreSQL Foreign Data Wrapper extension
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Isolated target schemas for federated microservices
CREATE SCHEMA IF NOT EXISTS ext_analytics;
CREATE SCHEMA IF NOT EXISTS ext_auth;

-- Foreign server definitions (configured via environment / SSL-encrypted connections in deployment)
CREATE SERVER IF NOT EXISTS analytics_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host 'analytics-db.internal',
    port '5432',
    dbname 'codepulse_analytics',
    sslmode 'require',
    use_remote_estimate 'true',
    fdw_startup_cost '100.0',
    fdw_tuple_cost '0.05'
  );

CREATE SERVER IF NOT EXISTS auth_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host 'auth-db.internal',
    port '5432',
    dbname 'codepulse_auth',
    sslmode 'require',
    use_remote_estimate 'true',
    fdw_startup_cost '100.0',
    fdw_tuple_cost '0.05'
  );

-- User mappings with encrypted / SCRAM-SHA-256 credentials
CREATE USER MAPPING IF NOT EXISTS FOR CURRENT_USER
  SERVER analytics_server
  OPTIONS (user 'fdw_analytics_reader', password 'ENCRYPTED_FDW_ANALYTICS_SECRET');

CREATE USER MAPPING IF NOT EXISTS FOR CURRENT_USER
  SERVER auth_server
  OPTIONS (user 'fdw_auth_reader', password 'ENCRYPTED_FDW_AUTH_SECRET');

-- Import foreign schemas into isolated namespaces
IMPORT FOREIGN SCHEMA analytics
  FROM SERVER analytics_server
  INTO ext_analytics;

IMPORT FOREIGN SCHEMA auth
  FROM SERVER auth_server
  INTO ext_auth;
