-- ============================================================
-- INSFORGE DATABASE INITIALIZATION FOR CHURCH E-VOTING APP
-- ============================================================
-- Run this entire file in your InsForge SQL / Database editor.
-- Uses auth.uid() for InsForge compatibility (same as Supabase).
-- ============================================================

-- Create custom types for enum-like behavior
CREATE TYPE account_status_type AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- Profiles table (extends InsForge auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY,  -- User ID from InsForge auth
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    account_status account_status_type DEFAULT 'pending',
    voting_rights BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Elections table
CREATE TABLE elections (
    id UUID PRIMARY KEY DEFAULT gen_random_uauth.uid(),
    title TEXT NOT NULL,
    description TEXT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'closed')),
    results_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions table
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uauth.uid(),
    position_name TEXT NOT NULL UNIQUE
);

-- Insert default positions
INSERT INTO positions (position_name) VALUES
    ('President'),
    ('Vice President'),
    ('General Secretary'),
    ('Financial Secretary'),
    ('Welfare Secretary'),
    ('Male Organizer'),
    ('Female Organizer');

-- Candidates table
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uauth.uid(),
    full_name TEXT NOT NULL,
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Votes table
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uauth.uid(),
    voter_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    candidate_id UUID REFERENCES candidates(id) ON DELETE RESTRICT,
    position_id UUID REFERENCES positions(id) ON DELETE RESTRICT,
    election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(voter_id, position_id, election_id) -- Ensures one vote per position per election per member
);

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uauth.uid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Set up Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Public profiles are viewable by everyone." ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can update all profiles." ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Elections RLS
CREATE POLICY "Elections viewable by everyone." ON elections FOR SELECT USING (true);
CREATE POLICY "Admins can insert elections." ON elections FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update elections." ON elections FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete elections." ON elections FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Positions RLS
CREATE POLICY "Positions viewable by everyone." ON positions FOR SELECT USING (true);
CREATE POLICY "Admins can insert positions." ON positions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update positions." ON positions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Candidates RLS
CREATE POLICY "Candidates viewable by everyone." ON candidates FOR SELECT USING (true);
CREATE POLICY "Admins can insert candidates." ON candidates FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update candidates." ON candidates FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete candidates." ON candidates FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Votes RLS
-- Members can only read their own votes. Admins can read all votes.
CREATE POLICY "Members can view own votes, Admins can view all." ON votes FOR SELECT USING (
  auth.uid() = voter_id OR 
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Voting restrictions:
-- 1. Must be the authenticated user
-- 2. Must be approved and have voting rights
-- 3. Election must be open
CREATE POLICY "Members can insert vote if eligible." ON votes FOR INSERT WITH CHECK (
  auth.uid() = voter_id AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
      AND account_status = 'approved' 
      AND voting_rights = true
  ) AND
  EXISTS (
    SELECT 1 FROM elections e
    WHERE e.id = election_id
      AND e.status = 'open'
  )
);
-- No updates or deletes allowed on votes (immutable)

-- Audit Logs RLS
CREATE POLICY "Admins can view audit logs." ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "System can insert audit logs." ON audit_logs FOR INSERT WITH CHECK (true);

-- ============================================================
-- STORED FUNCTIONS (RPC)
-- ============================================================

-- Member-facing: Get election results (only if published or user is admin)
CREATE OR REPLACE FUNCTION get_election_results(election_id UUID)
RETURNS TABLE (
    position_id UUID,
    position_name TEXT,
    candidate_id UUID,
    candidate_name TEXT,
    vote_count BIGINT
) AS $$
BEGIN
    -- Only allow if election results are published or user is admin
    IF NOT EXISTS (
        SELECT 1 FROM elections e 
        WHERE e.id = election_id 
        AND (e.results_published = true OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
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
    FROM 
        positions p
    JOIN 
        candidates c ON c.position_id = p.id
    LEFT JOIN 
        votes v ON v.candidate_id = c.id AND v.election_id = election_id
    GROUP BY 
        p.id, p.position_name, c.id, c.full_name
    ORDER BY 
        p.position_name, vote_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin-facing: Get election summary with candidate tallies
CREATE OR REPLACE FUNCTION get_admin_election_summary(election_id UUID)
RETURNS TABLE (
    position_id UUID,
    position_name TEXT,
    candidate_id UUID,
    candidate_name TEXT,
    vote_count BIGINT,
    total_votes_in_position BIGINT
) AS $$
BEGIN
    -- Only admins can call this function
    IF NOT EXISTS (
        SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Only admins can view election summary.';
    END IF;

    RETURN QUERY
    WITH pos_totals AS (
        SELECT 
            p.id AS pos_id,
            COUNT(v.id)::BIGINT AS total
        FROM positions p
        LEFT JOIN votes v ON v.position_id = p.id AND v.election_id = election_id
        GROUP BY p.id
    )
    SELECT 
        p.id AS position_id,
        p.position_name,
        c.id AS candidate_id,
        c.full_name AS candidate_name,
        COUNT(v.id)::BIGINT AS vote_count,
        COALESCE(pt.total, 0)::BIGINT AS total_votes_in_position
    FROM 
        positions p
    JOIN 
        candidates c ON c.position_id = p.id
    LEFT JOIN 
        votes v ON v.candidate_id = c.id AND v.election_id = election_id
    LEFT JOIN 
        pos_totals pt ON pt.pos_id = p.id
    WHERE 
        EXISTS (
            SELECT 1 FROM candidates c2 WHERE c2.position_id = p.id
        )
    GROUP BY 
        p.id, p.position_name, c.id, c.full_name, pt.total
    ORDER BY 
        p.position_name, vote_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin-facing: Get election turnout statistics
CREATE OR REPLACE FUNCTION get_election_turnout(election_id UUID)
RETURNS TABLE (
    total_members BIGINT,
    approved_voters BIGINT,
    votes_cast BIGINT,
    turnout_percentage NUMERIC
) AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Only admins can view election turnout.';
    END IF;

    RETURN QUERY
    SELECT
        (SELECT COUNT(*)::BIGINT FROM profiles WHERE role = 'member') AS total_members,
        (SELECT COUNT(*)::BIGINT FROM profiles WHERE role = 'member' AND account_status = 'approved' AND voting_rights = true) AS approved_voters,
        (SELECT COUNT(DISTINCT voter_id)::BIGINT FROM votes WHERE election_id = $1) AS votes_cast,
        ROUND(
            (SELECT COUNT(DISTINCT voter_id)::NUMERIC FROM votes WHERE election_id = $1) / 
            NULLIF((SELECT COUNT(*)::NUMERIC FROM profiles WHERE role = 'member' AND account_status = 'approved' AND voting_rights = true), 0) 
            * 100, 1
        ) AS turnout_percentage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
-- Note: InsForge uses its own realtime infrastructure.
-- If InsForge has an equivalent to Supabase's publication system,
-- run these commands to enable realtime on specific tables:
-- alter publication insforge_realtime add table profiles;
-- alter publication insforge_realtime add table votes;
