-- Only one election may have published results visible to members at a time.

CREATE OR REPLACE FUNCTION public.enforce_single_published_results()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.results_published IS TRUE THEN
    UPDATE public.elections
    SET results_published = false
    WHERE id IS DISTINCT FROM NEW.id
      AND results_published = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_published_results_trigger ON public.elections;
CREATE TRIGGER enforce_single_published_results_trigger
  BEFORE INSERT OR UPDATE OF results_published ON public.elections
  FOR EACH ROW
  WHEN (NEW.results_published IS TRUE)
  EXECUTE FUNCTION public.enforce_single_published_results();

CREATE UNIQUE INDEX IF NOT EXISTS idx_elections_one_published_results
  ON public.elections ((1))
  WHERE results_published = true;

-- Keep the most recently ended election if multiple are already published.
WITH keeper AS (
  SELECT id
  FROM public.elections
  WHERE results_published = true
  ORDER BY end_date DESC NULLS LAST, created_at DESC
  LIMIT 1
)
UPDATE public.elections e
SET results_published = false
WHERE e.results_published = true
  AND e.id NOT IN (SELECT id FROM keeper);
