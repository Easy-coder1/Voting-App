-- Member-facing election summary: all candidates with vote counts when results are published.

CREATE OR REPLACE FUNCTION public.get_published_election_summary(p_election_id uuid)
RETURNS TABLE(
  position_id uuid,
  position_name text,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint,
  total_votes_in_position bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.elections e
    WHERE e.id = p_election_id AND (
      e.results_published = true OR public.is_admin()
    )
  ) THEN
    RAISE EXCEPTION 'Results are not available for this election.';
  END IF;

  RETURN QUERY
  WITH pos_totals AS (
    SELECT p.id AS pos_id, COUNT(v.id)::BIGINT AS total
    FROM public.positions p
    LEFT JOIN public.votes v
      ON v.position_id = p.id AND v.election_id = p_election_id
    GROUP BY p.id
  )
  SELECT
    p.id AS position_id,
    p.position_name,
    c.id AS candidate_id,
    c.full_name AS candidate_name,
    COUNT(v.id)::BIGINT AS vote_count,
    COALESCE(pt.total, 0)::BIGINT AS total_votes_in_position
  FROM public.positions p
  JOIN public.candidates c
    ON c.position_id = p.id
   AND c.election_id = p_election_id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = p_election_id
  LEFT JOIN pos_totals pt ON pt.pos_id = p.id
  GROUP BY p.id, p.position_name, c.id, c.full_name, pt.total
  ORDER BY p.position_name, vote_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_published_election_summary(uuid) TO authenticated;
