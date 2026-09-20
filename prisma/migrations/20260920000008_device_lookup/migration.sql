-- Device authentication runs before a tenant is known.
--
-- The extension presents a device id and secret; which firm that belongs to is
-- precisely what we are trying to establish, so app.firm_id cannot be set yet
-- and the RLS policy on extension_device correctly returns nothing. That is
-- the same problem login has, and it gets the same answer: one narrow
-- SECURITY DEFINER function, keyed by primary key, returning only the columns
-- needed to authenticate.
--
-- It returns secret_hash, never a secret; the caller compares in constant time.
CREATE OR REPLACE FUNCTION auth_find_device(p_id uuid)
RETURNS TABLE (
  id          uuid,
  firm_id     uuid,
  user_id     uuid,
  label       text,
  secret_hash text,
  revoked_at  timestamptz,
  expires_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.firm_id, d.user_id, d.label::text, d.secret_hash::text,
         d.revoked_at, d.expires_at
    FROM extension_device d
   WHERE d.id = p_id
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_find_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_device(uuid) TO ifp_app;

COMMENT ON FUNCTION auth_find_device(uuid) IS
  'SECURITY DEFINER by necessity: the extension''s device credential is what identifies the tenant, so it must be readable before one is set. Keyed by primary key; returns a hash, never a secret.';
