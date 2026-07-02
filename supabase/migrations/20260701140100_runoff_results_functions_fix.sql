-- Patch: recreate get_election_results with outcome column (run if 140000 failed at this step)
-- Safe to run even if tables from 140000 already exist.

DROP FUNCTION IF EXISTS public.get_election_results(uuid);
DROP FUNCTION IF EXISTS public.get_final_election_results(uuid);

CREATE OR REPLACE FUNCTION public.get_final_election_results(p_election_id uuid)
RETURNS TABLE(
  position_id uuid,
  position_name text,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runoff_id uuid;
  v_runoff_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.elections e
    WHERE e.id = p_election_id AND (
      e.results_published = true OR public.is_admin()
    )
  ) THEN
    RAISE EXCEPTION 'Results are not available for this election.';
  END IF;

  SELECT r.id, r.status INTO v_runoff_id, v_runoff_status
  FROM public.runoffs r
  WHERE r.election_id = p_election_id
  LIMIT 1;

  RETURN QUERY
  WITH candidate_votes AS (
    SELECT
      p.id AS pos_id,
      p.position_name AS pos_name,
      c.id AS cand_id,
      c.full_name AS cand_name,
      COUNT(v.id)::BIGINT AS votes
    FROM public.positions p
    JOIN public.candidates c ON c.position_id = p.id
    LEFT JOIN public.votes v
      ON v.candidate_id = c.id AND v.election_id = p_election_id
    WHERE EXISTS (SELECT 1 FROM public.candidates c2 WHERE c2.position_id = p.id)
    GROUP BY p.id, p.position_name, c.id, c.full_name
  ),
  position_max AS (
    SELECT pos_id, MAX(votes) AS max_votes
    FROM candidate_votes
    GROUP BY pos_id
  ),
  position_stats AS (
    SELECT
      pm.pos_id,
      pm.max_votes,
      (
        SELECT COUNT(*)::INT
        FROM candidate_votes cv
        WHERE cv.pos_id = pm.pos_id AND cv.votes = pm.max_votes AND pm.max_votes > 0
      ) AS leaders_at_max
    FROM position_max pm
  ),
  runoff_winners AS (
    SELECT DISTINCT ON (rv.position_id)
      rv.position_id AS pos_id,
      rv.candidate_id AS cand_id,
      COUNT(*)::BIGINT AS votes
    FROM public.runoff_votes rv
    WHERE v_runoff_id IS NOT NULL
      AND rv.runoff_id = v_runoff_id
      AND v_runoff_status = 'closed'
    GROUP BY rv.position_id, rv.candidate_id
    ORDER BY rv.position_id, COUNT(*) DESC, rv.candidate_id
  ),
  runoff_position_max AS (
    SELECT rw.pos_id, MAX(rw.votes) AS max_runoff_votes
    FROM runoff_winners rw
    GROUP BY rw.pos_id
  ),
  runoff_resolved AS (
    SELECT rw.pos_id, rw.cand_id, rw.votes
    FROM runoff_winners rw
    JOIN runoff_position_max rpm ON rpm.pos_id = rw.pos_id
    WHERE rw.votes = rpm.max_runoff_votes
      AND rpm.max_runoff_votes > 0
      AND (
        SELECT COUNT(*)::INT
        FROM runoff_winners rw2
        WHERE rw2.pos_id = rw.pos_id AND rw2.votes = rpm.max_runoff_votes
      ) = 1
  )
  SELECT
    ps.pos_id,
    (SELECT cv.pos_name FROM candidate_votes cv WHERE cv.pos_id = ps.pos_id LIMIT 1),
    CASE
      WHEN ps.leaders_at_max = 1 AND ps.max_votes > 0 THEN (
        SELECT cv.cand_id FROM candidate_votes cv
        WHERE cv.pos_id = ps.pos_id AND cv.votes = ps.max_votes LIMIT 1
      )
      WHEN v_runoff_id IS NOT NULL AND v_runoff_status = 'closed' AND rr.cand_id IS NOT NULL THEN rr.cand_id
      ELSE NULL
    END,
    CASE
      WHEN ps.leaders_at_max = 1 AND ps.max_votes > 0 THEN (
        SELECT cv.cand_name FROM candidate_votes cv
        WHERE cv.pos_id = ps.pos_id AND cv.votes = ps.max_votes LIMIT 1
      )
      WHEN v_runoff_id IS NOT NULL AND v_runoff_status = 'closed' AND rr.cand_id IS NOT NULL THEN (
        SELECT c.full_name FROM public.candidates c WHERE c.id = rr.cand_id
      )
      ELSE NULL
    END,
    CASE
      WHEN ps.leaders_at_max = 1 AND ps.max_votes > 0 THEN ps.max_votes
      WHEN v_runoff_id IS NOT NULL AND v_runoff_status = 'closed' AND rr.cand_id IS NOT NULL THEN rr.votes
      ELSE 0
    END,
    CASE
      WHEN ps.leaders_at_max = 1 AND ps.max_votes > 0 THEN 'winner'
      WHEN ps.leaders_at_max >= 2 AND ps.max_votes > 0 AND v_runoff_id IS NULL THEN 'runoff_pending'
      WHEN ps.leaders_at_max >= 2 AND v_runoff_status = 'open' THEN 'runoff_open'
      WHEN ps.leaders_at_max >= 2 AND v_runoff_status = 'closed' AND rr.cand_id IS NOT NULL THEN 'runoff_winner'
      WHEN ps.leaders_at_max >= 2 AND v_runoff_status = 'closed' THEN 'tie_unresolved'
      ELSE 'no_votes'
    END
  FROM position_stats ps
  LEFT JOIN runoff_resolved rr ON rr.pos_id = ps.pos_id
  ORDER BY 2;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_election_results(election_id uuid)
RETURNS TABLE(
  position_id uuid,
  position_name text,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.get_final_election_results(get_election_results.election_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_final_election_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_results(uuid) TO authenticated;
