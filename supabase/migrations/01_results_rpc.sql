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
