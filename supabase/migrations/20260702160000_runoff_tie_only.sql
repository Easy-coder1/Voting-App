-- Runoffs are only valid when an election has tied positions (2+ leaders at max votes).

CREATE OR REPLACE FUNCTION public.count_election_tied_positions(p_election_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate_votes AS (
    SELECT
      p.id AS pos_id,
      c.id AS cand_id,
      COUNT(v.id)::BIGINT AS votes
    FROM public.positions p
    JOIN public.candidates c
      ON c.position_id = p.id AND c.election_id = p_election_id
    LEFT JOIN public.votes v
      ON v.candidate_id = c.id AND v.election_id = p_election_id
    GROUP BY p.id, c.id
  ),
  position_max AS (
    SELECT pos_id, MAX(votes) AS max_votes
    FROM candidate_votes
    GROUP BY pos_id
  )
  SELECT COUNT(*)::integer
  FROM position_max pm
  WHERE pm.max_votes > 0
    AND (
      SELECT COUNT(*)::INT
      FROM candidate_votes cv
      WHERE cv.pos_id = pm.pos_id AND cv.votes = pm.max_votes
    ) >= 2;
$$;

CREATE OR REPLACE FUNCTION public.get_election_ties(p_election_id uuid)
RETURNS TABLE(
  position_id uuid,
  position_name text,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can view election ties.';
  END IF;

  RETURN QUERY
  WITH candidate_votes AS (
    SELECT
      p.id AS pos_id,
      p.position_name AS pos_name,
      c.id AS cand_id,
      c.full_name AS cand_name,
      COUNT(v.id)::BIGINT AS votes
    FROM public.positions p
    JOIN public.candidates c
      ON c.position_id = p.id AND c.election_id = p_election_id
    LEFT JOIN public.votes v
      ON v.candidate_id = c.id AND v.election_id = p_election_id
    GROUP BY p.id, p.position_name, c.id, c.full_name
  ),
  position_max AS (
    SELECT pos_id, MAX(votes) AS max_votes
    FROM candidate_votes
    GROUP BY pos_id
  ),
  tied_positions AS (
    SELECT pm.pos_id
    FROM position_max pm
    WHERE pm.max_votes > 0
      AND (
        SELECT COUNT(*)::INT
        FROM candidate_votes cv
        WHERE cv.pos_id = pm.pos_id AND cv.votes = pm.max_votes
      ) >= 2
  )
  SELECT
    cv.pos_id,
    cv.pos_name,
    cv.cand_id,
    cv.cand_name,
    cv.votes
  FROM candidate_votes cv
  JOIN position_max pm ON pm.pos_id = cv.pos_id
  JOIN tied_positions tp ON tp.pos_id = cv.pos_id
  WHERE cv.votes = pm.max_votes
  ORDER BY cv.pos_name, cv.cand_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_election_runoff(p_election_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runoff_id uuid;
  v_tie record;
  v_tied_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can start a runoff.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.elections e
    WHERE e.id = p_election_id AND e.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'Runoff can only start after the election is closed.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.runoffs WHERE election_id = p_election_id) THEN
    RAISE EXCEPTION 'A runoff already exists for this election.';
  END IF;

  v_tied_count := public.count_election_tied_positions(p_election_id);
  IF v_tied_count = 0 THEN
    RAISE EXCEPTION 'No tied positions found — runoff is not needed.';
  END IF;

  INSERT INTO public.runoffs (election_id, status)
  VALUES (p_election_id, 'open')
  RETURNING id INTO v_runoff_id;

  FOR v_tie IN SELECT * FROM public.get_election_ties(p_election_id)
  LOOP
    INSERT INTO public.runoff_candidates (runoff_id, position_id, candidate_id)
    VALUES (v_runoff_id, v_tie.position_id, v_tie.candidate_id);
  END LOOP;

  RETURN v_runoff_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_runoff_requires_ties()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.count_election_tied_positions(NEW.election_id) = 0 THEN
    RAISE EXCEPTION 'Runoff can only be created when at least one position is tied.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_runoff_requires_ties_trigger ON public.runoffs;
CREATE TRIGGER validate_runoff_requires_ties_trigger
  BEFORE INSERT ON public.runoffs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_runoff_requires_ties();

GRANT EXECUTE ON FUNCTION public.count_election_tied_positions(uuid) TO authenticated;
