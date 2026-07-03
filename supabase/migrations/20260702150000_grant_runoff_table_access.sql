-- Runoff tables were created after initial schema grants; restore API access.

GRANT SELECT ON public.runoffs TO authenticated;
GRANT SELECT ON public.runoff_candidates TO authenticated;
GRANT SELECT, INSERT ON public.runoff_votes TO authenticated;

-- Admins need write access for runoff management (RLS still enforces role)
GRANT INSERT, UPDATE, DELETE ON public.runoffs TO authenticated;
GRANT INSERT, DELETE ON public.runoff_candidates TO authenticated;
GRANT DELETE ON public.runoff_votes TO authenticated;

-- Ensure SELECT policies exist for members loading ballots
DROP POLICY IF EXISTS "Runoffs viewable by authenticated users." ON public.runoffs;
CREATE POLICY "Runoffs viewable by authenticated users."
  ON public.runoffs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Runoff candidates viewable by authenticated users." ON public.runoff_candidates;
CREATE POLICY "Runoff candidates viewable by authenticated users."
  ON public.runoff_candidates FOR SELECT
  TO authenticated
  USING (true);
