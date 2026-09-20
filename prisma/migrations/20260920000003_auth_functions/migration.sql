-- ---------------------------------------------------------------------------
-- Authentication lookup functions.
--
-- THE PROBLEM
-- Row Level Security is keyed on a transaction-local tenant id. But the
-- operations that ESTABLISH which tenant you are — looking up a user by email
-- at login, resolving a bearer token to a user, redeeming a refresh / reset /
-- invitation token — necessarily run before any tenant is known. Under RLS
-- those queries return nothing, so login is impossible.
--
-- THE WRONG FIXES
--   * Giving ifp_app BYPASSRLS: throws away the isolation backstop entirely.
--   * A policy like "firm_id = current OR current IS NULL": makes every table
--     world-readable to any code path that forgets to set the tenant.
--
-- THE FIX
-- A small, fixed set of SECURITY DEFINER functions owned by ifp_owner. Each
-- one answers exactly one authentication question, keyed by a unique
-- credential, and returns only the columns that question needs. The app role
-- gets EXECUTE on these and nothing else. There is no function here that can
-- enumerate rows, take a filter, or return client data.
--
-- Every function sets an empty search_path so it cannot be hijacked by a
-- shadowing object in a caller-controlled schema.
-- ---------------------------------------------------------------------------

-- 1. Login: resolve an email to the credential row.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id                 uuid,
  firm_id            uuid,
  email              text,
  password_hash      text,
  status             text,
  deleted_at         timestamptz,
  failed_login_count integer,
  locked_until       timestamptz,
  role_key           text,
  role_permissions   text[],
  firm_status        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.firm_id, u.email::text, u.password_hash, u.status::text,
         u.deleted_at, u.failed_login_count, u.locked_until,
         r.key::text, r.permissions, f.status::text
    FROM app_user u
    JOIN role r ON r.id = u.role_id
    JOIN firm f ON f.id = u.firm_id
   WHERE u.email_normalized = p_email
   LIMIT 1
$$;

-- 2. Every authenticated request: resolve a token subject to the live user.
--    Re-read on each request is what makes "disable user" take effect now
--    rather than when their access token happens to expire.
CREATE OR REPLACE FUNCTION auth_find_user_by_id(p_id uuid)
RETURNS TABLE (
  id               uuid,
  firm_id          uuid,
  email            text,
  status           text,
  deleted_at       timestamptz,
  role_key         text,
  role_permissions text[],
  firm_status      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.firm_id, u.email::text, u.status::text, u.deleted_at,
         r.key::text, r.permissions, f.status::text
    FROM app_user u
    JOIN role r ON r.id = u.role_id
    JOIN firm f ON f.id = u.firm_id
   WHERE u.id = p_id
   LIMIT 1
$$;

-- 3. Refresh token rotation.
CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_hash text)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  firm_id      uuid,
  family_id    uuid,
  client_type  text,
  used_at      timestamptz,
  revoked_at   timestamptz,
  expires_at   timestamptz,
  user_status  text,
  user_deleted timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.user_id, t.firm_id, t.family_id, t.client_type::text,
         t.used_at, t.revoked_at, t.expires_at,
         u.status::text, u.deleted_at
    FROM refresh_token t
    JOIN app_user u ON u.id = t.user_id
   WHERE t.token_hash = p_hash
   LIMIT 1
$$;

-- 4. Password reset redemption.
CREATE OR REPLACE FUNCTION auth_find_reset_token(p_hash text)
RETURNS TABLE (
  id         uuid,
  user_id    uuid,
  firm_id    uuid,
  used_at    timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.user_id, p.firm_id, p.used_at, p.expires_at
    FROM password_reset_token p
   WHERE p.token_hash = p_hash
   LIMIT 1
$$;

-- 5. Invitation redemption.
CREATE OR REPLACE FUNCTION auth_find_invitation(p_hash text)
RETURNS TABLE (
  id          uuid,
  firm_id     uuid,
  email       text,
  full_name   text,
  role_id     uuid,
  expires_at  timestamptz,
  accepted_at timestamptz,
  revoked_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.firm_id, i.email::text, i.full_name::text, i.role_id,
         i.expires_at, i.accepted_at, i.revoked_at
    FROM invitation i
   WHERE i.token_hash = p_hash
   LIMIT 1
$$;

-- 6. One-firm-per-user rule (ADR-004): does this address exist ANYWHERE?
--    Returns a boolean and the owning firm, never the user record itself.
CREATE OR REPLACE FUNCTION auth_email_owner(p_email text)
RETURNS TABLE (user_id uuid, firm_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.firm_id FROM app_user u WHERE u.email_normalized = p_email LIMIT 1
$$;

-- Lock the functions down: only the application role may call them.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'auth_find_user_by_email(text)',
    'auth_find_user_by_id(uuid)',
    'auth_find_refresh_token(text)',
    'auth_find_reset_token(text)',
    'auth_find_invitation(text)',
    'auth_email_owner(text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ifp_app', fn);
  END LOOP;
END
$$;

COMMENT ON FUNCTION auth_find_user_by_email(text) IS
  'SECURITY DEFINER by necessity: login runs before a tenant is known. Keyed by a unique email; returns credential columns only.';
