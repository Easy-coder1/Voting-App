-- Use one shared candidate roster for all elections (no per-election copies).

-- 1. Point votes at a single canonical candidate per position + name
WITH canonical AS (
  SELECT DISTINCT ON (position_id, full_name)
    id AS keep_id,
    position_id,
    full_name
  FROM public.candidates
  ORDER BY
    position_id,
    full_name,
    (photo_url IS NOT NULL AND btrim(photo_url) <> '' AND photo_url NOT LIKE '%placeholder%') DESC,
    created_at ASC
),
dupes AS (
  SELECT c.id AS old_id, can.keep_id
  FROM public.candidates c
  JOIN canonical can
    ON can.position_id = c.position_id
   AND can.full_name = c.full_name
  WHERE c.id <> can.keep_id
)
UPDATE public.votes v
SET candidate_id = d.keep_id
FROM dupes d
WHERE v.candidate_id = d.old_id;

WITH canonical AS (
  SELECT DISTINCT ON (position_id, full_name)
    id AS keep_id,
    position_id,
    full_name
  FROM public.candidates
  ORDER BY
    position_id,
    full_name,
    (photo_url IS NOT NULL AND btrim(photo_url) <> '' AND photo_url NOT LIKE '%placeholder%') DESC,
    created_at ASC
)
DELETE FROM public.candidates c
USING canonical can
WHERE c.position_id = can.position_id
  AND c.full_name = can.full_name
  AND c.id <> can.keep_id;

-- 2. Drop election linkage from candidates
DROP INDEX IF EXISTS public.idx_candidates_election_id;

ALTER TABLE public.candidates
  DROP COLUMN IF EXISTS election_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_position_name
  ON public.candidates (position_id, full_name);

-- 3. RPCs: candidates are global; votes stay scoped per election
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
  JOIN public.candidates c ON c.position_id = p.id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = get_admin_election_summary.election_id
  LEFT JOIN pos_totals pt ON pt.pos_id = p.id
  WHERE EXISTS (
    SELECT 1 FROM public.candidates c2 WHERE c2.position_id = p.id
  )
  GROUP BY p.id, p.position_name, c.id, c.full_name, pt.total
  ORDER BY p.position_name, vote_count DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_election_results(election_id uuid)
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
  IF NOT EXISTS (
    SELECT 1 FROM public.elections e
    WHERE e.id = get_election_results.election_id AND (
      e.results_published = true OR EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Results are not available for this election.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS position_id,
    p.position_name,
    c.id AS candidate_id,
    c.full_name AS candidate_name,
    COUNT(v.id)::BIGINT AS vote_count
  FROM public.positions p
  JOIN public.candidates c ON c.position_id = p.id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = get_election_results.election_id
  GROUP BY p.id, p.position_name, c.id, c.full_name
  ORDER BY p.position_name, vote_count DESC;
END;
$$;
