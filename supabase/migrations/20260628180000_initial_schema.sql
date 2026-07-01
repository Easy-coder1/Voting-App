-- NUTFS E-Voting — initial Supabase schema

-- ── ENUMS ────────────────────────────────────────────────────────────────────
CREATE TYPE public.account_status_type AS ENUM (
  'pending',
  'approved'
);

-- ── TABLES ───────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  account_status public.account_status_type DEFAULT 'pending',
  voting_rights BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_name TEXT NOT NULL UNIQUE
);

CREATE TABLE public.elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'closed')),
  results_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  position_id UUID REFERENCES public.positions(id) ON DELETE CASCADE,
  photo_url TEXT,
  election_id UUID REFERENCES public.elections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_candidates_election_id ON public.candidates(election_id);

CREATE TABLE public.votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE RESTRICT,
  position_id UUID REFERENCES public.positions(id) ON DELETE RESTRICT,
  election_id UUID REFERENCES public.elections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (voter_id, position_id, election_id)
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- ── SEED POSITIONS ─────────────────────────────────────────────────────────────
INSERT INTO public.positions (position_name) VALUES
  ('President'),
  ('Vice President'),
  ('General Secretary'),
  ('Financial Secretary'),
  ('Male Organizer'),
  ('Female Organizer'),
  ('Welfare Secretary'),
  ('Woman Commission');

-- ── AUTO-CREATE PROFILE ON SIGNUP ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RPC FUNCTIONS ────────────────────────────────────────────────────────────
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
    ON c.position_id = p.id AND c.election_id = get_admin_election_summary.election_id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = get_admin_election_summary.election_id
  LEFT JOIN pos_totals pt ON pt.pos_id = p.id
  WHERE EXISTS (
    SELECT 1 FROM public.candidates c2
    WHERE c2.position_id = p.id AND c2.election_id = get_admin_election_summary.election_id
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
    RAISE EXCEPTION 'Results not available for this election yet.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS position_id,
    p.position_name,
    c.id AS candidate_id,
    c.full_name AS candidate_name,
    COUNT(v.id) AS vote_count
  FROM public.positions p
  JOIN public.candidates c
    ON c.position_id = p.id AND c.election_id = get_election_results.election_id
  LEFT JOIN public.votes v
    ON v.candidate_id = c.id AND v.election_id = get_election_results.election_id
  GROUP BY p.id, p.position_name, c.id, c.full_name
  ORDER BY p.position_name, vote_count DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_election_turnout(election_id uuid)
RETURNS TABLE(
  total_members bigint,
  approved_voters bigint,
  votes_cast bigint,
  turnout_percentage numeric
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
    RAISE EXCEPTION 'Only admins can view election turnout.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE role = 'member') AS total_members,
    (SELECT COUNT(*)::BIGINT FROM public.profiles WHERE role = 'member' AND account_status = 'approved' AND voting_rights = true) AS approved_voters,
    (SELECT COUNT(DISTINCT voter_id)::BIGINT FROM public.votes WHERE votes.election_id = get_election_turnout.election_id) AS votes_cast,
    ROUND(
      (SELECT COUNT(DISTINCT voter_id)::NUMERIC FROM public.votes WHERE votes.election_id = get_election_turnout.election_id) /
      NULLIF((SELECT COUNT(*)::NUMERIC FROM public.profiles WHERE role = 'member' AND account_status = 'approved' AND voting_rights = true), 0) * 100,
      1
    ) AS turnout_percentage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_election_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_election_turnout(uuid) TO authenticated;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Public profiles are viewable by everyone."
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile."
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile."
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update all profiles."
  ON public.profiles FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Positions
CREATE POLICY "Positions viewable by everyone."
  ON public.positions FOR SELECT USING (true);

CREATE POLICY "Admins can insert positions."
  ON public.positions FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update positions."
  ON public.positions FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Elections
CREATE POLICY "Elections viewable by everyone."
  ON public.elections FOR SELECT USING (true);

CREATE POLICY "Admins can insert elections."
  ON public.elections FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update elections."
  ON public.elections FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete elections."
  ON public.elections FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Candidates
CREATE POLICY "Candidates viewable by everyone."
  ON public.candidates FOR SELECT USING (true);

CREATE POLICY "Admins can insert candidates."
  ON public.candidates FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update candidates."
  ON public.candidates FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete candidates."
  ON public.candidates FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Votes
CREATE POLICY "Members can view own votes, Admins can view all."
  ON public.votes FOR SELECT USING (
    auth.uid() = voter_id OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Members can insert vote if eligible."
  ON public.votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND account_status = 'approved'
        AND voting_rights = true
    )
    AND EXISTS (
      SELECT 1 FROM public.elections e
      WHERE e.id = election_id AND e.status = 'open'
    )
  );

-- Audit logs
CREATE POLICY "Admins can view audit logs."
  ON public.audit_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "System can insert audit logs."
  ON public.audit_logs FOR INSERT WITH CHECK (true);

-- ── REALTIME ───────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;

-- ── GRANTS (required for anon/authenticated API access) ───────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
