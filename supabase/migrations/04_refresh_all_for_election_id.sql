-- ============================================================
-- RUN THIS ENTIRE FILE IN YOUR SUPABASE SQL EDITOR
-- ============================================================

-- PART 1: Add election_id to votes table
ALTER TABLE votes ADD COLUMN IF NOT EXISTS election_id UUID REFERENCES elections(id) ON DELETE CASCADE;

-- Backfill existing votes with the election that was active when they were cast
UPDATE votes v
SET election_id = sub.election_id
FROM (
    SELECT 
        v2.id AS vote_id,
        e.id AS election_id
    FROM votes v2
    JOIN elections e ON e.status IN ('open', 'closed')
    WHERE v2.created_at >= e.start_date AND v2.created_at <= e.end_date
) sub
WHERE v.id = sub.vote_id AND v.election_id IS NULL;

-- Fallback: assign any remaining NULL election_id to the most recent election
UPDATE votes v
SET election_id = sub.election_id
FROM (
    SELECT id AS election_id FROM elections ORDER BY created_at DESC LIMIT 1
) sub
WHERE v.election_id IS NULL;

-- Make election_id NOT NULL (only if there are no NULLs left)
ALTER TABLE votes ALTER COLUMN election_id SET NOT NULL;

-- Drop old global UNIQUE constraint
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_voter_id_position_id_key;

-- Add new per-election UNIQUE constraint
ALTER TABLE votes ADD CONSTRAINT votes_voter_id_position_id_election_id_key UNIQUE(voter_id, position_id, election_id);

-- Update RLS policy for votes INSERT
DROP POLICY IF EXISTS "Members can insert vote if eligible." ON votes;
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

-- PART 2: Refresh the get_election_results RPC to filter by election_id
CREATE OR REPLACE FUNCTION get_election_results(election_id UUID)
RETURNS TABLE (
    position_id UUID,
    position_name TEXT,
    candidate_id UUID,
    candidate_name TEXT,
    vote_count BIGINT
) AS $$
BEGIN
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

-- PART 3: Refresh the admin summary RPCs to filter by election_id
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

-- PART 4: Refresh the schema cache so the frontend sees the new column
NOTIFY pgrst, 'reload schema';