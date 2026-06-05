-- Migration 03: Add election_id to votes table
-- This scopes votes to specific elections so users can vote in each election independently.

-- 1. Add election_id column with foreign key to elections
ALTER TABLE votes ADD COLUMN election_id UUID REFERENCES elections(id) ON DELETE CASCADE;

-- 2. Backfill election_id for existing votes based on the election that was active when cast
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
WHERE v.id = sub.vote_id;

-- 3. Fallback: assign any remaining NULL election_id to the most recent election
UPDATE votes v
SET election_id = sub.election_id
FROM (
    SELECT id AS election_id FROM elections ORDER BY created_at DESC LIMIT 1
) sub
WHERE v.election_id IS NULL;

-- 4. Make election_id NOT NULL once backfilled
ALTER TABLE votes ALTER COLUMN election_id SET NOT NULL;

-- 5. Drop old global UNIQUE constraint that prevented cross-election voting
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_voter_id_position_id_key;

-- 6. Add new per-election UNIQUE constraint (one vote per position per voter per election)
ALTER TABLE votes ADD CONSTRAINT votes_voter_id_position_id_election_id_key UNIQUE(voter_id, position_id, election_id);

-- 7. Update RLS: votes INSERT policy must now check election_id
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
</｜｜DSML｜｜parameter>
</write_to_file>