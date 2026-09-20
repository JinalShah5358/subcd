-- ---------------------------------------------------------------------------
-- Licensing: what a firm has paid for, and what lapses when it runs out.
--
-- Two decisions are encoded here rather than in application code, because
-- both of them are the kind that quietly stops being true when someone adds a
-- route in a hurry.
--
--   1. A lapsed licence makes a firm READ-ONLY. It does not lock them out and
--      it deletes nothing. These are a CA firm's professional records and they
--      may be obliged to produce them; withholding a client's own case file
--      over a late renewal is not a thing this software should do. Suspension
--      — separate, reasoned, audited — is the lever that refuses sign-in.
--
--   2. A firm cannot edit its own licence. The firm-facing update schema does
--      not carry the columns, but "the Zod schema does not have that field" is
--      one refactor away from being false, so a trigger below refuses any
--      change to a licence column that arrives from inside a tenant
--      transaction. The platform functions run without a tenant set and are
--      therefore unaffected.
-- ---------------------------------------------------------------------------

CREATE TYPE "LicensePlan" AS ENUM ('TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

ALTER TABLE firm
  ADD COLUMN plan                "LicensePlan" NOT NULL DEFAULT 'TRIAL',
  -- DATE, not timestamptz: a subsidy licence ends on a day in Gujarat, and
  -- storing an instant invites it to expire at half past five in the morning.
  ADD COLUMN license_expires_at  date,
  ADD COLUMN license_grace_days  integer NOT NULL DEFAULT 14,
  ADD COLUMN max_users           integer,
  ADD COLUMN max_clients         integer,
  ADD COLUMN max_cases           integer,
  ADD COLUMN license_note        varchar(500),
  ADD COLUMN license_updated_at  timestamptz;

-- NULL means unlimited everywhere, so the only thing worth forbidding is a
-- negative quota — which would make every count "over the limit".
ALTER TABLE firm
  ADD CONSTRAINT firm_quotas_non_negative CHECK (
    COALESCE(max_users, 0)   >= 0 AND
    COALESCE(max_clients, 0) >= 0 AND
    COALESCE(max_cases, 0)   >= 0 AND
    license_grace_days       >= 0
  );

CREATE INDEX firm_license_expires_at_idx ON firm (license_expires_at);

-- Firms that already exist predate licensing. Defaulting them to the TRIAL
-- above would expire every one of them the moment this deploys, so they are
-- explicitly given an unlimited licence and a platform administrator can set
-- a real one. Silently breaking existing tenants to reach a tidier default is
-- not a trade worth making.
UPDATE firm
   SET plan = 'PROFESSIONAL',
       license_expires_at = NULL,
       license_grace_days = 14,
       license_note = 'Grandfathered: existed before licensing was introduced'
 WHERE plan = 'TRIAL';

-- ---------------------------------------------------------------------------
-- A firm cannot change its own licence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION firm_license_is_platform_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Tenant queries always run inside a transaction that sets app.firm_id.
  -- Platform administration does not, so this fires only on the firm's own
  -- path — which is exactly the path that must never touch these columns.
  IF COALESCE(current_setting('app.firm_id', true), '') = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan               IS DISTINCT FROM OLD.plan
     OR NEW.license_expires_at IS DISTINCT FROM OLD.license_expires_at
     OR NEW.license_grace_days IS DISTINCT FROM OLD.license_grace_days
     OR NEW.max_users          IS DISTINCT FROM OLD.max_users
     OR NEW.max_clients        IS DISTINCT FROM OLD.max_clients
     OR NEW.max_cases          IS DISTINCT FROM OLD.max_cases
     OR NEW.license_note       IS DISTINCT FROM OLD.license_note
  THEN
    RAISE EXCEPTION 'a firm cannot change its own licence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER firm_license_is_platform_only
  BEFORE UPDATE ON firm
  FOR EACH ROW
  EXECUTE FUNCTION firm_license_is_platform_only();

-- ---------------------------------------------------------------------------
-- The platform functions grow licence columns.
--
-- CREATE OR REPLACE cannot change a function's return type, so these are
-- dropped and recreated. The security reasoning behind them is unchanged and
-- lives in 20260920000004_platform_functions: the return types carry firm
-- metadata and counts, and no client, case, identifier or document column.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS platform_list_firms(text, text, integer, integer);
DROP FUNCTION IF EXISTS platform_firm_detail(uuid);
DROP FUNCTION IF EXISTS platform_create_firm(uuid, text, text, text, text, text, text, text);

CREATE FUNCTION platform_list_firms(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  slug               text,
  frn                text,
  status             text,
  data_region        text,
  contact_email      text,
  created_at         timestamptz,
  plan               text,
  license_expires_at date,
  license_grace_days integer,
  max_users          integer,
  max_clients        integer,
  max_cases          integer,
  user_count         bigint,
  client_count       bigint,
  case_count         bigint,
  last_active_at     timestamptz,
  total_count        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT f.*
      FROM firm f
     WHERE (p_status IS NULL OR f.status::text = p_status)
       AND (
         p_search IS NULL
         OR f.name ILIKE '%' || p_search || '%'
         OR f.slug ILIKE '%' || p_search || '%'
         OR COALESCE(f.frn, '') ILIKE '%' || p_search || '%'
       )
  )
  SELECT m.id,
         m.name::text,
         m.slug::text,
         m.frn::text,
         m.status::text,
         m.data_region::text,
         m.contact_email::text,
         m.created_at,
         m.plan::text,
         m.license_expires_at,
         m.license_grace_days,
         m.max_users,
         m.max_clients,
         m.max_cases,
         (SELECT count(*) FROM app_user u WHERE u.firm_id = m.id AND u.deleted_at IS NULL),
         (SELECT count(*) FROM client c  WHERE c.firm_id = m.id AND c.deleted_at IS NULL),
         -- Deleted cases were counted here before licensing. Now that the console
         -- shows this number against a quota, it has to agree with the number the
         -- quota check uses, which excludes soft-deleted rows.
         (SELECT count(*) FROM "case" k  WHERE k.firm_id = m.id AND k.deleted_at IS NULL),
         (SELECT max(u.last_login_at) FROM app_user u WHERE u.firm_id = m.id),
         (SELECT count(*) FROM matched)
    FROM matched m
   ORDER BY m.created_at DESC
   LIMIT  GREATEST(p_limit, 0)
  OFFSET  GREATEST(p_offset, 0)
$$;

CREATE FUNCTION platform_firm_detail(p_id uuid)
RETURNS TABLE (
  id                 uuid,
  name               text,
  slug               text,
  frn                text,
  gstin              text,
  status             text,
  data_region        text,
  retention_months   integer,
  contact_email      text,
  contact_phone      text,
  city               text,
  state              text,
  created_at         timestamptz,
  plan               text,
  license_expires_at date,
  license_grace_days integer,
  max_users          integer,
  max_clients        integer,
  max_cases          integer,
  license_note       text,
  license_updated_at timestamptz,
  user_count         bigint,
  active_user_count  bigint,
  client_count       bigint,
  case_count         bigint,
  last_active_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id, f.name::text, f.slug::text, f.frn::text, f.gstin::text, f.status::text,
         f.data_region::text, f.retention_months, f.contact_email::text,
         f.contact_phone::text, f.city::text, f.state::text, f.created_at,
         f.plan::text, f.license_expires_at, f.license_grace_days,
         f.max_users, f.max_clients, f.max_cases,
         f.license_note::text, f.license_updated_at,
         (SELECT count(*) FROM app_user u WHERE u.firm_id = f.id AND u.deleted_at IS NULL),
         (SELECT count(*) FROM app_user u WHERE u.firm_id = f.id AND u.deleted_at IS NULL
                                            AND u.status = 'ACTIVE'),
         (SELECT count(*) FROM client c  WHERE c.firm_id = f.id AND c.deleted_at IS NULL),
         (SELECT count(*) FROM "case" k  WHERE k.firm_id = f.id AND k.deleted_at IS NULL),
         (SELECT max(u.last_login_at) FROM app_user u WHERE u.firm_id = f.id)
    FROM firm f
   WHERE f.id = p_id
$$;

CREATE FUNCTION platform_create_firm(
  p_id            uuid,
  p_name          text,
  p_slug          text,
  p_frn           text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_data_region   text DEFAULT 'in-west',
  p_plan          text DEFAULT 'TRIAL',
  p_expires_at    date DEFAULT NULL,
  p_grace_days    integer DEFAULT 14,
  p_max_users     integer DEFAULT NULL,
  p_max_clients   integer DEFAULT NULL,
  p_max_cases     integer DEFAULT NULL,
  p_license_note  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO firm (id, name, slug, frn, contact_email, city, state,
                    status, data_region, retention_months,
                    plan, license_expires_at, license_grace_days,
                    max_users, max_clients, max_cases, license_note,
                    license_updated_at, created_at, updated_at)
  VALUES (p_id, p_name, p_slug, NULLIF(p_frn, ''), NULLIF(p_contact_email, ''),
          NULLIF(p_city, ''), NULLIF(p_state, ''),
          'ACTIVE', p_data_region, 96,
          p_plan::"LicensePlan", p_expires_at, p_grace_days,
          p_max_users, p_max_clients, p_max_cases, NULLIF(p_license_note, ''),
          now(), now(), now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Set or renew a licence. The only other cross-tenant write in the system,
-- and like the first one it touches nothing but the firm row.
CREATE OR REPLACE FUNCTION platform_set_firm_license(
  p_id           uuid,
  p_plan         text,
  p_expires_at   date,
  p_grace_days   integer,
  p_max_users    integer,
  p_max_clients  integer,
  p_max_cases    integer,
  p_license_note text
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  plan               text,
  license_expires_at date,
  license_grace_days integer,
  max_users          integer,
  max_clients        integer,
  max_cases          integer,
  license_note       text,
  license_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_plan NOT IN ('TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE') THEN
    RAISE EXCEPTION 'unknown licence plan: %', p_plan;
  END IF;

  RETURN QUERY
  UPDATE firm f
     SET plan               = p_plan::"LicensePlan",
         license_expires_at = p_expires_at,
         license_grace_days = COALESCE(p_grace_days, f.license_grace_days),
         max_users          = p_max_users,
         max_clients        = p_max_clients,
         max_cases          = p_max_cases,
         license_note       = NULLIF(p_license_note, ''),
         license_updated_at = now(),
         updated_at         = now()
   WHERE f.id = p_id
  RETURNING f.id, f.name::text, f.plan::text, f.license_expires_at, f.license_grace_days,
            f.max_users, f.max_clients, f.max_cases, f.license_note::text, f.license_updated_at;
END;
$$;

-- Which licences need attention. Expired first, then soonest — the order a
-- person working through renewals actually wants.
CREATE OR REPLACE FUNCTION platform_list_expiring(
  p_within_days integer DEFAULT 30,
  p_limit       integer DEFAULT 25,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  slug               text,
  status             text,
  contact_email      text,
  plan               text,
  license_expires_at date,
  license_grace_days integer,
  total_count        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT f.*
      FROM firm f
     WHERE f.license_expires_at IS NOT NULL
       AND f.license_expires_at <= (CURRENT_DATE + GREATEST(p_within_days, 0))
       AND f.status <> 'CLOSED'
  )
  SELECT m.id, m.name::text, m.slug::text, m.status::text, m.contact_email::text,
         m.plan::text, m.license_expires_at, m.license_grace_days,
         (SELECT count(*) FROM matched)
    FROM matched m
   ORDER BY m.license_expires_at ASC
   LIMIT  GREATEST(p_limit, 0)
  OFFSET  GREATEST(p_offset, 0)
$$;

-- The firm's own read of its licence. Needed on the hot path of every write,
-- before any tenant transaction has been opened, so it takes the same narrow
-- SECURITY DEFINER route as the authentication lookups. It returns one firm's
-- licence and its three counts, and nothing else exists in the return type.
CREATE OR REPLACE FUNCTION firm_license_state(p_id uuid)
RETURNS TABLE (
  status             text,
  plan               text,
  license_expires_at date,
  license_grace_days integer,
  max_users          integer,
  max_clients        integer,
  max_cases          integer,
  user_count         bigint,
  client_count       bigint,
  case_count         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.status::text, f.plan::text, f.license_expires_at, f.license_grace_days,
         f.max_users, f.max_clients, f.max_cases,
         -- Seats in use, which is users PLUS invitations still outstanding. An
         -- invitation is a seat somebody has been promised; counting only
         -- accepted ones would let a firm on three seats invite thirty people
         -- and discover the limit one acceptance at a time.
         (SELECT count(*) FROM app_user u WHERE u.firm_id = f.id AND u.deleted_at IS NULL)
         + (SELECT count(*) FROM invitation i WHERE i.firm_id = f.id
              AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()),
         (SELECT count(*) FROM client c  WHERE c.firm_id = f.id AND c.deleted_at IS NULL),
         (SELECT count(*) FROM "case" k  WHERE k.firm_id = f.id AND k.deleted_at IS NULL)
    FROM firm f
   WHERE f.id = p_id
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform_list_firms(text, text, integer, integer)',
    'platform_firm_detail(uuid)',
    'platform_create_firm(uuid, text, text, text, text, text, text, text, text, date, integer, integer, integer, integer, text)',
    'platform_set_firm_license(uuid, text, date, integer, integer, integer, integer, text)',
    'platform_list_expiring(integer, integer, integer)',
    'firm_license_state(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ifp_app', fn);
  END LOOP;
END
$$;

COMMENT ON FUNCTION platform_set_firm_license(uuid, text, date, integer, integer, integer, integer, text) IS
  'SECURITY DEFINER by necessity: licensing spans tenants. Writes the firm row only. An expired licence makes a firm read-only; it never deletes or hides tenant data.';
COMMENT ON FUNCTION firm_license_state(uuid) IS
  'One firm''s licence and its three usage counts. Read on the write path before a tenant transaction exists. Returns no client, case, identifier or document column.';
COMMENT ON FUNCTION firm_license_is_platform_only() IS
  'Refuses any change to a licence column that arrives from inside a tenant transaction. The second wall behind the firm-facing update schema not carrying them.';
