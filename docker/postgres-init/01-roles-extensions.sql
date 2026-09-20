-- Runs once, on first container start, as POSTGRES_USER (ifp_owner).
-- Two roles, deliberately separated:
--   ifp_owner : DDL / migrations only (Prisma DATABASE_DIRECT_URL)
--   ifp_app   : runtime DML only, NOBYPASSRLS so Row Level Security actually applies

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ifp_app') THEN
    CREATE ROLE ifp_app
      LOGIN PASSWORD 'ifp_app_dev_pw'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ifp TO ifp_app;
GRANT USAGE ON SCHEMA public TO ifp_app;

-- Tables that already exist (none on first boot, but keeps re-runs safe)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ifp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ifp_app;

-- Anything the migration role creates later is usable by the app role.
-- The audit_log grant is tightened back to INSERT/SELECT in the RLS migration.
ALTER DEFAULT PRIVILEGES FOR ROLE ifp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ifp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ifp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ifp_app;
