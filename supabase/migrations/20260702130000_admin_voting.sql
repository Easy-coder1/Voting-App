-- Allow approved admins (student election officers) to cast ballots like members.

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
      AND (voting_rights = true OR role = 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_approved_voter() TO authenticated;
