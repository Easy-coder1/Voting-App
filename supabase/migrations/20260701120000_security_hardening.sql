-- Security hardening for production deployment
-- Run after all prior migrations in supabase/migrations/

-- ── 1. Protect privileged profile fields from self-elevation ─────────────────
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      RAISE EXCEPTION 'Not authorized to change account status';
    END IF;
    IF NEW.voting_rights IS DISTINCT FROM OLD.voting_rights THEN
      RAISE EXCEPTION 'Not authorized to change voting rights';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- ── 2. Restrict profile visibility ───────────────────────────────────────────
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

CREATE POLICY "Users can view own profile, admins view all."
  ON public.profiles FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── 3. Strengthen vote INSERT integrity ──────────────────────────────────────
DROP POLICY IF EXISTS "Members can insert vote if eligible." ON public.votes;

CREATE POLICY "Members can insert vote if eligible."
  ON public.votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND account_status = 'approved'
        AND voting_rights = true
    )
    AND EXISTS (
      SELECT 1 FROM public.elections e
      WHERE e.id = election_id AND e.status = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.candidates c
      WHERE c.id = candidate_id AND c.position_id = votes.position_id
    )
  );

-- ── 4. Allow admins to delete votes (required for election cleanup) ─────────
DROP POLICY IF EXISTS "Admins can delete votes." ON public.votes;

CREATE POLICY "Admins can delete votes."
  ON public.votes FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── 5. Restrict audit log inserts to admins ─────────────────────────────────
DROP POLICY IF EXISTS "System can insert audit logs." ON public.audit_logs;

CREATE POLICY "Admins can insert audit logs."
  ON public.audit_logs FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── 6. Enforce at most one open election at a time ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS elections_one_open_idx
  ON public.elections ((true))
  WHERE status = 'open';
