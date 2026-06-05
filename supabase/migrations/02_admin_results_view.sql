-- Admin Election Summary RPC
-- Returns election details + tallies for admin results view
-- Only callable by admin users
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
        LEFT JOIN votes v ON v.position_id = p.id
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
        votes v ON v.candidate_id = c.id
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

-- Function to get election turnout stats for admin
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
        (SELECT COUNT(DISTINCT voter_id)::BIGINT FROM votes) AS votes_cast,
        ROUND(
            (SELECT COUNT(DISTINCT voter_id)::NUMERIC FROM votes) / 
            NULLIF((SELECT COUNT(*)::NUMERIC FROM profiles WHERE role = 'member' AND account_status = 'approved' AND voting_rights = true), 0) 
            * 100, 1
        ) AS turnout_percentage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;