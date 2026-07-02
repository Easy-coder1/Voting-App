-- Runoff elections: second round for tied positions only

-- ── TABLES ───────────────────────────────────────────────────────────────────
CREATE TABLE public.runoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (election_id)
);

CREATE INDEX idx_runoffs_election_id ON public.runoffs(election_id);
CREATE INDEX idx_runoffs_status ON public.runoffs(status);

CREATE TABLE public.runoff_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runoff_id UUID NOT NULL REFERENCES public.runoffs(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  UNIQUE (runoff_id, position_id, candidate_id)
);

CREATE INDEX idx_runoff_candidates_runoff_id ON public.runoff_candidates(runoff_id);

CREATE TABLE public.runoff_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runoff_id UUID NOT NULL REFERENCES public.runoffs(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (voter_id, position_id, runoff_id)
);

CREATE INDEX idx_runoff_votes_runoff_id ON public.runoff_votes(runoff_id);

CREATE UNIQUE INDEX runoffs_one_open_globally_idx
  ON public.runoffs ((true))
  WHERE status = 'open';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.runoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runoff_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runoff_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Runoffs viewable by authenticated users."
  ON public.runoffs FOR SELECT
  TO authenticated
  USING (true);

-- Runoff elections: second round for tied positions only
-- Requires is_admin() from 20260701120000 or 20260701150000

CREATE POLICY "Admins can insert runoffs."
  ON public.runoffs FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update runoffs."
  ON public.runoffs FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete runoffs."
  ON public.runoffs FOR DELETE
  USING (public.is_admin());

CREATE POLICY "Runoff candidates viewable by authenticated users."
  ON public.runoff_candidates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage runoff candidates."
  ON public.runoff_candidates FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete runoff candidates."
  ON public.runoff_candidates FOR DELETE
  USING (public.is_admin());

CREATE POLICY "Members view own runoff votes, admins view all."
  ON public.runoff_votes FOR SELECT
  USING (
    auth.uid() = voter_id OR public.is_admin()
  );

CREATE POLICY "Members can insert runoff vote if eligible."
  ON public.runoff_votes FOR INSERT
  WITH CHECK (
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

CREATE POLICY "Admins can delete runoff votes."
  ON public.runoff_votes FOR DELETE
  USING (public.is_admin());

-- ── TIE DETECTION ────────────────────────────────────────────────────────────
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
    JOIN public.candidates c ON c.position_id = p.id
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

-- ── START / CLOSE RUNOFF ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_election_runoff(p_election_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runoff_id uuid;
  v_tie record;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.get_election_ties(p_election_id) LIMIT 1
  ) THEN
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

CREATE OR REPLACE FUNCTION public.close_election_runoff(p_runoff_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can close a runoff.';
  END IF;

  UPDATE public.runoffs
  SET status = 'closed', closed_at = now()
  WHERE id = p_runoff_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Runoff not found or already closed.';
  END IF;
END;
$$;

-- ── FINAL RESULTS (round 1 + runoff merged) ───────────────────────────────────
-- Must DROP first: return type adds `outcome` column (Postgres cannot OR REPLACE)
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

-- Replace member-facing results RPC with merged final results
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

GRANT EXECUTE ON FUNCTION public.get_election_ties(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_election_runoff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_election_runoff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_final_election_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_results(uuid) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.runoff_votes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
