-- Per-election candidate snapshots: roster rows have election_id NULL;
-- each new election copies the current roster into election-scoped rows.

-- ── 1. Restore election linkage on candidates ────────────────────────────────
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS election_id UUID REFERENCES public.elections(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.idx_candidates_position_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_roster_position_name
  ON public.candidates (position_id, full_name)
  WHERE election_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_election_position_name
  ON public.candidates (election_id, position_id, full_name)
  WHERE election_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_election_id
  ON public.candidates (election_id);

-- ── 2. Snapshot existing elections from the current roster ───────────────────
INSERT INTO public.candidates (full_name, position_id, photo_url, election_id)
SELECT c.full_name, c.position_id, c.photo_url, e.id
FROM public.elections e
CROSS JOIN public.candidates c
WHERE c.election_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.candidates ec
    WHERE ec.election_id = e.id
    LIMIT 1
  );

-- ── 3. Point votes at election-scoped candidate copies ───────────────────────
UPDATE public.votes v
SET candidate_id = ec.id
FROM public.candidates g
JOIN public.candidates ec
  ON ec.election_id = v.election_id
 AND ec.position_id = g.position_id
 AND ec.full_name = g.full_name
WHERE v.candidate_id = g.id
  AND g.election_id IS NULL;

-- ── 4. Point runoff rows at election-scoped candidate copies ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runoff_candidates'
  ) THEN
    UPDATE public.runoff_candidates rc
    SET candidate_id = ec.id
    FROM public.runoffs r
    JOIN public.candidates g ON g.id = rc.candidate_id AND g.election_id IS NULL
    JOIN public.candidates ec
      ON ec.election_id = r.election_id
     AND ec.position_id = rc.position_id
     AND ec.full_name = g.full_name
    WHERE rc.runoff_id = r.id;

    UPDATE public.runoff_votes rv
    SET candidate_id = ec.id
    FROM public.runoffs r
    JOIN public.candidates g ON g.id = rv.candidate_id AND g.election_id IS NULL
    JOIN public.candidates ec
      ON ec.election_id = r.election_id
     AND ec.position_id = rv.position_id
     AND ec.full_name = g.full_name
    WHERE rv.runoff_id = r.id;
  END IF;
END $$;

-- ── 5. Auto-snapshot roster when an election is created ──────────────────────
CREATE OR REPLACE FUNCTION public.snapshot_election_candidates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.candidates (full_name, position_id, photo_url, election_id)
  SELECT c.full_name, c.position_id, c.photo_url, NEW.id
  FROM public.candidates c
  WHERE c.election_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_candidates_on_election_create ON public.elections;
CREATE TRIGGER snapshot_candidates_on_election_create
  AFTER INSERT ON public.elections
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_election_candidates();

-- ── 6. Vote integrity: candidate must belong to the same election ────────────
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
      WHERE c.id = candidate_id
        AND c.position_id = votes.position_id
        AND c.election_id = votes.election_id
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runoff_votes'
  ) THEN
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
          SELECT 1 FROM public.runoffs r
          JOIN public.candidates c
            ON c.id = runoff_votes.candidate_id
           AND c.election_id = r.election_id
           AND c.position_id = runoff_votes.position_id
          WHERE r.id = runoff_votes.runoff_id
        )
      );
  END IF;
END $$;

-- ── 7. RPCs: only election-scoped candidates count ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_election_summary(election_id uuid)
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
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view election summary.';
  END IF;

  RETURN QUERY
  WITH pos_totals AS (
    SELECT p.id AS pos_id, COUNT(v.id)::BIGINT AS total
    FROM public.positions p
    LEFT JOIN public.votes v
      ON v.position_id = p.id AND v.election_id = get_admin_election_summary.election_id
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
   AND c.election_id = get_admin_election_summary.election_id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = get_admin_election_summary.election_id
  LEFT JOIN pos_totals pt ON pt.pos_id = p.id
  GROUP BY p.id, p.position_name, c.id, c.full_name, pt.total
  ORDER BY p.position_name, vote_count DESC;
END;
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

GRANT EXECUTE ON FUNCTION public.get_admin_election_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_ties(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_final_election_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_results(uuid) TO authenticated;
