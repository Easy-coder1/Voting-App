-- Fix infinite recursion in profiles RLS (caused by admin check subquery on profiles)
-- Run this in Supabase SQL Editor if login fails with:
--   "infinite recursion detected in policy for relation profiles"

-- Helper: read profiles without triggering RLS (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_voter()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND account_status = 'approved'
      AND voting_rights = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_voter() TO authenticated;

-- ── Profiles (root cause of recursion) ──────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own profile, admins view all." ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

CREATE POLICY "Users can view own profile, admins view all."
  ON public.profiles FOR SELECT USING (
    auth.uid() = id OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins can update all profiles." ON public.profiles;
CREATE POLICY "Admins can update all profiles."
  ON public.profiles FOR UPDATE USING (public.is_admin());

-- ── Votes ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can view own votes, Admins can view all." ON public.votes;
CREATE POLICY "Members can view own votes, Admins can view all."
  ON public.votes FOR SELECT USING (
    auth.uid() = voter_id OR public.is_admin()
  );

DROP POLICY IF EXISTS "Members can insert vote if eligible." ON public.votes;
CREATE POLICY "Members can insert vote if eligible."
  ON public.votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND public.is_approved_voter()
    AND EXISTS (
      SELECT 1 FROM public.elections e
      WHERE e.id = election_id AND e.status = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.candidates c
      WHERE c.id = candidate_id AND c.position_id = votes.position_id
    )
  );

DROP POLICY IF EXISTS "Admins can delete votes." ON public.votes;
CREATE POLICY "Admins can delete votes."
  ON public.votes FOR DELETE USING (public.is_admin());

-- ── Positions, elections, candidates, audit_logs ─────────────────────────────
DROP POLICY IF EXISTS "Admins can insert positions." ON public.positions;
CREATE POLICY "Admins can insert positions."
  ON public.positions FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update positions." ON public.positions;
CREATE POLICY "Admins can update positions."
  ON public.positions FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert elections." ON public.elections;
CREATE POLICY "Admins can insert elections."
  ON public.elections FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update elections." ON public.elections;
CREATE POLICY "Admins can update elections."
  ON public.elections FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete elections." ON public.elections;
CREATE POLICY "Admins can delete elections."
  ON public.elections FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert candidates." ON public.candidates;
CREATE POLICY "Admins can insert candidates."
  ON public.candidates FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update candidates." ON public.candidates;
CREATE POLICY "Admins can update candidates."
  ON public.candidates FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete candidates." ON public.candidates;
CREATE POLICY "Admins can delete candidates."
  ON public.candidates FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view audit logs." ON public.audit_logs;
CREATE POLICY "Admins can view audit logs."
  ON public.audit_logs FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert audit logs." ON public.audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs." ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs."
  ON public.audit_logs FOR INSERT WITH CHECK (public.is_admin());

-- ── Runoff tables (only if migration 140000 was applied) ─────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runoffs'
  ) THEN
    DROP POLICY IF EXISTS "Admins can insert runoffs." ON public.runoffs;
    CREATE POLICY "Admins can insert runoffs."
      ON public.runoffs FOR INSERT WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "Admins can update runoffs." ON public.runoffs;
    CREATE POLICY "Admins can update runoffs."
      ON public.runoffs FOR UPDATE USING (public.is_admin());

    DROP POLICY IF EXISTS "Admins can delete runoffs." ON public.runoffs;
    CREATE POLICY "Admins can delete runoffs."
      ON public.runoffs FOR DELETE USING (public.is_admin());

    DROP POLICY IF EXISTS "Admins can manage runoff candidates." ON public.runoff_candidates;
    CREATE POLICY "Admins can manage runoff candidates."
      ON public.runoff_candidates FOR INSERT WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "Admins can delete runoff candidates." ON public.runoff_candidates;
    CREATE POLICY "Admins can delete runoff candidates."
      ON public.runoff_candidates FOR DELETE USING (public.is_admin());

    DROP POLICY IF EXISTS "Members view own runoff votes, admins view all." ON public.runoff_votes;
    CREATE POLICY "Members view own runoff votes, admins view all."
      ON public.runoff_votes FOR SELECT USING (
        auth.uid() = voter_id OR public.is_admin()
      );

    DROP POLICY IF EXISTS "Members can insert runoff vote if eligible." ON public.runoff_votes;
    CREATE POLICY "Members can insert runoff vote if eligible."
      ON public.runoff_votes FOR INSERT WITH CHECK (
        auth.uid() = voter_id
        AND public.is_approved_voter()
        AND EXISTS (
          SELECT 1 FROM public.runoffs r
          WHERE r.id = runoff_id AND r.status = 'open'
        )
        AND EXISTS (
          SELECT 1 FROM public.runoff_candidates rc
          WHERE rc.runoff_id = runoff_votes.runoff_id
            AND rc.position_id = runoff_votes.position_id
            AND rc.candidate_id = runoff_votes.candidate_id
        )
        AND EXISTS (
          SELECT 1 FROM public.candidates c
          WHERE c.id = candidate_id AND c.position_id = runoff_votes.position_id
        )
      );

    DROP POLICY IF EXISTS "Admins can delete runoff votes." ON public.runoff_votes;
    CREATE POLICY "Admins can delete runoff votes."
      ON public.runoff_votes FOR DELETE USING (public.is_admin());
  END IF;
END $$;

-- Update trigger to use helper (avoids redundant profile reads)
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

  IF NOT public.is_admin() THEN
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
