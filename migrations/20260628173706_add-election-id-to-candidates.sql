-- Associate candidates with a specific election.
-- Candidates with election_id IS NULL are "draft" candidates being assembled
-- on the admin Candidates page. When an election is created, the current draft
-- set is attached to that election and the page is cleared for the next set.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS election_id uuid
  REFERENCES public.elections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_candidates_election_id
  ON public.candidates(election_id);

-- Backfill: in the previous model candidates were global and shared by the one
-- election that actually collected votes. Attach existing candidates to that
-- election so its historical results keep rendering. Candidates remain drafts
-- (NULL) if no votes exist anywhere.
UPDATE public.candidates c
SET election_id = (
  SELECT v.election_id
  FROM public.votes v
  WHERE v.election_id IS NOT NULL
  GROUP BY v.election_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE c.election_id IS NULL
  AND EXISTS (SELECT 1 FROM public.votes v WHERE v.election_id IS NOT NULL);

-- Scope candidate tallies to the election that owns them so results never mix
-- candidate sets across elections.
CREATE OR REPLACE FUNCTION public.get_admin_election_summary(election_id uuid)
 RETURNS TABLE(position_id uuid, position_name text, candidate_id uuid, candidate_name text, vote_count bigint, total_votes_in_position bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can view election summary.';
  END IF;

  RETURN QUERY
  WITH pos_totals AS (
    SELECT p.id AS pos_id, COUNT(v.id)::BIGINT AS total
    FROM positions p
    LEFT JOIN votes v ON v.position_id = p.id AND v.election_id = get_admin_election_summary.election_id
    GROUP BY p.id
  )
  SELECT
    p.id AS position_id,
    p.position_name,
    c.id AS candidate_id,
    c.full_name AS candidate_name,
    COUNT(v.id)::BIGINT AS vote_count,
    COALESCE(pt.total, 0)::BIGINT AS total_votes_in_position
  FROM positions p
  JOIN candidates c ON c.position_id = p.id AND c.election_id = get_admin_election_summary.election_id
  LEFT JOIN votes v ON v.candidate_id = c.id AND v.election_id = get_admin_election_summary.election_id
  LEFT JOIN pos_totals pt ON pt.pos_id = p.id
  WHERE EXISTS (
    SELECT 1 FROM candidates c2
    WHERE c2.position_id = p.id AND c2.election_id = get_admin_election_summary.election_id
  )
  GROUP BY p.id, p.position_name, c.id, c.full_name, pt.total
  ORDER BY p.position_name, vote_count DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_election_results(election_id uuid)
 RETURNS TABLE(position_id uuid, position_name text, candidate_id uuid, candidate_name text, vote_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM elections e
    WHERE e.id = get_election_results.election_id AND (
      e.results_published = true OR EXISTS (
        SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Results not available for this election yet.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS position_id,
    p.position_name,
    c.id AS candidate_id,
    c.full_name AS candidate_name,
    COUNT(v.id) AS vote_count
  FROM positions p
  JOIN candidates c ON c.position_id = p.id AND c.election_id = get_election_results.election_id
  LEFT JOIN votes v ON v.candidate_id = c.id AND v.election_id = get_election_results.election_id
  GROUP BY p.id, p.position_name, c.id, c.full_name
  ORDER BY p.position_name, vote_count DESC;
END;
$function$;
