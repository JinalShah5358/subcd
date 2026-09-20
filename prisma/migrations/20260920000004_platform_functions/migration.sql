-- ---------------------------------------------------------------------------
-- Platform administration: seeing across tenants, deliberately and narrowly.
--
-- Row Level Security makes cross-tenant reads impossible by design, which is
-- the point. A platform administrator provisioning and suspending firms
-- genuinely has to see across them, and there are three ways to allow that:
--
--   1. Give the app role BYPASSRLS.           Rejected — it disables every
--                                              policy for every query the app
--                                              ever makes, not just these.
--   2. Add "or the caller is a platform       Rejected — it puts the exception
--      admin" to each of the 21 policies.      in 21 places and makes each one
--                                              depend on a session variable
--                                              the application sets.
--   3. A handful of SECURITY DEFINER          Chosen. The exception lives in
--      functions with a fixed shape.           one file, is enumerable, and
--                                              each function's return type is
--                                              its own limit.
--
-- The limit that matters: these functions return firm METADATA and COUNTS.
-- None of them returns a client name, an identifier, a case, or a document.
-- A platform administrator can see that a firm has 212 clients; they cannot
-- see who those clients are. That is enforced here by the return types, not
-- by the API remembering to leave columns out.
--
-- Creating a firm is the only write. Everything afterwards — its first admin,
-- its invitation — runs through the ordinary withTenant() path, because once
-- the firm row exists the normal policies admit writes for that firm.
-- ---------------------------------------------------------------------------

-- 1. List firms. The platform console's only cross-tenant read.
CREATE OR REPLACE FUNCTION platform_list_firms(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id             uuid,
  name           text,
  slug           text,
  frn            text,
  status         text,
  data_region    text,
  contact_email  text,
  created_at     timestamptz,
  user_count     bigint,
  client_count   bigint,
  case_count     bigint,
  last_active_at timestamptz,
  total_count    bigint
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
         (SELECT count(*) FROM app_user u WHERE u.firm_id = m.id AND u.deleted_at IS NULL),
         (SELECT count(*) FROM client c  WHERE c.firm_id = m.id AND c.deleted_at IS NULL),
         (SELECT count(*) FROM "case" k  WHERE k.firm_id = m.id),
         (SELECT max(u.last_login_at) FROM app_user u WHERE u.firm_id = m.id),
         (SELECT count(*) FROM matched)
    FROM matched m
   ORDER BY m.created_at DESC
   LIMIT  GREATEST(p_limit, 0)
  OFFSET  GREATEST(p_offset, 0)
$$;

-- 2. One firm, same shape. Used by the firm detail panel.
CREATE OR REPLACE FUNCTION platform_firm_detail(p_id uuid)
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  frn               text,
  gstin             text,
  status            text,
  data_region       text,
  retention_months  integer,
  contact_email     text,
  contact_phone     text,
  city              text,
  state             text,
  created_at        timestamptz,
  user_count        bigint,
  active_user_count bigint,
  client_count      bigint,
  case_count        bigint,
  last_active_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id, f.name::text, f.slug::text, f.frn::text, f.gstin::text, f.status::text,
         f.data_region::text, f.retention_months, f.contact_email::text,
         f.contact_phone::text, f.city::text, f.state::text, f.created_at,
         (SELECT count(*) FROM app_user u WHERE u.firm_id = f.id AND u.deleted_at IS NULL),
         (SELECT count(*) FROM app_user u WHERE u.firm_id = f.id AND u.deleted_at IS NULL
                                            AND u.status = 'ACTIVE'),
         (SELECT count(*) FROM client c  WHERE c.firm_id = f.id AND c.deleted_at IS NULL),
         (SELECT count(*) FROM "case" k  WHERE k.firm_id = f.id),
         (SELECT max(u.last_login_at) FROM app_user u WHERE u.firm_id = f.id)
    FROM firm f
   WHERE f.id = p_id
$$;

-- 3. Provision a firm. The only cross-tenant write in the system.
--
--    Deliberately minimal: it creates the firm row and nothing else. The
--    first administrator is invited afterwards through the normal
--    firm-scoped path, so the invitation, its token hash and its audit entry
--    all take exactly the route every other invitation takes.
CREATE OR REPLACE FUNCTION platform_create_firm(
  p_id            uuid,
  p_name          text,
  p_slug          text,
  p_frn           text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_data_region   text DEFAULT 'in-west'
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
                    status, data_region, retention_months, created_at, updated_at)
  VALUES (p_id, p_name, p_slug, NULLIF(p_frn, ''), NULLIF(p_contact_email, ''),
          NULLIF(p_city, ''), NULLIF(p_state, ''),
          'ACTIVE', p_data_region, 96, now(), now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. Suspend or reactivate.
--
--    Suspension is not deletion and never becomes deletion: the firm's data
--    stays exactly where it is. Login is refused (auth_find_user_by_email
--    already returns firm_status, and the login handler already checks it),
--    so the effect is that nobody from that firm can sign in — not that
--    anything is destroyed.
CREATE OR REPLACE FUNCTION platform_set_firm_status(p_id uuid, p_status text)
RETURNS TABLE (id uuid, name text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'CLOSED') THEN
    RAISE EXCEPTION 'unknown firm status: %', p_status;
  END IF;

  RETURN QUERY
  UPDATE firm f
     SET status = p_status::"FirmStatus", updated_at = now()
   WHERE f.id = p_id
  RETURNING f.id, f.name::text, f.status::text;
END;
$$;

-- 5. Is this slug free? Checked before provisioning so the console can say so
--    rather than surfacing a constraint violation.
CREATE OR REPLACE FUNCTION platform_slug_taken(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM firm WHERE slug = p_slug)
$$;

-- 6. Platform-wide totals for the console header.
CREATE OR REPLACE FUNCTION platform_totals()
RETURNS TABLE (
  firm_count      bigint,
  active_firms    bigint,
  suspended_firms bigint,
  user_count      bigint,
  client_count    bigint,
  case_count      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (SELECT count(*) FROM firm),
         (SELECT count(*) FROM firm WHERE status = 'ACTIVE'),
         (SELECT count(*) FROM firm WHERE status = 'SUSPENDED'),
         (SELECT count(*) FROM app_user WHERE deleted_at IS NULL),
         (SELECT count(*) FROM client   WHERE deleted_at IS NULL),
         (SELECT count(*) FROM "case")
$$;

-- Lock every one of them down: nobody but the application role may execute.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform_list_firms(text, text, integer, integer)',
    'platform_firm_detail(uuid)',
    'platform_create_firm(uuid, text, text, text, text, text, text, text)',
    'platform_set_firm_status(uuid, text)',
    'platform_slug_taken(text)',
    'platform_totals()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ifp_app', fn);
  END LOOP;
END
$$;

COMMENT ON FUNCTION platform_list_firms(text, text, integer, integer) IS
  'SECURITY DEFINER by necessity: platform administration spans tenants. Returns firm metadata and counts only — never client or case data.';
COMMENT ON FUNCTION platform_create_firm(uuid, text, text, text, text, text, text, text) IS
  'SECURITY DEFINER by necessity: the firm row must exist before any tenant-scoped write to it is possible. Creates the row and nothing else.';
COMMENT ON FUNCTION platform_set_firm_status(uuid, text) IS
  'Suspension refuses sign-in for that firm. It does not delete, archive or alter any tenant data.';
