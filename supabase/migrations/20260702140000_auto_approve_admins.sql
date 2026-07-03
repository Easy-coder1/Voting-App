-- Admins are student election officers: always approved with voting rights.

CREATE OR REPLACE FUNCTION public.ensure_admin_voter_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.account_status := 'approved';
    NEW.voting_rights := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_admin_voter_status_trigger ON public.profiles;
CREATE TRIGGER ensure_admin_voter_status_trigger
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_admin_voter_status();

UPDATE public.profiles
SET account_status = 'approved', voting_rights = true
WHERE role = 'admin'
  AND (account_status IS DISTINCT FROM 'approved' OR voting_rights IS DISTINCT FROM true);

-- Turnout: count approved admins as eligible voters too
DROP FUNCTION IF EXISTS public.get_election_turnout(uuid);

CREATE FUNCTION public.get_election_turnout(election_id uuid)
RETURNS TABLE(
  total_members bigint,
  approved_voters bigint,
  pending_members bigint,
  rejected_members bigint,
  votes_cast bigint,
  turnout_percentage numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view election turnout.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE role = 'member') AS total_members,
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE account_status = 'approved' AND (voting_rights = true OR role = 'admin')) AS approved_voters,
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE role = 'member' AND account_status = 'pending') AS pending_members,
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE role = 'member' AND account_status = 'rejected') AS rejected_members,
    (SELECT COUNT(DISTINCT voter_id)::BIGINT FROM public.votes WHERE votes.election_id = get_election_turnout.election_id) AS votes_cast,
    ROUND(
      (SELECT COUNT(DISTINCT voter_id)::NUMERIC FROM public.votes WHERE votes.election_id = get_election_turnout.election_id) /
      NULLIF((SELECT COUNT(*)::NUMERIC FROM public.profiles WHERE account_status = 'approved' AND (voting_rights = true OR role = 'admin')), 0) * 100,
      1
    ) AS turnout_percentage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_election_turnout(uuid) TO authenticated;
